import { createHash, randomBytes } from "node:crypto";

// 运行时配对令牌：高熵随机串，明文只在创建时给用户一次
export function generateToken(): string {
  return randomBytes(24).toString("base64url"); // ~32 字符
}

// 存储与比对用的 sha256（令牌本身高熵，无需 argon2）
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
