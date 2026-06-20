// Zero 本地运行时 daemon
// 用法：
//   zero-daemon start --server <url> --token <token>   后台启动（常驻）
//   zero-daemon status / stop                           状态 / 停止
//   zero-daemon run   --server <url> --token <token>    前台运行（调试）
// 职责：发现本地编码 Agent CLI → 配对令牌连服务端 → 心跳 →
//       认领 task → 跑 agent（B3.2：Claude Code）→ 回传结果。

import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import { claudeAdapter } from "./claude-adapter";
import { codexAdapter } from "./codex-adapter";
import { opencodeAdapter } from "./opencode-adapter";
import { kimiAdapter } from "./kimi-adapter";
import { asText } from "./adapter-util";
import { makeReporter, type Reporter } from "./reporter";

const HEARTBEAT_MS = 20_000;
const CLAIM_MS = 5_000;
const WATCH_MS = 5_000; // 进程看护探活周期（自触发续跑）
const PICKER_PORT = 8799; // 本地文件夹选择器（仅 127.0.0.1）
const ZERO_DIR = join(homedir(), ".zero");
const PID_FILE = join(ZERO_DIR, "daemon.pid");
const LOG_FILE = join(ZERO_DIR, "daemon.log");
const WORK_DIR = join(ZERO_DIR, "work"); // 空目录模式
const REPOS_DIR = join(ZERO_DIR, "repos"); // URL 仓库的源 clone 缓存
const WORKTREES_DIR = join(ZERO_DIR, "worktrees"); // 每个 issue 一棵 worktree
const MCP_DIR = join(ZERO_DIR, "mcp"); // 每个 issue 一份 MCP 配置（按需拉上下文）
const BIN_DIR = join(ZERO_DIR, "bin"); // 注入给 agent 的小工具（zero-bg 后台启动器）

// 把 ~/.local/bin（kimi 等经 uv/pipx 装的 CLI）+ ~/.zero/bin（zero-bg）并入 PATH。幂等。
{
  const extra = [join(homedir(), ".local/bin"), BIN_DIR];
  const parts = (process.env.PATH ?? "").split(":");
  const add = extra.filter((p) => !parts.includes(p));
  if (add.length) {
    process.env.PATH = [...add, process.env.PATH].filter(Boolean).join(":");
  }
}

// zero-bg：给 agent 用的「能跨 run 存活」的后台启动器。
// agent 内联 `setsid ... &` 会留在 Claude Bash 工具的常驻 shell 下、run 结束被回收；
// 这个脚本是一个独立短命进程：起好 setsid 子进程、打印其 pid 后立即退出 →
// 子进程随之重父到 init、且在独立会话，不被调用方进程组牵连。供 zero_watch_pid 看护。
const ZERO_BG_SCRIPT = `#!/usr/bin/env bash
# zero-bg "<command>" [logfile] —— 启动能在本轮 run 结束后存活的后台进程，打印其 PID。
# 本脚本是独立短命进程：起好后台子进程、打印 pid 后立即退出 → 子进程重父到 init，
# 脱离调用方(Claude Bash 工具常驻 shell)的进程树。优先 setsid(Linux)，回退 nohup(macOS 无 setsid)。
set -u
cmd="\${1:?usage: zero-bg \\"<command>\\" [logfile]}"
log="\${2:-/dev/null}"
if command -v setsid >/dev/null 2>&1; then
  setsid bash -c "$cmd" </dev/null >>"$log" 2>&1 &
else
  nohup bash -c "$cmd" </dev/null >>"$log" 2>&1 &
fi
pid=$!
disown 2>/dev/null || true
echo "$pid"
`;
function installZeroBg(): void {
  try {
    ensureDir(BIN_DIR);
    const p = join(BIN_DIR, "zero-bg");
    writeFileSync(p, ZERO_BG_SCRIPT);
    chmodSync(p, 0o755);
  } catch (err) {
    console.error(`安装 zero-bg 失败（zero_watch_pid 仍可手动用）：${(err as Error).message}`);
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const n = Number(readFileSync(PID_FILE, "utf8").trim());
  return Number.isFinite(n) ? n : null;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function requireConn(): { server: string; token: string } {
  const server = (
    arg("server") ??
    process.env.ZERO_SERVER ??
    "http://localhost:8787"
  ).replace(/\/$/, "");
  const token = arg("token") ?? process.env.ZERO_TOKEN;
  if (!token) {
    console.error("缺少令牌：--token <token>（或环境变量 ZERO_TOKEN）");
    process.exit(1);
  }
  return { server, token };
}

function discover(): Record<string, boolean> {
  return {
    claude_code: Bun.which("claude") != null,
    codex: Bun.which("codex") != null,
    opencode: Bun.which("opencode") != null,
    codebuddy: Bun.which("codebuddy") != null,
    kimi: Bun.which("kimi") != null,
  };
}

async function post<T>(
  server: string,
  token: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${server}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

function enabled(caps: Record<string, boolean>): string {
  const on = Object.entries(caps)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return on.length ? on.join(", ") : "（未发现任何 CLI）";
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

// ---- 任务执行 ----

type WorkSpec =
  | { mode: "repo"; repoUrl: string; baseBranch: string; branch: string }
  | { mode: "dir"; path: string }
  | { mode: "empty" };

// 一次执行的用量/成本（取自 Claude result 事件）
interface RunUsage {
  model: string | null;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number | null;
  numTurns: number | null;
}

// 累加多次执行（如会话失效后重跑）的用量
function mergeUsage(a: RunUsage | null, b: RunUsage | null): RunUsage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    model: b.model ?? a.model,
    costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0),
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    durationMs: (a.durationMs ?? 0) + (b.durationMs ?? 0),
    numTurns: (a.numTurns ?? 0) + (b.numTurns ?? 0),
  };
}

interface Claim {
  task: { id: string; issueId: string; sessionId: string | null } | null;
  agent?: {
    name: string;
    provider: string;
    model: string | null;
    instructions: string | null;
    skills?: SkillSpec[];
  };
  context?: {
    issue: { number: number; title: string; description: string | null };
    comments: { author: string; body: string | null }[];
    repo: {
      name: string;
      url: string;
      baseBranch: string;
    } | null;
    work?: WorkSpec;
    // 评论附件元数据（已 link）；daemon 据 size 小推（落盘）/大拉（给签名 URL）
    attachments?: AttachmentMeta[];
    // 续接会话时，前 resumeFromIndex 条评论已在上一轮上下文里（增量推送用）
    resumeFromIndex?: number;
  };
}

// ---- git / 工作目录准备 ----

async function git(
  args: string[],
  cwd?: string,
  timeoutMs?: number,
): Promise<{ ok: boolean; out: string; err: string }> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: process.env,
  });
  // 超时则 kill 子进程 —— 关键：否则克隆卡死会无限占住 daemon 槽位、冻住整个运行时
  let timedOut = false;
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        proc.kill(9);
      }, timeoutMs)
    : null;
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);
  if (timedOut)
    return {
      ok: false,
      out: out.trim(),
      err: `git ${args[0]} 超时（${Math.round((timeoutMs ?? 0) / 1000)}s）——网络不通/仓库地址有问题（如 github SSH 22 被墙，可换 HTTPS 或配 ssh.github.com:443）`,
    };
  return { ok: code === 0, out: out.trim(), err: err.trim() };
}

