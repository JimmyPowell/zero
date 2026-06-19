// 企业微信「群机器人」渠道 adapter。群机器人是一个 incoming webhook（URL 自带 key），
// 直接 POST markdown 消息即可，单向推送、无需额外鉴权。
// 文档：https://developer.work.weixin.qq.com/document/path/91770

export async function sendWecom(
  webhookUrl: string,
  subject: string,
  body: string,
): Promise<void> {
  // 企业微信 markdown：标题加粗 + 正文。正文里的链接用 [文字](url) 才可点，
  // 这里 body 是与邮件共用的纯文本，URL 以文本呈现（够用；后续可做富链接）。
  const content = `**${subject}**\n${body}`.slice(0, 4000);
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "markdown", markdown: { content } }),
  });
  if (!res.ok) {
    throw new Error(`wecom HTTP ${res.status}`);
  }
  // 企业微信返回 {errcode,errmsg}，errcode!=0 视为失败（如 key 失效 93000）
  const data = (await res.json().catch(() => null)) as {
    errcode?: number;
    errmsg?: string;
  } | null;
  if (data && typeof data.errcode === "number" && data.errcode !== 0) {
    throw new Error(`wecom errcode ${data.errcode}: ${data.errmsg ?? ""}`);
  }
}
