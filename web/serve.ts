// 极简静态服务器：serve web/dist，带 SPA fallback（BrowserRouter 用）。
// 由 systemd 管理。端口默认 5173，可用 WEB_PORT 覆盖。
import { file } from "bun";
import { join, normalize } from "node:path";

const DIST = join(import.meta.dir, "dist");
const PORT = Number(process.env.WEB_PORT ?? 5173);
const indexHtml = join(DIST, "index.html");

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);
    // 防目录穿越
    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(DIST, safe);

    let f = file(filePath);
    if (pathname !== "/" && (await f.exists())) {
      return new Response(f);
    }
    // SPA fallback：未命中静态资源 → index.html
    return new Response(file(indexHtml), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`web static server on http://0.0.0.0:${PORT} (dist=${DIST})`);
