import { Hono } from "hono";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { requireAuth } from "@/middleware/auth";
import {
  requireWorkspaceMember,
  type WorkspaceEnv,
} from "@/middleware/workspace";
import {
  ATTACH_MAX_BYTES,
  filePath,
  saveFile,
  signAttachmentPath,
  storageKey,
  verifyAttachmentSig,
} from "@/lib/storage";

// 工作空间作用域：上传附件（先不 link，发评论时再关联）
export const attachmentRoutes = new Hono<WorkspaceEnv>()
  .use(requireAuth)
  .use(requireWorkspaceMember)
  .post("/", async (c) => {
    const workspaceId = c.get("workspaceId");
    const { sub } = c.get("user");

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: "请用 multipart 上传" }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0)
      return c.json({ error: "缺少文件" }, 400);
    if (file.size > ATTACH_MAX_BYTES)
      return c.json(
        {
          error: `文件超过 ${Math.round(ATTACH_MAX_BYTES / 1024 / 1024)}MB 上限`,
        },
        413,
      );

    const id = crypto.randomUUID();
    const filename = file.name || "file";
    const key = storageKey(workspaceId, id, filename);
    await saveFile(key, await file.arrayBuffer());

    const mime = file.type || "application/octet-stream";
    await db.insert(schema.attachment).values({
      id,
      workspaceId,
      issueId: null,
      issueEventId: null,
      uploaderType: "member",
      uploaderId: sub,
      filename,
      mime,
      sizeBytes: file.size,
      storageKey: key,
    });

    return c.json(
      {
        attachment: {
          id,
          filename,
          mime,
          size: file.size,
          // 浏览器即时预览：较长 TTL
          url: signAttachmentPath(id, 86400),
        },
      },
      201,
    );
  });

// 顶层：签名下载（浏览器 <img>/下载 + daemon 拉取，皆凭签名，不需登录）
export const attachmentDownloadRoutes = new Hono().get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!verifyAttachmentSig(id, c.req.query("exp") ?? "", c.req.query("sig") ?? ""))
    return c.json({ error: "链接无效或已过期" }, 403);

  const [att] = await db
    .select()
    .from(schema.attachment)
    .where(eq(schema.attachment.id, id))
    .limit(1);
  if (!att) return c.json({ error: "附件不存在" }, 404);

  const f = Bun.file(filePath(att.storageKey));
  if (!(await f.exists())) return c.json({ error: "文件已丢失" }, 404);

  const isImage = att.mime.startsWith("image/");
  const headers: Record<string, string> = {
    "Content-Type": att.mime,
    "Content-Length": String(att.sizeBytes),
    // 禁止 MIME 嗅探；非图片强制下载，避免内联 HTML/脚本在 API 源执行
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=86400",
  };
  if (!isImage)
    headers["Content-Disposition"] =
      `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`;
  return new Response(f.stream(), { headers });
});
