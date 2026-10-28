import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { addAccountToTopic, normalizeHandle, readAccountWeights, removeAccountFromTopics, setAccountWeight } from "../src/config-edit.ts";
import { DigestFile, TopicsFile } from "../src/config.ts";

const dir = join(import.meta.dirname, "..", "..", "..", "config");
const topicsText = readFileSync(join(dir, "topics.yaml"), "utf8");
const digestText = readFileSync(join(dir, "digest.yaml"), "utf8");
const accountsOf = (text: string, id: string) => TopicsFile.parse(parse(text)).topics.find((t) => t.id === id)!.accounts;
/** 两段文本不同的行 */
const changedLines = (a: string, b: string) => {
  const x = a.split("\n");
  const y = b.split("\n");
  return { removed: x.filter((l) => !y.includes(l)), added: y.filter((l) => !x.includes(l)) };
};

describe("normalizeHandle", () => {
  it("接受 @、链接和纯账号", () => {
    expect(normalizeHandle("@karpathy")).toBe("karpathy");
    expect(normalizeHandle(" https://x.com/Karpathy/status/1 ")).toBe("Karpathy");
    expect(normalizeHandle("twitter.com/simonw?s=20")).toBe("simonw");
    expect(normalizeHandle("bad name")).toBeNull();
    expect(normalizeHandle("a_very_long_handle_name")).toBeNull();
  });
});

describe("topics.yaml", () => {
  it("新增账号只多一行，缩进和其他账号一致", () => {
    const out = addAccountToTopic(topicsText, "research", "NewPerson");
    expect(accountsOf(out, "research").at(-1)).toBe("newperson");
    expect(changedLines(topicsText, out)).toEqual({ removed: [], added: ["      - NewPerson"] });
  });

  it("重复账号（不分大小写）报错", () => {
    expect(() => addAccountToTopic(topicsText, "research", "KARPATHY")).toThrow("已经在");
    expect(() => addAccountToTopic(topicsText, "nope", "someone")).toThrow("没有主题");
  });

  it("移出账号只删那一行，注释保留", () => {
    const out = removeAccountFromTopics(topicsText, "Karpathy");
    expect(accountsOf(out, "research")).not.toContain("karpathy");
    expect(changedLines(topicsText, out)).toEqual({ removed: ["      - karpathy"], added: [] });
    expect(out).toContain("# researchers");
  });

  it("可以只从一个主题移出；不在里面时报错", () => {
    const twice = addAccountToTopic(topicsText, "labs", "karpathy");
    const out = removeAccountFromTopics(twice, "karpathy", "labs");
    expect(accountsOf(out, "labs")).not.toContain("karpathy");
    expect(accountsOf(out, "research")).toContain("karpathy");
    expect(() => removeAccountFromTopics(topicsText, "nobody")).toThrow("不在任何主题");
  });

  it("主题只剩一个账号时不能移出", () => {
    const text = "topics:\n  - id: a\n    name: A\n    color: \"#000000\"\n    accounts:\n      - only\n";
    expect(() => removeAccountFromTopics(text, "only")).toThrow("至少要有一个账号");
  });

  it("行内列表也能改", () => {
    const text = "topics:\n  - id: a\n    name: A\n    color: \"#000000\"\n    accounts: [one, two]\n";
    expect(accountsOf(addAccountToTopic(text, "a", "three"), "a")).toEqual(["one", "two", "three"]);
    expect(accountsOf(removeAccountFromTopics(text, "one"), "a")).toEqual(["two"]);
  });
});

describe("digest.yaml account_weight", () => {
  const weights = (text: string) => DigestFile.parse(parse(text)).account_weight;

  it("读出权重和注释", () => {
    expect(readAccountWeights(digestText).get("jinchenma_ai")).toEqual({ weight: 0.6, note: expect.stringContaining("2026-10-26") });
  });

  it("新增一项，注释和上一行对齐", () => {
    const out = setAccountWeight(digestText, "dotey", 0.8, "测试原因");
    expect(weights(out)).toMatchObject({ jinchenma_ai: 0.6, dotey: 0.8 });
    const { removed, added } = changedLines(digestText, out);
    expect(removed).toEqual([]);
    expect(added).toEqual([expect.stringMatching(/^  dotey: 0\.8 +# 测试原因$/)]);
    const old = digestText.split("\n").find((l) => l.includes("jinchenma_ai:"))!;
    expect(added[0]!.indexOf("#")).toBe(old.indexOf("#"));
  });

  it("修改已有一项：不传原因时保留原注释", () => {
    const out = setAccountWeight(digestText, "JinChenMa_AI", 0.5);
    expect(weights(out).jinchenma_ai).toBe(0.5);
    expect(readAccountWeights(out).get("jinchenma_ai")?.note).toContain("2026-10-26");
    expect(changedLines(digestText, out).added).toHaveLength(1);
    expect(readAccountWeights(setAccountWeight(digestText, "jinchenma_ai", 0.5, "")).get("jinchenma_ai")?.note).toBeUndefined();
  });

  it("删掉最后一项后写成 {}，文件仍然合法", () => {
    const out = setAccountWeight(digestText, "jinchenma_ai", null);
    expect(weights(out)).toEqual({});
    expect(out).toContain("account_weight: {}");
    const back = setAccountWeight(out, "dotey", 0.7, "再加回来");
    expect(weights(back)).toEqual({ dotey: 0.7 });
    expect(back).toContain("account_weight:\n  dotey: 0.7  # 再加回来\n");
    expect(setAccountWeight(digestText, "nobody", null)).toBe(digestText);
  });

  it("超出范围报错", () => {
    expect(() => setAccountWeight(digestText, "dotey", 3)).toThrow("0 到 2");
  });
});
