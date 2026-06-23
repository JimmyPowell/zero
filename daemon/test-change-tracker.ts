// 变更可视化 e2e：用真临时目录驱动 daemon 导出的 captureBaseline/captureChanges。
// 覆盖 4 种工作模式 + 脏树污染 + 强制纯 JS 引擎。运行：bun run test-change-tracker.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { captureBaseline, captureChanges } from "./src/index.ts";

let fails = 0;
let id = 0;
const nextId = () => `e2e-${Date.now()}-${id++}`;

function ok(cond: boolean, msg: string) {
  console.log(`  ${cond ? "✅" : "❌"} ${msg}`);
  if (!cond) fails++;
}
function tmp(): string {
  return mkdtempSync(join(tmpdir(), "zero-ct-"));
}
function sh(cmd: string[], cwd: string) {
  const r = Bun.spawnSync({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0)
    throw new Error(`${cmd.join(" ")} 失败：${r.stderr.toString()}`);
}
function gitInit(cwd: string) {
  sh(["git", "init", "-q"], cwd);
  sh(["git", "config", "user.email", "t@t"], cwd);
  sh(["git", "config", "user.name", "t"], cwd);
}
function commit(cwd: string) {
  sh(["git", "add", "-A"], cwd);
  sh(["git", "commit", "-qm", "x"], cwd);
}
type FC = NonNullable<Awaited<ReturnType<typeof captureChanges>>>["files"][number];
function byPath(cs: { files: FC[] } | null): Map<string, FC> {
  const m = new Map<string, FC>();
  for (const f of cs?.files ?? []) m.set(f.path, f);
  return m;
}

// ── S1：git 仓库（模式②③，干净基线）—— 增/改/删/改名/二进制 ──
async function s1() {
  console.log("\n[S1] git 仓库：增/改/删/改名/二进制");
  const d = tmp();
  gitInit(d);
  writeFileSync(join(d, "a.txt"), "a1\na2\na3\n");
  writeFileSync(join(d, "keep.txt"), "k\n");
  writeFileSync(join(d, "old.txt"), "r1\nr2\nr3\nr4\nr5\n");
  writeFileSync(join(d, "img.bin"), Buffer.from([0, 1, 2, 0, 3, 255, 0]));
  commit(d);

  const base = await captureBaseline(d, nextId());
  ok(base?.engine === "git", "引擎=git");

  // 模拟 agent：改 a、删 keep、改名 old→new(+内容)、加 added、改二进制
  writeFileSync(join(d, "a.txt"), "a1\na2\na3\nA4\n");
  rmSync(join(d, "keep.txt"));
  rmSync(join(d, "old.txt"));
  writeFileSync(join(d, "new.txt"), "r1\nr2\nr3\nr4\nr5\nR6\n");
  writeFileSync(join(d, "added.txt"), "new file\n");
  writeFileSync(join(d, "img.bin"), Buffer.from([0, 9, 9, 0, 9, 1, 0, 2]));

  const cs = await captureChanges(d, base!);
  const m = byPath(cs);
  ok(m.get("a.txt")?.status === "modified" && m.get("a.txt")?.additions === 1, "a.txt 改 +1");
  ok(m.get("added.txt")?.status === "added", "added.txt 新增");
  ok(m.get("keep.txt")?.status === "deleted", "keep.txt 删除");
  const nw = m.get("new.txt");
  ok(nw?.status === "renamed" && nw?.oldPath === "old.txt", "old.txt→new.txt 改名(带 oldPath)");
  ok(!!m.get("a.txt")?.patch && !!m.get("added.txt")?.patch, "文本文件有 patch");
  ok(m.get("img.bin")?.isBinary === true && !m.get("img.bin")?.patch, "二进制识别且无 patch");
  ok(!!cs?.baselineSha && !!cs?.headSha, "baselineSha/headSha 非空");
  rmSync(d, { recursive: true, force: true });
}

// ── S2：脏 git 仓库（模式④）—— run 前的脏改动不得算进本次 ──
async function s2() {
  console.log("\n[S2] 脏 git 仓库：脏树污染必须被隔离");
  const d = tmp();
  gitInit(d);
  writeFileSync(join(d, "tracked.txt"), "l1\nl2\n");
  commit(d);
  // run 之前就存在的脏改动（不该出现在本次 diff）
  writeFileSync(join(d, "tracked.txt"), "l1\nPRE_DIRTY\nl2\n");
  writeFileSync(join(d, "preexist.txt"), "was here before run\n");

  const base = await captureBaseline(d, nextId()); // 基线 = 含脏态的当前磁盘

  // agent 本次只加一个文件
  writeFileSync(join(d, "agent.txt"), "by agent\n");

  const cs = await captureChanges(d, base!);
  const m = byPath(cs);
  ok(m.has("agent.txt"), "本次新增 agent.txt 出现");
  ok(!m.has("tracked.txt"), "run 前的脏修改 tracked.txt 不出现");
  ok(!m.has("preexist.txt"), "run 前的脏新增 preexist.txt 不出现");
  ok(cs?.filesChanged === 1, "本次仅 1 个变更文件");
  rmSync(d, { recursive: true, force: true });
}

// ── S3：空/非 git 目录（模式①、④非仓库）—— 影子库引擎 ──
async function s3() {
  console.log("\n[S3] 非 git 目录：影子库引擎，node_modules 排除，用户目录不出现 .git");
  const d = tmp();
  writeFileSync(join(d, "README.md"), "hello\n");

  const base = await captureBaseline(d, nextId());
  ok(base?.engine === "git", "引擎=git(影子库)");
  ok(base?.engine === "git" && base.gitDir != null, "走的是 shadow gitDir");

  mkdirSync(join(d, "src"));
  writeFileSync(join(d, "src/index.ts"), "export const x = 1\n");
  writeFileSync(join(d, "README.md"), "hello\nworld\n");
  mkdirSync(join(d, "node_modules"));
  writeFileSync(join(d, "node_modules/junk.js"), "junk\n");

  const cs = await captureChanges(d, base!);
  const m = byPath(cs);
  ok(m.get("README.md")?.status === "modified", "README 改");
  ok(m.get("src/index.ts")?.status === "added", "src/index.ts 新增");
  ok(![...m.keys()].some((p) => p.includes("node_modules")), "node_modules 被排除");
  ok(!existsSync(join(d, ".git")), "用户目录里没有被塞 .git");
  rmSync(d, { recursive: true, force: true });
}

// ── S4：纯 JS 引擎（强制 ZERO_DIFF_ENGINE=js）—— 无 git 也能出 diff ──
async function s4() {
  console.log("\n[S4] 纯 JS 引擎（强制）：增/改/删 + patch + ±行 + node_modules 排除");
  process.env.ZERO_DIFF_ENGINE = "js";
  try {
    const d = tmp();
    writeFileSync(join(d, "mod.txt"), "m1\nm2\nm3\n");
    writeFileSync(join(d, "del.txt"), "bye\n");

    const base = await captureBaseline(d, nextId());
    ok(base?.engine === "js", "引擎=js");

    writeFileSync(join(d, "mod.txt"), "m1\nM2\nm3\nM4\n"); // 改 1 行 + 加 1 行
    rmSync(join(d, "del.txt"));
    writeFileSync(join(d, "add.txt"), "n1\nn2\n");
    mkdirSync(join(d, "node_modules"));
    writeFileSync(join(d, "node_modules/junk.js"), "junk\n");

    const cs = await captureChanges(d, base!);
    const m = byPath(cs);
    ok(m.get("add.txt")?.status === "added" && m.get("add.txt")?.additions === 2, "add.txt 新增 +2");
    ok(m.get("del.txt")?.status === "deleted" && m.get("del.txt")?.deletions === 1, "del.txt 删除 -1");
    const mod = m.get("mod.txt");
    ok(mod?.status === "modified" && (mod?.additions ?? 0) >= 1 && !!mod?.patch, "mod.txt 改且有 patch+计数");
    ok(![...m.keys()].some((p) => p.includes("node_modules")), "node_modules 被排除");
    rmSync(d, { recursive: true, force: true });
  } finally {
    delete process.env.ZERO_DIFF_ENGINE;
  }
}

console.log("=== 变更可视化 ChangeTracker e2e ===");
await s1();
await s2();
await s3();
await s4();
console.log(`\n=== ${fails === 0 ? "全部通过 ✅" : `${fails} 处失败 ❌`} ===`);
process.exit(fails === 0 ? 0 : 1);
