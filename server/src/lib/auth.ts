import { SignJWT, jwtVerify } from "jose";

import { config } from "@/config";

const secret = new TextEncoder().encode(config.jwtSecret);
const ALG = "HS256";

export interface JwtPayload {
  sub: string; // user id
  email: string;
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
    if (!payload.sub) return null;
    return { sub: payload.sub, email: String(payload.email ?? "") };
  } catch {
    return null;
  }
}

// 密码哈希：使用 Bun 内置 argon2id，无需额外依赖
export function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: "argon2id" });
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return Bun.password.verify(plain, hash);
}
