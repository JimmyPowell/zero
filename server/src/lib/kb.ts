// 知识库 git 模块：每个工作空间一个 git 仓库（server 自管，markdown 真相源），
// 文档落盘 + commit；kb_doc 表只做索引 / 检索。server 首次具备「git 仓库管理」能力。
import { join, resolve, sep } from "path";
import { existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";

import { config } from "@/config";
import { db, schema } from "@/db";

const KB_ROOT = config.kbDir || join(process.cwd(), "data", "kb");

function repoPath(workspaceId: string): string {
  return join(KB_ROOT, workspaceId);
}

async function git(args: string[], cwd: string) {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, out: out.trim(), err: err.trim() };
}

// 确保工作空间 git 仓库存在（首次 init + 初始 commit）
async function ensureRepo(workspaceId: string): Promise<string> {
  const dir = repoPath(workspaceId);
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true });
    await git(["init", "-q", "-b", "main"], dir);
    await git(["config", "user.email", "kb@zero.local"], dir);
    await git(["config", "user.name", "Zero KB"], dir);
    await Bun.write(join(dir, "README.md"), "# 团队知识库\n\n由 Zero 管理。\n");
    await git(["add", "README.md"], dir);
    await git(["commit", "-q", "-m", "init kb"], dir);
  }
  return dir;
}

// 路径安全：相对、无穿越、不碰 .git、必须 .md
function safeRel(dir: string, rel: string): string {
  const clean = rel
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
  if (
    !clean ||
    clean.includes("..") ||
    clean.startsWith(".git") ||
    clean.includes("\0")
  )
    throw new Error("非法路径");
  if (!clean.toLowerCase().endsWith(".md")) throw new Error("只支持 .md 文档");
  const abs = resolve(dir, clean);
  if (abs !== dir && !abs.startsWith(dir + sep)) throw new Error("路径越界");
  return clean;
}

function titleOf(content: string, rel: string): string {
  const m = content.match(/^\s*#\s+(.+?)\s*$/m);
  return (m?.[1] ?? rel.split("/").pop() ?? rel).slice(0, 500);
}

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export interface WriteDocInput {
  workspaceId: string;
  path: string;
  content: string;
  projectId?: string | null;
  pinned?: boolean;
  author?: string | null;
}

// 写入 / 更新文档：落盘 + commit + upsert kb_doc。返回 kb_doc id。
export async function writeDoc(input: WriteDocInput): Promise<string> {
  const dir = await ensureRepo(input.workspaceId);
  const rel = safeRel(dir, input.path);
  const abs = join(dir, rel);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  await Bun.write(abs, input.content);
  await git(["add", "--", rel], dir);
  // 内容没变时 commit 会失败（nothing to commit）→ 忽略，索引仍更新
  await git(["commit", "-q", "-m", `kb: 更新 ${rel}`], dir);

  const scope = input.projectId ? "project" : "workspace";
  const title = titleOf(input.content, rel);
  const hash = sha(input.content);
  const [existing] = await db
    .select({ id: schema.kbDoc.id })
    .from(schema.kbDoc)
    .where(
      and(
        eq(schema.kbDoc.workspaceId, input.workspaceId),
        eq(schema.kbDoc.path, rel),
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .update(schema.kbDoc)
      .set({
        projectId: input.projectId ?? null,
        scope,
        title,
        pinned: input.pinned ?? false,
        contentHash: hash,
        updatedBy: input.author ?? null,
      })
      .where(eq(schema.kbDoc.id, existing.id));
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db.insert(schema.kbDoc).values({
    id,
    workspaceId: input.workspaceId,
    projectId: input.projectId ?? null,
    scope,
    path: rel,
    title,
    pinned: input.pinned ?? false,
    contentHash: hash,
    updatedBy: input.author ?? null,
  });
  return id;
}

// 读文档内容（从 git 工作树）。不存在返回 null。
export async function readDoc(
  workspaceId: string,
  path: string,
): Promise<string | null> {
  const dir = repoPath(workspaceId);
  if (!existsSync(join(dir, ".git"))) return null;
  const rel = safeRel(dir, path);
  const file = Bun.file(join(dir, rel));
  if (!(await file.exists())) return null;
  return file.text();
}

// 删文档：删索引 + rm + commit
export async function deleteDoc(
  workspaceId: string,
  path: string,
): Promise<boolean> {
  const dir = repoPath(workspaceId);
  const rel = safeRel(dir, path);
  await db
    .delete(schema.kbDoc)
    .where(
      and(eq(schema.kbDoc.workspaceId, workspaceId), eq(schema.kbDoc.path, rel)),
    );
  if (!existsSync(join(dir, rel))) return false;
  await git(["rm", "-q", "--", rel], dir);
  await git(["commit", "-q", "-m", `kb: 删除 ${rel}`], dir);
  return true;
}

// 列文档（索引）。projectId 给定 → 只列该项目；否则列整个工作空间。
export async function listDocs(workspaceId: string, projectId?: string | null) {
  const where =
    projectId != null
      ? and(
          eq(schema.kbDoc.workspaceId, workspaceId),
          eq(schema.kbDoc.projectId, projectId),
        )
      : eq(schema.kbDoc.workspaceId, workspaceId);
  return db.select().from(schema.kbDoc).where(where).orderBy(schema.kbDoc.path);
}

// Tier-0 注入：取常驻(pinned)文档正文 —— 工作空间级全要 + 给定项目级。
// 供 assembleContext 拼进 agent 上下文（每次跑任务常驻可见）。
export async function getPinnedKnowledge(
  workspaceId: string,
  projectId?: string | null,
): Promise<{ path: string; title: string | null; content: string }[]> {
  const rows = await db
    .select()
    .from(schema.kbDoc)
    .where(
      and(
        eq(schema.kbDoc.workspaceId, workspaceId),
        eq(schema.kbDoc.pinned, true),
      ),
    )
    .orderBy(schema.kbDoc.scope, schema.kbDoc.path);
  const out: { path: string; title: string | null; content: string }[] = [];
  for (const r of rows) {
    // 工作空间级全要；项目级仅当属于当前 issue 的项目
    if (r.scope === "project" && r.projectId !== (projectId ?? null)) continue;
    const content = await readDoc(workspaceId, r.path).catch(() => null);
    if (content != null) out.push({ path: r.path, title: r.title, content });
  }
  return out;
}
