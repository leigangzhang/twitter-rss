import type { FeedbackInfo } from "@xrss/core/db";
import { describe, expect, it } from "vitest";
import { applyCurationEdits, CHANGELOG_HEADER, changelogEntry, feedbackPayload, MAX_EDITS, prependChangelog } from "../src/curation-tune.ts";

const guide = `# 精选标准

## 要剔除的内容

- **promo｜推广**：产品广告、课程和社群招募。
- **chitchat｜闲聊**：日常生活、寒暄。

## 打分（5 分制）

- **3 有收获**：信息或观点有用但比较普通。`;

const edit = (old: string, next: string) => ({ old, new: next, why: "测试" });

describe("根据反馈调整精选标准", () => {
  it("应用找得到、只出现一次的改动", () => {
    const r = applyCurationEdits(guide, [edit("- **promo｜推广**：产品广告、课程和社群招募。", "- **promo｜推广**：产品广告、课程和社群招募；转述自家产品更新、没有使用细节的也算。")]);
    expect(r.rejected).toEqual([]);
    expect(r.applied).toHaveLength(1);
    expect(r.text).toContain("没有使用细节的也算");
    expect(r.text).toContain("## 打分（5 分制）");
  });

  it("跳过找不到、重复出现、删掉规则、去掉标题或类别代码的改动，其他照常应用", () => {
    const r = applyCurationEdits(guide, [
      edit("不存在的一句", "新句子"),
      edit("**：", "**："),
      edit("- **chitchat｜闲聊**：日常生活、寒暄。", "- 闲聊。"),
      edit("## 打分（5 分制）\n", "打分（5 分制）说明\n"),
      edit("- **chitchat｜闲聊**：日常生活、寒暄。", "- **闲聊**：日常生活、寒暄、节日问候。"),
      edit("日常生活、寒暄。", "日常生活、寒暄、节日问候。"),
    ]);
    expect(r.rejected.map((x) => x.problem)).toEqual([
      "要改的原文在标准里找不到",
      "要改的原文在标准里出现了不止一次",
      "删掉的内容太多（只允许补充和改写，不删规则）",
      '去掉了标题"## 打分（5 分制）"',
      "去掉了类别 chitchat",
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.text).toContain("寒暄、节日问候。");
  });

  it("新增太多或超过处数上限的不采纳", () => {
    const small = ["产品广告", "日常生活", "比较普通", "社群招募"].map((old) => edit(old, `${old}等`));
    const r = applyCurationEdits(guide, [edit("寒暄", `寒暄${"很长".repeat(300)}`), ...small]);
    expect(r.rejected[0]!.problem).toMatch(/新增超过/);
    expect(r.applied).toHaveLength(MAX_EDITS);
    expect(r.rejected.at(-1)!.problem).toMatch(/最多/);
  });

  it("替换文字里的 $ 不被当成特殊符号", () => {
    expect(applyCurationEdits(guide, [edit("课程和社群招募", "课程、$& 和社群招募")]).text).toContain("课程、$& 和社群招募");
  });

  it("给模型的反馈带编号、原因和当时的 AI 判断", () => {
    const f = {
      id: 1,
      issueDate: "2026-10-29",
      vote: "down",
      reason: "shallow",
      note: "只是一句感叹",
      source: "admin",
      tweetId: "1",
      handle: "someone",
      topicId: "labs",
      ai: { category: "expert_insight", quality: 3, scale: 5, reason: "有观点" },
      text: "AI  will\nchange everything",
      email: null,
      updatedAt: new Date(),
    } as unknown as FeedbackInfo;
    expect(feedbackPayload([f], () => "大模型厂商")[0]).toMatchObject({ no: 1, vote: "踩", reason: "内容太浅", note: "只是一句感叹", account: "@someone", topic: "大模型厂商", quality: 3, aiReason: "有观点", text: "AI will change everything" });
  });

  it("变更记录新的在前，保留说明", () => {
    const apply = applyCurationEdits(guide, [edit("日常生活、寒暄。", "日常生活、寒暄、节日问候。")]);
    const entry = changelogEntry({ stamp: "2026-10-30 08:05", since: "2026/10/29 08:05", up: 2, down: 3, result: { summary: "补充闲聊。", edits: [], notes: ["@someone 降权"] }, apply, backup: "data/curation-history/2026-10-30-0805.md" });
    expect(entry).toContain("> 日常生活、寒暄。");
    expect(entry).toContain("> 日常生活、寒暄、节日问候。");
    expect(entry).toContain("- @someone 降权");
    const first = prependChangelog(null, entry);
    const second = prependChangelog(first, "## 2026-10-31 08:05\n\n第二次");
    expect(second.startsWith(CHANGELOG_HEADER)).toBe(true);
    expect(second.indexOf("2026-10-31")).toBeLessThan(second.indexOf("2026-10-30 08:05"));
    // 只有说明、末尾少了空行（仓库里的初始文件）也不重复说明
    expect(prependChangelog(`${CHANGELOG_HEADER.trimEnd()}\n`, "## x").split("# 精选标准变更记录").length).toBe(2);
  });
});
