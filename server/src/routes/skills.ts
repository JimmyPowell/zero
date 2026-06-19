import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, ne, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { requireAuth } from "@/middleware/auth";
import {
  requireWorkspaceMember,
  type WorkspaceEnv,
} from "@/middleware/workspace";

// ---- 工具 ----

// sha256 十六进制（正文 + 附件指纹，用于派发快照 / 版本锁定）
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 跨 provider 安全的 kebab 标识（纯 ASCII，作目录名 / SKILL.md frontmatter name）
function skillSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// 在工作空间已有 slug 集合内取不冲突的 slug；空名兜底 skill-xxxx
function resolveSlug(base: string, taken: Set<string>): string {
  let b = base || `skill-${crypto.randomUUID().slice(0, 8)}`;
  if (!taken.has(b)) return b;
  let i = 2;
  while (taken.has(`${b}-${i}`)) i++;
  return `${b}-${i}`;
}

type SkillFileInput = { path: string; content: string };

// content + 排序后的附件 → 指纹
async function hashSkill(
  content: string | null,
  files: SkillFileInput[],
): Promise<string> {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  return sha256Hex(
    JSON.stringify({ content: content ?? "", files: sorted }),
  );
}

// SKILL.md frontmatter 解析（--- ... --- + 正文）
function parseFrontmatter(md: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { body: md };
  const fm = m[1];
  const body = md.slice(m[0].length);
  const get = (k: string): string | undefined => {
    const r = new RegExp(`^${k}\\s*:\\s*(.+)$`, "im").exec(fm);
    return r ? r[1].trim().replace(/^["']|["']$/g, "") : undefined;
  };
  return { name: get("name"), description: get("description"), body };
}

// ---- GitHub 导入 ----

// 解析 github 链接 → { owner, repo, ref, dir }（dir 为含 SKILL.md 的目录，可为空=根）
function parseGitHubTarget(
  raw: string,
): { owner: string; repo: string; ref: string; dir: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  const stripSkill = (segs: string[]) =>
    segs.length && /^skill\.md$/i.test(segs[segs.length - 1])
      ? segs.slice(0, -1)
      : segs;

  if (host === "raw.githubusercontent.com") {
    // raw/<owner>/<repo>/<ref>/<path...>
    if (parts.length < 3) return null;
    const [owner, repo, ref, ...rest] = parts;
    return { owner, repo, ref, dir: stripSkill(rest).join("/") };
  }
  if (host === "github.com" || host === "www.github.com") {
    if (parts.length < 2) return null;
    const [owner, repo, kind, ref, ...rest] = parts;
    if ((kind === "blob" || kind === "tree") && ref) {
      return { owner, repo, ref, dir: stripSkill(rest).join("/") };
    }
    // 裸仓库：默认分支、根目录
    return { owner, repo: repo.replace(/\.git$/, ""), ref: "", dir: "" };
  }
  return null;
}

interface GhContentItem {
  name: string;
  path: string;
  type: string;
  size: number;
  download_url: string | null;
}

// 看起来像二进制（按扩展名）的跳过 —— 第一版只导入文本
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|wasm|woff2?|ttf|mp4|mov|mp3|so|dylib|exe|bin)$/i;

async function gh<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "zero-skill-import",
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `GitHub ${res.status}${res.status === 403 ? "（可能触发匿名限流，稍后再试）" : ""}: ${txt.slice(0, 200)}`,
    );
  }
  return res.json() as Promise<T>;
}

