// @mention 前端工具：与 server/src/lib/mentions.ts 同一套匹配规则
// （精确全名、长名优先、ASCII 边界、代码段不算）。这里只管展示层：
// 把评论正文里的 @名字 转成 `[@名字](#mention)` 链接，Markdown 组件把
// href="#mention" 渲染成高亮 span（不产生真实跳转）。

const isAsciiWord = (ch: string | undefined): boolean =>
  !!ch && /[A-Za-z0-9_]/.test(ch);

// 把代码段抹成等长空白：影子文本的下标与原文一一对应，可安全定位 @
export function stripCodeSegments(body: string): string {
  return body
    .replace(/```[\s\S]*?(?:```|$)/g, (m) => " ".repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

export function highlightMentions(body: string, names: string[]): string {
  if (!body || names.length === 0 || !body.includes("@")) return body;
  const shadow = stripCodeSegments(body);
  const sorted = names
    // 名字含 markdown 链接语法字符（[ ] `）时无法安全包成 [@名字](#mention)，跳过高亮
    // （服务端解析/触发不受影响，纯展示降级）
    .filter((n) => n && n.trim().length > 0 && !/[[\]`]/.test(n))
    .sort((a, b) => b.length - a.length);
  const ranges: { start: number; end: number }[] = [];
  let at = shadow.indexOf("@");
  while (at !== -1) {
    let skip = 1;
    if (!isAsciiWord(shadow[at - 1])) {
      const rest = shadow.slice(at + 1);
      const hit = sorted.find(
        (n) => rest.startsWith(n) && !isAsciiWord(rest[n.length]),
      );
      if (hit) {
        ranges.push({ start: at, end: at + 1 + hit.length });
        skip = 1 + hit.length;
      }
    }
    at = shadow.indexOf("@", at + skip);
  }
  // 从后往前替换，避免前面的替换让后面的下标失效
  let out = body;
  for (const r of ranges.reverse()) {
    out = `${out.slice(0, r.start)}[${body.slice(r.start, r.end)}](#mention)${out.slice(r.end)}`;
  }
  return out;
}