function isGitUrl(s: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(s) || s.endsWith(".git");
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

// 变更可视化：拍一个快照引用（含未提交/未跟踪，不改工作树）。
// stash create 有改动时返回快照 commit；干净时退回 HEAD；非 git 仓库返回 null。
async function snapshotRef(cwd: string): Promise<string | null> {
  const head = await git(["rev-parse", "HEAD"], cwd);
  if (!head.ok) return null;
  const stash = await git(["stash", "create", "-u"], cwd);
  return (stash.ok && stash.out) || head.out || null;
}

type FileChange = {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  isBinary: boolean;
  patch?: string;
};

// 算 baseline → 当前 的改动（每文件 ±行/状态 + 逐文件 unified patch）。best-effort，失败返回 null。
async function captureChanges(cwd: string, baseline: string) {
  const end = (await snapshotRef(cwd)) ?? "HEAD";
  const Q = ["-c", "core.quotePath=false"];
  const ns = await git([...Q, "diff", "--numstat", baseline, end], cwd);
  if (!ns.ok) return null;
  const st = await git([...Q, "diff", "--name-status", baseline, end], cwd);
  const statusMap = new Map<string, FileChange["status"]>();
  for (const line of st.out.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const code = line.slice(0, tab).trim();
    const p = line.slice(tab + 1);
    statusMap.set(
      p,
      code.startsWith("A")
        ? "added"
        : code.startsWith("D")
          ? "deleted"
          : "modified",
    );
  }
  const files: FileChange[] = [];
  for (const line of ns.out.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const isBinary = parts[0] === "-" || parts[1] === "-";
    const path = parts.slice(2).join("\t");
    files.push({
      path,
      status: statusMap.get(path) ?? "modified",
      additions: isBinary ? 0 : parseInt(parts[0], 10) || 0,
      deletions: isBinary ? 0 : parseInt(parts[1], 10) || 0,
      isBinary,
    });
  }
  // 逐文件取 patch（二进制跳过；单文件超 200KB 留空，前端可后续懒取）
  for (const f of files) {
    if (f.isBinary) continue;
    const p = await git([...Q, "diff", baseline, end, "--", f.path], cwd);
    if (p.ok && p.out.length <= 200_000) f.patch = p.out;
  }
  const head = await git(["rev-parse", "HEAD"], cwd);
  return {
    files,
    filesChanged: files.length,
    additions: files.reduce((s, f) => s + f.additions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
    baselineSha: baseline.slice(0, 40),
    headSha: head.ok ? head.out.slice(0, 40) : null,
  };
}

// 据工作模式准备 cwd：仓库→worktree / 工作目录→就地 / 空目录。失败抛错。
async function prepareWorkdir(work: WorkSpec, issueId: string): Promise<string> {
  if (work.mode === "dir") {
    if (!existsSync(work.path)) throw new Error(`工作目录不存在：${work.path}`);
    return work.path; // 就地
  }
  if (work.mode === "empty") {
    const dir = join(WORK_DIR, issueId);
    ensureDir(dir);
    return dir;
  }
  // mode === "repo" → 隔离 worktree
  let source: string;
  if (isGitUrl(work.repoUrl)) {
    ensureDir(REPOS_DIR);
    source = join(REPOS_DIR, sanitize(work.repoUrl));
    if (!existsSync(source)) {
      const r = await git(["clone", work.repoUrl, source], undefined, 120_000);
      if (!r.ok) {
        // 清掉不完整的残壳，否则下次命中坏缓存
        try {
          rmSync(source, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        throw new Error(`克隆仓库失败：${r.err || r.out}`);
      }
    } else {
      await git(["fetch", "--all", "--prune"], source, 30_000); // best-effort
    }
  } else {
    source = work.repoUrl; // 本地仓库路径
    if (!existsSync(source)) throw new Error(`本地仓库不存在：${source}`);
    const chk = await git(["rev-parse", "--git-dir"], source);
    if (!chk.ok) throw new Error(`不是 git 仓库：${source}`);
  }
  // 每个 issue 一棵 worktree：已存在则复用（改动/会话累积），否则新建分支
  const worktreePath = join(WORKTREES_DIR, issueId);
  if (existsSync(worktreePath)) return worktreePath;
  ensureDir(WORKTREES_DIR);
  let r = await git(
    ["worktree", "add", "-b", work.branch, worktreePath, work.baseBranch],
    source,
  );
  if (!r.ok) {
    // 分支已存在 → 直接挂这条分支
    r = await git(["worktree", "add", worktreePath, work.branch], source);
    if (!r.ok) throw new Error(`创建 worktree 失败：${r.err || r.out}`);
  }
  return worktreePath;
}

// ---- 本地文件夹选择器（仅供本机网页调用，弹原生对话框选目录）----

async function pickFolder(): Promise<string | null> {
  if (process.platform !== "darwin") return null; // 目前仅 macOS
  const proc = Bun.spawn({
    cmd: [
      "osascript",
      "-e",
      'POSIX path of (choose folder with prompt "选择工作目录")',
    ],
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const out = (await new Response(proc.stdout).text()).trim();
  const code = await proc.exited;
  if (code !== 0 || !out) return null; // 用户取消
  return out.replace(/\/$/, ""); // 去掉尾部斜杠
}

function startPicker() {
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
  try {
    Bun.serve({
      port: PICKER_PORT,
      hostname: "127.0.0.1",
      idleTimeout: 255, // 选目录可能停留较久
      async fetch(req) {
        if (req.method === "OPTIONS")
          return new Response(null, { headers: cors });
        const url = new URL(req.url);
        if (url.pathname === "/pick-folder") {
          const path = await pickFolder();
          return Response.json({ path }, { headers: cors });
        }
        return new Response("zero-daemon picker", { headers: cors });
      },
    });
    console.log(`本地选择器：http://127.0.0.1:${PICKER_PORT}`);
  } catch (err) {
    console.error(
      `选择器启动失败（手动输入路径仍可用）：${(err as Error).message}`,
    );
  }
}

// 把服务端装配好的上下文拼成给 agent 的 prompt
// 写本 issue 的 MCP 配置：注入 Zero 上下文 server，env 带服务端地址 / 运行时令牌 / issueId。
// 路径按 issue 固定，每跑覆盖；0600 收口（含令牌）。返回配置文件路径供 --mcp-config。
function writeMcpConfig(
  server: string,
  token: string,
  issueId: string,
  taskId: string,
): string {
  ensureDir(MCP_DIR);
  const mcpServerPath = new URL("./mcp-context.ts", import.meta.url).pathname;
  const cfg = {
    mcpServers: {
      zero: {
        command: process.execPath, // bun 自身
        args: [mcpServerPath],
        env: {
          ZERO_SERVER: server,
          ZERO_TOKEN: token,
          ZERO_ISSUE_ID: issueId,
          ZERO_TASK_ID: taskId, // 自唤醒登记的 source_task（审计/溯源）
        },
      },
    },
  };
  const path = join(MCP_DIR, `${issueId}.json`);
  writeFileSync(path, JSON.stringify(cfg), { mode: 0o600 });
  return path;
}

// ---- 技能物化（C3）----
// 把 agent 挂载的技能写进工作目录的 .claude/skills/<slug>/SKILL.md（+ 文本附件），
// 由底层 CLI（Claude Code）自动发现、按需加载。只管理我们写入的 slug（manifest），
// 不动用户自带的 skill；并把 .claude/ 加入 git exclude，避免污染 diff/PR。

interface SkillSpec {
  slug: string;
  name: string;
  description: string;
  content: string | null;
  files?: { path: string; content: string }[];
}

// YAML 双引号标量（转义 \ 与 "，换行压成空格）
function yamlScalar(s: string): string {
  return `"${s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ")}"`;
}

// 防穿越的相对路径（去前导 /、拒绝 .. 段、拒空）
function safeRelPath(p: string): string | null {
  const norm = p.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!norm || norm.includes("\0")) return null;
  if (norm.split("/").some((seg) => seg === "..")) return null;
  return norm;
}

// 合成 SKILL.md：frontmatter 由 name/description 生成，正文用 content（库里不存 frontmatter）
function renderSkillMd(sk: SkillSpec): string {
  const name = sanitize(sk.slug) || "skill";
  return `---\nname: ${name}\ndescription: ${yamlScalar(sk.description ?? "")}\n---\n\n${sk.content ?? ""}\n`;
}

// 把 .claude/ 等加入本工作树的 git exclude（worktree / dir 模式且是 git 才生效）
async function excludeFromGit(cwd: string) {
  const r = await git(["rev-parse", "--git-path", "info/exclude"], cwd);
  if (!r.ok || !r.out) return; // 非 git（空目录模式）→ 跳过
  let p = r.out.trim();
  if (!isAbsolute(p)) p = join(cwd, p);
  const want = ["/.claude/", "/.agents/", "/.codex/", "/.opencode/"];
  let cur = "";
  try {
    cur = readFileSync(p, "utf8");
  } catch {
    /* exclude 文件可能尚不存在 */
  }
  const add = want.filter((w) => !cur.includes(w));
  if (!add.length) return;
  ensureDir(dirname(p));
  const sep = cur && !cur.endsWith("\n") ? "\n" : "";
  writeFileSync(
    p,
    `${cur}${sep}# zero: 物化的技能/工具配置，勿提交\n${add.join("\n")}\n`,
  );
}

// 在一个根目录下物化技能；只清理上轮我们写的 slug（manifest），保留用户自带 skill
function materializeInto(root: string, skills: SkillSpec[]) {
  ensureDir(root);
  const manifestPath = join(root, ".zero-managed.json");
  let prev: string[] = [];
  try {
    const j = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (Array.isArray(j)) prev = j.filter((x): x is string => typeof x === "string");
  } catch {
    /* 首次 / 无 manifest */
  }
  // 先移除上一轮我们写过的（卸载的技能这轮不应再出现）
  for (const slug of prev) {
    try {
      rmSync(join(root, slug), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  const now: string[] = [];
  for (const sk of skills) {
    const slug = sanitize(sk.slug);
    if (!slug) continue;
    const dir = join(root, slug);
    ensureDir(dir);
    writeFileSync(join(dir, "SKILL.md"), renderSkillMd(sk));
    for (const f of sk.files ?? []) {
      const rel = safeRelPath(f.path);
      if (!rel) continue;
      const fp = join(dir, rel);
      ensureDir(dirname(fp));
      writeFileSync(fp, f.content);
    }
    now.push(slug);
  }
  writeFileSync(manifestPath, JSON.stringify(now));
}

// 物化进 worktree：Claude Code 从 cwd 的 .claude/skills/ 自动发现（OpenCode 也读它）。
// 即便本轮无技能也跑一遍：清掉上轮残留。返回物化的技能数。
async function materializeSkills(
  cwd: string,
  skills: SkillSpec[],
): Promise<number> {
  materializeInto(join(cwd, ".claude", "skills"), skills);
  await excludeFromGit(cwd);
  return skills.length;
}

// 评论附件：小文件落盘「推」给 agent、大文件给签名 URL 让 agent 按需「拉」
const ATTACH_SMALL_MAX = 10 * 1024 * 1024; // ≤10MB 推，> 懒取
interface AttachmentMeta {
  id: string;
  filename: string;
  mime: string;
  size: number;
  signedPath: string;
}
interface ResolvedAttachment {
  filename: string;
  mime: string;
  size: number;
  big: boolean;
  rel?: string; // 小文件：相对工作目录的路径
  url?: string; // 大文件：签名下载 URL（curl）
}

function safeName(name: string): string {
  return (
    (name || "file").replace(/[/\\]/g, "_").replace(/^\.+/, "_").slice(0, 200) ||
    "file"
  );
}
function fmtBytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)}MB`;
  if (n >= 1 << 10) return `${Math.round(n / (1 << 10))}KB`;
  return `${n}B`;
}

// 小文件落到 <cwd>/.zero/attachments/（按文件名去重、重跑不重下）；大文件不下、留签名 URL。
// 任一下载失败 → 退化为「懒取」（给 URL），不阻断执行。
async function materializeAttachments(
  server: string,
  cwd: string,
  atts: AttachmentMeta[],
): Promise<ResolvedAttachment[]> {
  const out: ResolvedAttachment[] = [];
  const dir = join(cwd, ".zero", "attachments");
  for (const a of atts) {
    const filename = safeName(a.filename);
    const url = `${server}${a.signedPath}`;
    if (a.size > ATTACH_SMALL_MAX) {
      out.push({ filename, mime: a.mime, size: a.size, big: true, url });
      continue;
    }
    const dest = join(dir, filename);
    if (!existsSync(dest)) {
      try {
        ensureDir(dir);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await Bun.write(dest, await res.arrayBuffer());
      } catch (err) {
        console.error(
          `附件 ${filename} 下载失败，改为懒取：${(err as Error).message}`,
        );
        out.push({ filename, mime: a.mime, size: a.size, big: true, url });
        continue;
      }
    }
    out.push({
      filename,
      mime: a.mime,
      size: a.size,
      big: false,
      rel: `.zero/attachments/${filename}`,
    });
  }
  return out;
}

// opts.full=false 且在续接会话时只渲染增量评论（旧评论已在会话记忆里）；
// full=true（新会话首跑 / resume 失败回退新会话）渲染全量，避免失忆。
export function buildPrompt(
  claim: Claim,
  opts: { full: boolean; attachments?: ResolvedAttachment[] },
): string {
  const { agent, context } = claim;
  const L: string[] = [];
  L.push(`You are "${agent?.name}", an agent on the Zero platform.`);
  if (agent?.instructions) L.push(agent.instructions);
  L.push("");
  L.push(`# Issue ZERO-${context?.issue.number}: ${context?.issue.title}`);
  if (context?.issue.description) L.push(context.issue.description);
  const all = context?.comments ?? [];
  const from = context?.resumeFromIndex ?? 0;
  const delta = !opts.full && from > 0 && from < all.length;
  const shown = delta ? all.slice(from) : all;
  if (shown.length) {
    if (delta) {
      L.push(
        `\n(${from} earlier comment(s) are already in your conversation context from previous turns.)`,
      );
      L.push("## New comments since your last turn");
    } else {
      L.push("\n## Conversation so far");
    }
    for (const cm of shown) L.push(`- ${cm.author}: ${cm.body ?? ""}`);
  }
  L.push(
    "\nOn-demand context tools (MCP) if the above is insufficient: `zero_older_comments` (earlier comments beyond those shown) and `zero_prior_runs` (past runs' status/outcome on this issue). Prefer the context already given; call these only when you need more.",
  );
  L.push(
    "\nThis run is NON-INTERACTIVE and single-shot: when you end your turn the run ENDS and you are NOT automatically resumed. Do not promise to \"report back in a minute\" or sleep/busy-wait. If you must wait for something and then continue, schedule a callback BEFORE ending: `zero_wake_me(after_sec, note)` to be re-invoked after a delay, or `zero_watch_pid(pid, note)` to be re-invoked when a long background job finishes. You resume with full session memory.",
  );
  L.push(
    "IMPORTANT for background jobs that must outlive this run: do NOT use a bare `&`/`setsid` in your shell (it stays tied to this session and gets killed when the run ends). Instead launch via the provided `zero-bg` helper, which fully detaches the process and prints its PID:  `pid=$(zero-bg 'your long command' /tmp/job.log)`  — then pass that `$pid` to `zero_watch_pid`.",
  );
  const work = context?.work;
  if (work?.mode === "repo") {
    L.push(
      `\nYou are in a git worktree of repo "${context?.repo?.name ?? ""}" on branch ${work.branch} (based off ${work.baseBranch}). Make the code changes, commit them with git, then end with a concise summary.`,
    );
  } else if (work?.mode === "dir") {
    L.push(
      `\nYou are working directly in the directory ${work.path} (in-place, NOT isolated). Complete the task, then end with a concise summary.`,
    );
  } else {
    L.push(
      "\n(No repo/dir attached yet — respond with your plan / answer, then a concise summary.)",
    );
  }
  // 附件：小文件给工作目录内相对路径，大文件给现成 curl 命令（按需下载）
  const atts = opts.attachments ?? [];
  if (atts.length) {
    L.push("\n## Attached files");
    const small = atts.filter((a) => !a.big);
    const big = atts.filter((a) => a.big);
    if (small.length) {
      L.push(
        "Saved under `./.zero/attachments/` — read them as needed (open images with your file/read tool; read large files selectively):",
      );
      for (const a of small)
        L.push(`- ${a.rel}  (${a.mime}, ${fmtBytes(a.size)})`);
    }
    if (big.length) {
      L.push(
        "Large files (not downloaded, to save space). Download one only if you need it, by running its command:",
      );
      for (const a of big)
        L.push(
          `- ${a.filename} (${a.mime}, ${fmtBytes(a.size)}) → \`curl -sL '${a.url}' -o '${a.filename}'\``,
        );
    }
  }
  return L.join("\n");
}

// 跑 Claude 系无头 CLI（claude / codebuddy —— stream-json 同构，复用同一逻辑+adapter）：
// 逐行解析 stream-json，经 adapter 规范化后通过 reporter 实时上报执行流；
// 返回最终文本 + 会话 id（供 complete 回传）。bin 决定调哪个二进制。
async function runClaudeLike(
  bin: string,
  prompt: string,
  cwd: string,
  opts: { model?: string | null; sessionId?: string | null; mcpConfig?: string },
  reporter: Reporter,
): Promise<{
  ok: boolean;
  result?: string;
  sessionId?: string;
  error?: string;
  usage?: RunUsage | null;
}> {
  const cmd = [
    bin,
    "-p",
    "--output-format",
    "stream-json",
    "--verbose", // stream-json 配合 -p 必须带 --verbose
    "--dangerously-skip-permissions",
  ];
  if (opts.model) cmd.push("--model", opts.model);
  if (opts.sessionId) cmd.push("--resume", opts.sessionId);
  // §3.1 注入 Zero 上下文 MCP（按需回拉更深上下文）；skip-permissions 下工具免确认
  if (opts.mcpConfig) cmd.push("--mcp-config", opts.mcpConfig);

  const proc = Bun.spawn({
    cmd,
    stdin: new TextEncoder().encode(prompt),
    stdout: "pipe",
    stderr: "pipe",
    cwd,
    env: process.env,
  });

  let result: string | undefined;
  let sessionId: string | undefined;
  let model: string | null = null;
  let usage: RunUsage | null = null;
  let isError = false;

  const handleLine = (line: string) => {
    let obj: Record<string, any>;
    try {
      obj = JSON.parse(line);
    } catch {
      return; // 非 JSON 行跳过
    }
    // 捕获最终结果 / 会话 id / 模型
    if (obj.type === "system" && obj.subtype === "init") {
      if (obj.session_id) sessionId ??= obj.session_id;
      if (obj.model) model ??= obj.model;
    }
    if (obj.type === "result") {
      if (typeof obj.result === "string") result = obj.result;
      if (obj.session_id) sessionId = obj.session_id;
      if (obj.is_error) isError = true;
      // 权威成本 + token 用量（claude result 事件）
      const u = (obj.usage ?? {}) as Record<string, any>;
      usage = {
        model,
        costUsd: num(obj.total_cost_usd) ?? null,
        inputTokens: num(u.input_tokens) ?? 0,
        outputTokens: num(u.output_tokens) ?? 0,
        cacheReadTokens: num(u.cache_read_input_tokens) ?? 0,
        cacheWriteTokens: num(u.cache_creation_input_tokens) ?? 0,
        durationMs: num(obj.duration_ms) ?? null,
        numTurns: num(obj.num_turns) ?? null,
      };
    }
    for (const e of claudeAdapter(obj)) {
      reporter.push(e);
    }
  };

  // 逐行读 stdout（stream-json 为换行分隔的 JSON）
  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();
  const stderrPromise = new Response(proc.stderr).text();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) handleLine(line);
    }
  }
  if (buffer.trim()) handleLine(buffer.trim());

  const [stderr, code] = await Promise.all([stderrPromise, proc.exited]);

  if (code !== 0 || isError) {
    const detail =
      (result && result.trim()) || stderr.trim() || `${bin} exited ${code}`;
    console.error(`${bin} 失败 (exit ${code}): ${detail.slice(0, 400)}`);
    return {
      ok: false,
      result,
      sessionId,
      error: String(detail).slice(0, 800),
      usage,
    };
  }
  return { ok: true, result: result ?? "", sessionId, usage };
}

// ---- 通用 runner 协议 + 多 provider 分发 ----

interface RunResult {
  ok: boolean;
  result?: string;
  sessionId?: string;
  error?: string;
  usage?: RunUsage | null;
}
type RunOpts = {
  model?: string | null;
  sessionId?: string | null;
  mcpConfig?: string;
};
type Runner = (
  prompt: string,
  cwd: string,
  opts: RunOpts,
  reporter: Reporter,
) => Promise<RunResult>;

// 逐行读取子进程 stdout 的换行分隔 JSON（codex/opencode 都是 JSONL）
async function readJsonLines(
  stdout: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  const reader = stdout.getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onLine(line);
    }
  }
  if (buffer.trim()) onLine(buffer.trim());
}

