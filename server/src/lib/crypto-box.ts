import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { config } from "@/config";

// 敏感凭据（如 SMTP 密码）的加密落库工具。
// 方案：AES-256-GCM。主密钥来自 env CONFIG_ENC_KEY（任意长度），sha256 派生成 32 字节。
// 密文格式：base64( iv(12B) | authTag(16B) | ciphertext )。GCM 自带完整性校验，
// 密钥变更 / 密文被篡改 → decrypt 抛错，绝不返回错误明文。
//
// 设计要点：
// - 主密钥永远只在 env，DB 里只存密文。脱库拿不到明文。
// - encrypt/decrypt 在缺 CONFIG_ENC_KEY 时直接抛错，而非静默降级成明文。

const IV_LEN = 12;
const TAG_LEN = 16;

export function isCryptoConfigured(): boolean {
  return Boolean(config.configEncKey);
}

function derivedKey(): Buffer {
  if (!config.configEncKey) {
    throw new Error(
      "CONFIG_ENC_KEY 未配置：无法加密/解密敏感凭据。请在 server/.env 设置后重启。",
    );
  }
  // 任意长度口令 → 固定 32 字节 AES-256 密钥
  return createHash("sha256").update(config.configEncKey, "utf8").digest();
}

// 明文 → base64(iv|tag|cipher)
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

// base64(iv|tag|cipher) → 明文（密钥不符 / 密文损坏会抛错）
export function decryptSecret(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("密文格式非法（长度不足）");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", derivedKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    "utf8",
  );
}
