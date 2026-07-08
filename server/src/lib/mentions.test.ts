import { describe, expect, test } from "bun:test";

import { parseMentions, stripCodeSegments } from "./mentions";

const agents = [
  { id: "a1", name: "全栈开发工程师" },
  { id: "a2", name: "数据库专家" },
  { id: "a3", name: "数据库" }, // 短名，验证长名优先
  { id: "a4", name: "bob" },
  { id: "a5", name: "reviewer-2" },
];

describe("stripCodeSegments", () => {
  test("等长空白占位，不改变其余字符位置", () => {
    const s = "a `@x` b";
    const out = stripCodeSegments(s);
    expect(out.length).toBe(s.length);
    expect(out.startsWith("a ")).toBe(true);
    expect(out.endsWith(" b")).toBe(true);
    expect(out).not.toContain("@x");
  });
  test("未闭合 fenced block 也剔除到结尾", () => {
    expect(stripCodeSegments("x\n```\n@bob\n")).not.toContain("@bob");
  });
});

describe("parseMentions", () => {
  test("基本命中（中文名 + 后跟正文直接续写）", () => {
    expect(parseMentions("@数据库专家帮忙看下慢查询", agents)).toEqual(["a2"]);
  });
  test("长名优先：不被短名抢走", () => {
    expect(parseMentions("请 @数据库专家 看下", agents)).toEqual(["a2"]);
    expect(parseMentions("请 @数据库 看下", agents)).toEqual(["a3"]);
  });
  test("多个点名按出现顺序去重", () => {
    expect(
      parseMentions("@bob @全栈开发工程师 再 @bob 一次", agents),
    ).toEqual(["a4", "a1"]);
  });
  test("ASCII 边界：@bobby 不命中 bob；名后紧跟字母数字不命中", () => {
    expect(parseMentions("@bobby 你好", agents)).toEqual([]);
    expect(parseMentions("@bob2 你好", agents)).toEqual([]);
    expect(parseMentions("@bob, 你好", agents)).toEqual(["a4"]);
    expect(parseMentions("@reviewer-2 请评审", agents)).toEqual(["a5"]);
  });
  test("email 不误伤：@ 前是 ASCII 字母数字则跳过", () => {
    expect(parseMentions("发给 alice@bob.com 吧", agents)).toEqual([]);
    expect(parseMentions("（@bob）", agents)).toEqual(["a4"]);
  });
  test("代码块/行内代码里的 @ 不触发", () => {
    expect(parseMentions("装饰器 `@bob` 不是点名", agents)).toEqual([]);
    expect(
      parseMentions("```\n@数据库专家\n```\n正文没点名", agents),
    ).toEqual([]);
    expect(
      parseMentions("```\n@bob\n```\n@全栈开发工程师 看下", agents),
    ).toEqual(["a1"]);
  });
  test("空输入 / 无 agent / 无 @", () => {
    expect(parseMentions("", agents)).toEqual([]);
    expect(parseMentions(null, agents)).toEqual([]);
    expect(parseMentions("@bob", [])).toEqual([]);
    expect(parseMentions("没有点名", agents)).toEqual([]);
  });
  test("不存在的名字不命中", () => {
    expect(parseMentions("@不存在的人 你好", agents)).toEqual([]);
  });
});