// 跑 Codex（无头，流式）：`codex exec --json`。stdin 必须关（否则卡在读 stdin）。
// 需联网（走 ChatGPT 后端，daemon 须带代理 env 启动）；会话续接走 `exec resume <id>`。
async function runCodex(
  prompt: string,
  cwd: string,
  opts: RunOpts,
  reporter: Reporter,
): Promise<RunResult> {
  const cmd = ["codex", "exec", "--json", "--dangerously-bypass-approvals-and-sandbox"];
  if (opts.model) cmd.push("-m", opts.model);
  if (opts.sessionId) cmd.push("resume", opts.sessionId);
  cmd.push(prompt);

  const proc = Bun.spawn({
    cmd,
    stdin: "ignore", // 关键：codex 见非 TTY stdin 会等待读取而卡死
    stdout: "pipe",
    stderr: "pipe",
    cwd,
    env: process.env, // 透传代理等 env
  });

  let result = "";
  let sessionId: string | undefined;
  let usage: RunUsage | null = null;
  let fatal = false;
  let errMsg: string | undefined;
  const model = opts.model ?? null;

  await readJsonLines(proc.stdout, (line) => {
    let o: Record<string, any>;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    if (o.type === "thread.started" && o.thread_id) sessionId ??= o.thread_id;
    if (o.type === "turn.failed") {
      fatal = true;
      errMsg = o.error?.message ?? "codex turn failed";
    }
    if (o.type === "item.completed" || o.type === "item.updated") {
      const it = (o.item ?? {}) as Record<string, any>;
      const t = String(it.type ?? it.item_type ?? "");
      if (/agent.?message|assistant|message/i.test(t)) {
        const txt = asText(it.text ?? it.message ?? it.content);
        if (txt.trim()) result = txt;
      }
    }
    if (o.type === "turn.completed") {
      const u = (o.usage ?? o.turn?.usage ?? {}) as Record<string, any>;
      usage = {
        model,
        costUsd: null, // codex 经 ChatGPT 订阅，无单价
        inputTokens: num(u.input_tokens ?? u.input ?? u.prompt_tokens) ?? 0,
        outputTokens: num(u.output_tokens ?? u.output ?? u.completion_tokens) ?? 0,
        cacheReadTokens: num(u.cache_read_tokens ?? u.cache_read_input_tokens) ?? 0,
        cacheWriteTokens:
          num(u.cache_write_tokens ?? u.cache_creation_input_tokens) ?? 0,
        durationMs: null,
        numTurns: null,
      };
    }
    for (const e of codexAdapter(o)) reporter.push(e);
  });

  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 || fatal) {
    const detail = errMsg || stderr.trim() || `codex exited ${code}`;
    console.error(`codex 失败 (exit ${code}): ${detail.slice(0, 400)}`);
    return { ok: false, result, sessionId, error: String(detail).slice(0, 800), usage };
  }
  return { ok: true, result, sessionId, usage };
}

