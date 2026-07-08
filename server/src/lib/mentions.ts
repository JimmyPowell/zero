// @mention 解析：纯文本 `@名字` 按 workspace agent 名精确匹配（设计见 docs/agent-mention-design.md §4.1）。
// 规则：
// - 代码不算：剔除 fenced(```)/inline(`) code 后再找 @；
// - 精确全名匹配、长名优先（有 "@前端" 和 "@前端工程师" 两个 agent 时不会被短名抢走）；
//   agent 名在 workspace 内唯一（uniq_agent_workspace_name），无重名歧义；
// - 边界：@ 前与名字后都不能是 ASCII 字母/数字/下划线（防 email、@bobby 误伤 bob）；
//   中文名后可直接续写正文（"@数据库专家帮忙看下" 命中"数据库专家"）。
// 纯函数、不碰 DB —— issues.ts（人评论）与 daemon.ts /complete（agent 总结）共用，可单测。

export interface MentionCandidate {
  id: string;
  name: string;
}

const isAsciiWord = (ch: string | undefined): boolean =>
  !!ch && /[A-Za-z0-9_]/.test(ch);

// 把代码段抹成等长空白：不改变其余字符的位置，@ 的下标在原文里仍然有效
export function stripCodeSegments(body: string): string {
  return body
    .replace(/```[\s\S]*?(?:```|$)/g, (m) => " ".repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

// 返回按出现顺序去重后的被 @ agent id 列表
export function parseMentions(
  body: string | null | undefined,
  agents: MentionCandidate[],
): string[] {
  if (!body || agents.length === 0) return [];
  const text = stripCodeSegments(body);
  const sorted = agents
    .filter((a) => a.name && a.name.trim().length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  const found: string[] = [];
  let at = text.indexOf("@");
  while (at !== -1) {
    let skip = 1;
    if (!isAsciiWord(text[at - 1])) {
      const rest = text.slice(at + 1);
      const hit = sorted.find(
        (a) => rest.startsWith(a.name) && !isAsciiWord(rest[a.name.length]),
      );
      if (hit) {
        if (!found.includes(hit.id)) found.push(hit.id);
        skip = 1 + hit.name.length; // 跳过整个名字，防止名字内部字符再触发
      }
    }
    at = text.indexOf("@", at + skip);
  }
  return found;
}
