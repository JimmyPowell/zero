// 附件存储：本地磁盘 + 签名下载链接。
// 落盘到 ATTACHMENTS_DIR（dev=<server>/data/uploads，prod=VPS 路径），
// key=workspaces/{ws}/{uuid}{ext}。下载用签名 query（HMAC，不暴露长期令牌）。
import { mkdir } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { dirname, extname, join } from "node:path";

import { config } from "@/config";

export const ATTACH_DIR =
  process.env.ATTACHMENTS_DIR ?? join(process.cwd(), "data/uploads");

// 单文件上限（默认 25MB）。注意 Cloudflare 边缘对上传体积有限制，大文件需直连 origin。
export const ATTACH_MAX_BYTES = Number(
  process.env.ATTACH_MAX_BYTES ?? 25 * 1024 * 1024,
);

export function storageKey(
  workspaceId: string,
  id: string,
  filename: string,
): string {
  return `workspaces/${workspaceId}/${id}${extname(filename).slice(0, 16)}`;
}

export async function saveFile(
  key: string,
  data: ArrayBuffer | Uint8Array,
): Promise<void> {
  const path = join(ATTACH_DIR, key);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, data);
}

export function filePath(key: string): string {
  return join(ATTACH_DIR, key);
}

function sign(id: string, exp: number): string {
  return createHmac("sha256", config.jwtSecret)
    .update(`${id}.${exp}`)
    .digest("hex")
    .slice(0, 32);
}

// 签名下载相对路径：/attachments/:id?exp&sig（默认 2h；浏览器列表场景可传更长 TTL）
export function signAttachmentPath(id: string, ttlSec = 7200): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `/attachments/${id}?exp=${exp}&sig=${sign(id, exp)}`;
}

export function verifyAttachmentSig(
  id: string,
  exp: string,
  sig: string,
): boolean {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Math.floor(Date.now() / 1000)) return false;
  return sig === sign(id, e);
}