// 跑 OpenCode（无头，流式）：`opencode run --format json`。prompt 作末尾参数。
// 会话续接走 `-s <id>`；用量（tokens + 真实 cost）来自 step_finish。
async function runOpenCode(
  prompt: string,
  cwd: string,
  opts: RunOpts,
  reporter: Reporter,
): Promise<RunResult> {
  const cmd = ["opencode", "run", "--format", "json", "--dangerously-skip-permissions"];
  if (opts.model) cmd.push("-m", opts.model);
  if (opts.sessionId) cmd.push("-s", opts.sessionId);
  cmd.push(prompt);

  const proc = Bun.spawn({
    cmd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    cwd,
    env: { ...process.env, OPENCODE_PERMISSION: '{"*":"allow"}' },
  });

  let result = "";
  let sessionId: string | undefined;
  let sawError = false;
  let errMsg: string | undefined;
  let hasUsage = false;
  const model = opts.model ?? null;
  const usage: RunUsage = {
    model,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    durationMs: null,
    numTurns: null,
  };

  await readJsonLines(proc.stdout, (line) => {
    let o: Record<string, any>;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    if (o.sessionID) sessionId = o.sessionID;
    if (o.type === "text" && typeof o.part?.text === "string") {
      result += o.part.text;
    }
    if (o.type === "step_finish" && o.part) {
      const t = (o.part.tokens ?? {}) as Record<string, any>;
      hasUsage = true;
      usage.inputTokens += num(t.input) ?? 0;
      // reasoning（推理 token）也是生成出来的、按 output 计费 → 并入 output，
      // 使 input+output+cache 与 opencode 报的 total 对齐（否则漏掉 reasoning）。
      usage.outputTokens += (num(t.output) ?? 0) + (num(t.reasoning) ?? 0);
      usage.cacheReadTokens += num(t.cache?.read) ?? 0;
      usage.cacheWriteTokens += num(t.cache?.write) ?? 0;
      usage.costUsd = (usage.costUsd ?? 0) + (num(o.part.cost) ?? 0);
    }
    if (o.type === "error") {
      sawError = true;
      errMsg = o.error?.data?.message ?? o.error?.message ?? "opencode error";
    }
    for (const e of opencodeAdapter(o)) reporter.push(e);
  });

  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const finalUsage = hasUsage ? usage : null;
  // opencode 出错也可能 exit 0 → 以 error 事件为准
  if (code !== 0 || sawError) {
    const detail = errMsg || stderr.trim() || `opencode exited ${code}`;
    console.error(`opencode 失败 (exit ${code}): ${detail.slice(0, 400)}`);
    return {
      ok: false,
      result: result.trim(),
      sessionId,
      error: String(detail).slice(0, 800),
      usage: finalUsage,
    };
  }
  return { ok: true, result: result.trim(), sessionId, usage: finalUsage };
}

