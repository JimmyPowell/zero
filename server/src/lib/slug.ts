// 把工作空间名转成 url-safe slug
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9一-龥]+/g, "-") // 非字母数字汉字 → 连字符
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "workspace";
}

// 在已有 slug 集合中生成不冲突的 slug
export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