// 从 GitHub 拉一个 skill：找 SKILL.md + 同级文本附件（有界）
async function importFromGitHub(rawUrl: string): Promise<{
  name: string;
  description: string;
  content: string;
  files: SkillFileInput[];
  sourceRef: string;
}> {
  const target = parseGitHubTarget(rawUrl);
  if (!target) throw new Error("无法识别的 GitHub 链接");
  const { owner, repo, ref, dir } = target;
  const refQ = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const listUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dir}${refQ}`;

  const listing = await gh<GhContentItem[] | GhContentItem>(listUrl);
  const items = Array.isArray(listing) ? listing : [listing];
  const skillMd = items.find(
    (i) => i.type === "file" && /^skill\.md$/i.test(i.name),
  );
  if (!skillMd?.download_url)
    throw new Error("该目录下未找到 SKILL.md（请指向含 SKILL.md 的目录）");

  const md = await (await fetch(skillMd.download_url)).text();
  const { name, description, body } = parseFrontmatter(md);

  // 同级文本附件（跳过 SKILL.md 与二进制；有界：≤20 个、单个 ≤256KB）
  const files: SkillFileInput[] = [];
  for (const it of items) {
    if (it.type !== "file") continue;
    if (/^skill\.md$/i.test(it.name)) continue;
    if (BINARY_EXT.test(it.name)) continue;
    if (!it.download_url || it.size > 256 * 1024) continue;
    if (files.length >= 20) break;
    try {
      const text = await (await fetch(it.download_url)).text();
      files.push({ path: it.name, content: text });
    } catch {
      /* 单个文件失败忽略 */
    }
  }

  return {
    name: (name || dir.split("/").pop() || repo).slice(0, 128),
    description: (description || "").slice(0, 1024),
    content: body.trim(),
    files,
    sourceRef: `${owner}/${repo}${dir ? `/${dir}` : ""}${ref ? `@${ref}` : ""}`,
  };
}

// ---- 校验 ----
const createSchema = z.object({
  name: z.string().trim().min(1, "请输入技能名称").max(128),
  description: z.string().trim().min(1, "请填写技能描述（用于按需触发）").max(1024),
  content: z.string().max(200_000).optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
    description: z.string().trim().min(1).max(1024).optional(),
    content: z.string().max(200_000).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "没有要更新的字段");

const importSchema = z.object({
  url: z.string().trim().url("请填写有效的 GitHub 链接"),
});

// ---- 形态 ----
function shape(
  s: schema.Skill,
  extra: { agentCount?: number; fileCount?: number } = {},
) {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    source: s.source,
    sourceRef: s.sourceRef,
    agentCount: extra.agentCount ?? 0,
    fileCount: extra.fileCount ?? 0,
    updatedAt: s.updatedAt,
    createdAt: s.createdAt,
  };
}

async function takenSlugs(workspaceId: string): Promise<Set<string>> {
  const rows = await db
    .select({ slug: schema.skill.slug })
    .from(schema.skill)
    .where(eq(schema.skill.workspaceId, workspaceId));
  return new Set(rows.map((r) => r.slug));
}

async function nameTaken(workspaceId: string, name: string, exceptId?: string) {
  const conds = [
    eq(schema.skill.workspaceId, workspaceId),
    eq(schema.skill.name, name),
  ];
  if (exceptId) conds.push(ne(schema.skill.id, exceptId));
  const rows = await db
    .select({ id: schema.skill.id })
    .from(schema.skill)
    .where(and(...conds))
    .limit(1);
  return rows.length > 0;
}

export const skillRoutes = new Hono<WorkspaceEnv>()
  .use(requireAuth)
  .use(requireWorkspaceMember)
  // 列表（含被几个 agent 用、几个附件）
  .get("/", async (c) => {
    const workspaceId = c.get("workspaceId");
    const rows = await db
      .select({
        s: schema.skill,
        agentCount: sql<number>`(SELECT COUNT(*) FROM ${schema.agentSkill} WHERE ${schema.agentSkill.skillId} = ${schema.skill.id})`,
        fileCount: sql<number>`(SELECT COUNT(*) FROM ${schema.skillFile} WHERE ${schema.skillFile.skillId} = ${schema.skill.id})`,
      })
      .from(schema.skill)
      .where(eq(schema.skill.workspaceId, workspaceId))
      .orderBy(desc(schema.skill.updatedAt));
    return c.json({
      skills: rows.map((r) =>
        shape(r.s, {
          agentCount: Number(r.agentCount ?? 0),
          fileCount: Number(r.fileCount ?? 0),
        }),
      ),
    });
  })
  // 创建（手动新建）
  .post("/", zValidator("json", createSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("user").sub;
    const body = c.req.valid("json");

    if (await nameTaken(workspaceId, body.name)) {
      return c.json({ error: "该技能名已被占用" }, 409);
    }
    const slug = resolveSlug(skillSlug(body.name), await takenSlugs(workspaceId));
    const content = body.content ?? null;
    const id = crypto.randomUUID();
    await db.insert(schema.skill).values({
      id,
      workspaceId,
      slug,
      name: body.name,
      description: body.description,
      content,
      source: "manual",
      contentHash: await hashSkill(content, []),
      createdBy: userId,
    });
    const [created] = await db
      .select()
      .from(schema.skill)
      .where(eq(schema.skill.id, id))
      .limit(1);
    return c.json({ skill: shape(created!) }, 201);
  })
  // 从 GitHub 导入
  .post("/import", zValidator("json", importSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("user").sub;
    const { url } = c.req.valid("json");

    let imported: Awaited<ReturnType<typeof importFromGitHub>>;
    try {
      imported = await importFromGitHub(url);
    } catch (err) {
      return c.json({ error: `导入失败：${(err as Error).message}` }, 400);
    }
    if (!imported.description) {
      imported.description = `从 ${imported.sourceRef} 导入`;
    }

    // 重名则追加来源后缀，避免 409 卡住导入
    let name = imported.name;
    if (await nameTaken(workspaceId, name)) name = `${name} (${imported.sourceRef.split("/")[0]})`;
    const slug = resolveSlug(skillSlug(name), await takenSlugs(workspaceId));

    const id = crypto.randomUUID();
    await db.insert(schema.skill).values({
      id,
      workspaceId,
      slug,
      name: name.slice(0, 128),
      description: imported.description.slice(0, 1024),
      content: imported.content,
      source: "github",
      sourceRef: imported.sourceRef,
      contentHash: await hashSkill(imported.content, imported.files),
      createdBy: userId,
    });
    if (imported.files.length) {
      await db.insert(schema.skillFile).values(
        imported.files.map((f) => ({
          id: crypto.randomUUID(),
          skillId: id,
          path: f.path,
          isBinary: false,
          content: f.content,
          size: new TextEncoder().encode(f.content).length,
        })),
      );
    }
    const [created] = await db
      .select()
      .from(schema.skill)
      .where(eq(schema.skill.id, id))
      .limit(1);
    return c.json(
      { skill: shape(created!, { fileCount: imported.files.length }) },
      201,
    );
  })
  // 详情（全文 + 附件 + 用它的 agent）
  .get("/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const [s] = await db
      .select()
      .from(schema.skill)
      .where(
        and(eq(schema.skill.id, id), eq(schema.skill.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!s) return c.json({ error: "技能不存在" }, 404);

    const files = await db
      .select({
        id: schema.skillFile.id,
        path: schema.skillFile.path,
        isBinary: schema.skillFile.isBinary,
        size: schema.skillFile.size,
      })
      .from(schema.skillFile)
      .where(eq(schema.skillFile.skillId, id))
      .orderBy(schema.skillFile.path);

    const agents = await db
      .select({ id: schema.agent.id, name: schema.agent.name })
      .from(schema.agentSkill)
      .innerJoin(schema.agent, eq(schema.agentSkill.agentId, schema.agent.id))
      .where(eq(schema.agentSkill.skillId, id));

    return c.json({
      skill: {
        ...shape(s, { agentCount: agents.length, fileCount: files.length }),
        content: s.content,
      },
      files,
      agents,
    });
  })
  // 编辑（slug 一旦生成不变，保证物化路径稳定）
  .patch("/:id", zValidator("json", updateSchema), async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const patch = c.req.valid("json");

    const [cur] = await db
      .select()
      .from(schema.skill)
      .where(
        and(eq(schema.skill.id, id), eq(schema.skill.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!cur) return c.json({ error: "技能不存在" }, 404);

    if (patch.name && (await nameTaken(workspaceId, patch.name, id))) {
      return c.json({ error: "该技能名已被占用" }, 409);
    }

    const set: Partial<typeof schema.skill.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.content !== undefined) {
      set.content = patch.content;
      // 正文变 → 重算指纹（附件不变，沿用当前附件集合）
      const files = await db
        .select({ path: schema.skillFile.path, content: schema.skillFile.content })
        .from(schema.skillFile)
        .where(eq(schema.skillFile.skillId, id));
      set.contentHash = await hashSkill(
        patch.content,
        files.map((f) => ({ path: f.path, content: f.content ?? "" })),
      );
    }
    await db.update(schema.skill).set(set).where(eq(schema.skill.id, id));

    const [updated] = await db
      .select()
      .from(schema.skill)
      .where(eq(schema.skill.id, id))
      .limit(1);
    return c.json({ skill: { ...shape(updated!), content: updated!.content } });
  })
  // 删除（级联清 agent_skill / skill_file）
  .delete("/:id", async (c) => {
    const workspaceId = c.get("workspaceId");
    const id = c.req.param("id");
    const [cur] = await db
      .select({ id: schema.skill.id })
      .from(schema.skill)
      .where(
        and(eq(schema.skill.id, id), eq(schema.skill.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!cur) return c.json({ error: "技能不存在" }, 404);
    await db.delete(schema.skill).where(eq(schema.skill.id, id));
    return c.json({ ok: true });
  });