// Claude 系两个 CLI 共用 runClaudeLike，只换二进制名
const runClaude: Runner = (prompt, cwd, opts, reporter) =>
  runClaudeLike("claude", prompt, cwd, opts, reporter);
const runCodebuddy: Runner = (prompt, cwd, opts, reporter) =>
  runClaudeLike("codebuddy", prompt, cwd, opts, reporter);

// 跑 Kimi CLI（无头，流式）：`kimi --print --output-format stream-json`。
// 事件为 OpenAI-chat 风格逐条消息（见 kimi-adapter）。stdin 关闭防卡。
// 会话续接走 `-r <id>`；sessionId 不在 stdout —— 从 stderr「kimi -r <id>」抓。
// 鉴权读 ~/.kimi/config.toml（用户预先 kimi login / 配 key）；此模式不吐 usage。
async function runKimi(
  prompt: string,
  cwd: string,
  opts: RunOpts,
  reporter: Reporter,
): Promise<RunResult> {
  const cmd = ["kimi", "--print", "--output-format", "stream-json", "-y"];
  if (opts.model) cmd.push("-m", opts.model);
  if (opts.sessionId) cmd.push("-r", opts.sessionId);
  cmd.push("-p", prompt);

  const proc = Bun.spawn({
    cmd,
    stdin: "ignore", // 关键：避免 kimi 等待读 stdin
    stdout: "pipe",
    stderr: "pipe",
    cwd,
    env: process.env,
  });

  let result = "";
  await readJsonLines(proc.stdout, (line) => {
    let o: Record<string, any>;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    // 末条 assistant 字符串 content = 最终回答
    if (
      o.role === "assistant" &&
      typeof o.content === "string" &&
      o.content.trim()
    ) {
      result = o.content;
    }
    for (const e of kimiAdapter(o)) reporter.push(e);
  });

  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // sessionId 在 stderr："To resume this session: kimi -r <uuid>"
  const sessionId = stderr.match(/kimi -r ([0-9a-fA-F-]{36})/)?.[1];
  if (code !== 0) {
    const detail = stderr.trim() || `kimi exited ${code}`;
    console.error(`kimi 失败 (exit ${code}): ${detail.slice(0, 400)}`);
    return {
      ok: false,
      result: result.trim(),
      sessionId,
      error: String(detail).slice(0, 800),
      usage: null, // kimi print 模式不吐 usage
    };
  }
  return { ok: true, result: result.trim(), sessionId, usage: null };
}

// provider → runner + 续接失败特征（用于回退新会话）+ 是否注入 MCP 上下文
const PROVIDERS: Record<
  string,
  { runner: Runner; sessionInvalid: RegExp; mcp: boolean }
> = {
  claude_code: {
    runner: runClaude,
    sessionInvalid: /no conversation found|session id/i,
    mcp: true,
  },
  codex: {
    runner: runCodex,
    sessionInvalid: /thread|session|resume|not found/i,
    mcp: false,
  },
  opencode: {
    runner: runOpenCode,
    sessionInvalid: /session|not found/i,
    mcp: false,
  },
  // CodeBuddy（腾讯）是 Claude Code 衍生版：stream-json / 续接 / MCP 全同构，
  // 直接复用 claudeAdapter 与 runClaudeLike。网关在 www.codebuddy.ai，无需代理。
  codebuddy: {
    runner: runCodebuddy,
    sessionInvalid: /no conversation found|session id/i,
    mcp: true,
  },
  // Kimi CLI（Moonshot）：OpenAI-chat 风格 stream-json，独立 kimiAdapter；
  // sessionId 从 stderr 抓、鉴权读 ~/.kimi 配置；暂不注入 MCP（与 codex/opencode 一致）。
  kimi: {
    runner: runKimi,
    sessionInvalid: /session|not found|resume|无效|不存在/i,
    mcp: false,
  },
};

// 运行时级并发：同时最多跑 maxConcurrency 个任务（由服务端 hello/heartbeat 下发）
let running = 0;
let maxConcurrency = 1;
let pumping = false;

// 认领循环：在空闲槽位内尽量多领任务并行执行；领空或满槽即停。
async function pump(server: string, token: string) {
  if (pumping) return; // 防止 interval 与 slot 释放重入造成超额认领
  pumping = true;
  try {
    while (running < maxConcurrency) {
      let claim: Claim;
      try {
        claim = await post<Claim>(server, token, "/daemon/tasks/claim", {});
      } catch (err) {
        console.error(`认领失败：${(err as Error).message}`);
        break;
      }
      if (!claim.task) break; // 没有排队任务了
      running++;
      // 不 await：并行执行；槽位在完成后释放并尝试再填
      void executeClaim(server, token, claim).finally(() => {
        running--;
        void pump(server, token);
      });
    }
  } finally {
    pumping = false;
  }
}

// 执行单个已认领的任务（不管并发槽位，由 pump 负责）
async function executeClaim(server: string, token: string, claim: Claim) {
  const taskId = claim.task!.id;
  const issueId = claim.task!.issueId;
  const priorSession = claim.task!.sessionId;
  const title = claim.context?.issue.title ?? "";
  console.log(`认领任务 ${taskId}（${title}）· 在跑 ${running}/${maxConcurrency}`);
  try {
    // 按 agent.provider 选 runner（claude_code / codex / opencode）
    const provider = claim.agent?.provider ?? "";
    const spec = PROVIDERS[provider];
    if (!spec) {
      await post(server, token, `/daemon/tasks/${taskId}/fail`, {
        error: `provider ${provider || "(空)"} 暂未支持（支持 claude_code / codex / opencode / codebuddy / kimi）`,
      });
      return;
    }
    // 准备工作目录（仓库→worktree / 工作目录→就地 / 空目录）；按 issue 固定保证会话可续
    let cwd: string;
    try {
      cwd = await prepareWorkdir(
        claim.context?.work ?? { mode: "empty" },
        issueId,
      );
    } catch (err) {
      await post(server, token, `/daemon/tasks/${taskId}/fail`, {
        error: `准备工作目录失败：${(err as Error).message}`,
      });
      return;
    }
    // 变更可视化：拍 run 开始的快照基线（非 git 目录返回 null，结束时据此 diff 出本次改动）
    const baselineSha = await snapshotRef(cwd).catch(() => null);
    const model = claim.agent?.model ?? null;
    // MCP 仅 claude（按需回拉更深上下文）；codex/opencode 走 prompt 内推送的上下文
    const mcpConfig = spec.mcp
      ? writeMcpConfig(server, token, issueId, taskId)
      : undefined;
    // 物化挂载的技能进 worktree（Claude Code 从 .claude/skills 自动发现）；best-effort，不阻断
    try {
      const n = await materializeSkills(cwd, claim.agent?.skills ?? []);
      if (n) console.log(`物化 ${n} 个技能 → ${cwd}/.claude/skills`);
    } catch (err) {
      console.error(`物化技能失败（忽略继续）：${(err as Error).message}`);
    }
    // 附件：小文件落盘到 .zero/attachments/、大文件留签名 URL（小推大拉）；best-effort
    let resolvedAtts: ResolvedAttachment[] = [];
    try {
      resolvedAtts = await materializeAttachments(
        server,
        cwd,
        claim.context?.attachments ?? [],
      );
      const dl = resolvedAtts.filter((a) => !a.big).length;
      if (resolvedAtts.length)
        console.log(
          `附件：落盘 ${dl}、懒取 ${resolvedAtts.length - dl} → ${cwd}/.zero/attachments`,
        );
    } catch (err) {
      console.error(`物化附件失败（忽略继续）：${(err as Error).message}`);
    }
    // 实时上报执行流（reporter 拥有单调 seq，跨重跑连续，不与回退冲突）
    const reporter = makeReporter(async (events) => {
      await post(server, token, `/daemon/tasks/${taskId}/events`, { events });
    });
    // 续接会话 → 只推增量评论（full=false）；新会话首跑 → 全量（full=true）
    let r = await spec.runner(
      buildPrompt(claim, { full: !priorSession, attachments: resolvedAtts }),
      cwd,
      { model, sessionId: priorSession, mcpConfig },
      reporter,
    );
    let usage = r.usage ?? null;
    // 会话失效（换目录/过期/被删）→ 新会话重跑：必须用全量 prompt（新会话无记忆），否则失忆
    if (!r.ok && priorSession && spec.sessionInvalid.test(r.error ?? "")) {
      console.log(`会话 ${priorSession} 失效，改用新会话重跑（全量上下文）`);
      r = await spec.runner(
        buildPrompt(claim, { full: true, attachments: resolvedAtts }),
        cwd,
        { model, mcpConfig },
        reporter,
      );
      usage = mergeUsage(usage, r.usage ?? null); // 累计两次执行成本
    }
    await reporter.flush(); // 收尾，确保尾部事件全部送达
    if (r.ok) {
      // 变更可视化：算本次运行的 git 改动（best-effort，不阻断完成）
      const changes = baselineSha
        ? await captureChanges(cwd, baselineSha).catch((err) => {
            console.error(`抓取变更失败（忽略）：${(err as Error).message}`);
            return null;
          })
        : null;
      await post(server, token, `/daemon/tasks/${taskId}/complete`, {
        summary: r.result,
        sessionId: r.sessionId,
        changes,
        usage, // 权威成本/token → 服务端落 task_usage
      });
      console.log(`任务 ${taskId} 完成`);
    } else {
      await post(server, token, `/daemon/tasks/${taskId}/fail`, {
        error: r.error,
      });
      console.log(`任务 ${taskId} 失败：${r.error}`);
    }
  } catch (err) {
    try {
      await post(server, token, `/daemon/tasks/${taskId}/fail`, {
        error: (err as Error).message,
      });
    } catch {
      /* 上报失败也忽略 */
    }
  }
}

// 前台 worker：连服务端 + 心跳 + 认领执行。忽略 SIGHUP，关终端不退
async function worker() {
  process.on("SIGHUP", () => {});
  ensureDir(WORK_DIR);
  installZeroBg(); // 装好 agent 用的后台启动器（zero_watch_pid 依赖它跨 run 存活）
  const { server, token } = requireConn();
  const caps = discover();
  console.log(`[${new Date().toISOString()}] Zero daemon → ${server}`);
  console.log(`发现工具：${enabled(caps)}`);

  let info: {
    runtimeId: string;
    workspaceId: string;
    name: string;
    maxConcurrency?: number;
  };
  try {
    info = await post(server, token, "/daemon/hello", { capabilities: caps });
  } catch (err) {
    console.error(`连接失败：${(err as Error).message}`);
    process.exit(1);
  }
  if (typeof info.maxConcurrency === "number" && info.maxConcurrency >= 1) {
    maxConcurrency = info.maxConcurrency;
  }
  console.log(
    `已连接：${info.name}（runtime ${info.runtimeId}）· 并发上限 ${maxConcurrency}`,
  );

  startPicker(); // 本地文件夹选择器

  const hb = setInterval(async () => {
    try {
      // 心跳响应回带最新并发上限（用户在 Web 改了即时生效）
      const res = await post<{ maxConcurrency?: number }>(
        server,
        token,
        "/daemon/heartbeat",
        { capabilities: discover() },
      );
      if (typeof res.maxConcurrency === "number" && res.maxConcurrency >= 1) {
        maxConcurrency = res.maxConcurrency;
      }
    } catch (err) {
      console.error(`心跳失败：${(err as Error).message}`);
    }
  }, HEARTBEAT_MS);

  const claimer = setInterval(() => void pump(server, token), CLAIM_MS);

  // 进程看护（自触发续跑）：探本机被看护 pid 的存活，已死的上报服务端点燃续跑，
  // 并用服务端回传的 pending 列表刷新本地。看护登记由 agent 经 MCP zero_watch_pid 完成。
  let watchPids = new Map<string, number>(); // wakeupId -> pid
  const watcher = setInterval(async () => {
    try {
      const dead: string[] = [];
      for (const [id, pid] of watchPids) if (!pidAlive(pid)) dead.push(id);
      const res = await post<{ watches: { id: string; pid: number | null }[] }>(
        server,
        token,
        "/daemon/watches/sync",
        { dead },
      );
      watchPids = new Map(
        res.watches
          .filter((w) => typeof w.pid === "number")
          .map((w) => [w.id, w.pid as number]),
      );
    } catch {
      /* 网络抖动忽略，下一轮再来 */
    }
  }, WATCH_MS);

  const shutdown = () => {
    clearInterval(hb);
    clearInterval(claimer);
    clearInterval(watcher);
    console.log(`[${new Date().toISOString()}] 已停止。`);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// ---- 进程生命周期 ----

function start() {
  ensureDir(ZERO_DIR);
  const existing = readPid();
  if (existing != null && pidAlive(existing)) {
    console.log(`daemon 已在运行（pid ${existing}）。重启请先 stop。`);
    return;
  }
  const { server, token } = requireConn();
  const out = openSync(LOG_FILE, "a");
  const scriptPath = import.meta.path;
  const cmd = existsSync(scriptPath)
    ? [process.execPath, scriptPath, "run", "--server", server, "--token", token]
    : [process.execPath, "run", "--server", server, "--token", token];

  const child = Bun.spawn({
    cmd,
    stdout: out,
    stderr: out,
    stdin: "ignore",
    env: { ...process.env },
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  console.log(`已在后台启动（pid ${child.pid}）`);
  console.log(`日志：${LOG_FILE}`);
  console.log(`查看状态：zero-daemon status　停止：zero-daemon stop`);
}

function stop() {
  const pid = readPid();
  if (pid == null) {
    console.log("daemon 未在运行。");
    return;
  }
  if (pidAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* 已退出 */
    }
    console.log(`已停止 daemon（pid ${pid}）。`);
  } else {
    console.log("daemon 未在运行（清理残留 pid 文件）。");
  }
  try {
    rmSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

function status() {
  const pid = readPid();
  if (pid != null && pidAlive(pid)) {
    console.log(`运行中（pid ${pid}）　日志：${LOG_FILE}`);
    return;
  }
  if (pid != null) {
    try {
      rmSync(PID_FILE);
    } catch {
      /* ignore */
    }
  }
  console.log("未运行。");
}

// 仅作为 CLI 直接执行时跑分发；被 import（如单测 buildPrompt）时不触发启动
if (import.meta.main) {
  const SUBS = ["start", "stop", "status", "run"];
  const raw = process.argv[2] ?? "";
  const sub = SUBS.includes(raw) ? raw : "start";

  if (sub === "stop") stop();
  else if (sub === "status") status();
  else if (sub === "run") await worker();
  else start();
}
