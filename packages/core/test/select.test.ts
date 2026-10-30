import { describe, expect, it } from "vitest";
import { selectFeedIssues, selectForSubscriber } from "../src/select.ts";

const c = (id: string, topicId: string, finalScore: number) => ({ id, topicId, finalScore });

describe("selectForSubscriber", () => {
  const pool = [
    c("1", "ai", 0.95),
    c("2", "ai", 0.9),
    c("3", "ai", 0.85),
    c("4", "ai", 0.8),
    c("5", "crypto", 0.3),
    c("6", "startup", 0.6),
    c("7", "startup", 0.55),
  ];

  it("每个订阅主题至少保底一条，其余按分数补足", () => {
    const groups = selectForSubscriber(pool, { topicOrder: ["ai", "crypto", "startup"], total: 4, minPerTopic: 1 });
    expect(groups.map((g) => [g.topicId, g.items.map((i) => i.id)])).toEqual([
      ["ai", ["1", "2"]],
      ["crypto", ["5"]],
      ["startup", ["6"]],
    ]);
  });

  it("只包含订阅的主题，并按订阅顺序分组", () => {
    const groups = selectForSubscriber(pool, { topicOrder: ["startup", "ai"], total: 3, minPerTopic: 1 });
    expect(groups.map((g) => g.topicId)).toEqual(["startup", "ai"]);
    expect(groups.flatMap((g) => g.items.map((i) => i.id)).sort()).toEqual(["1", "2", "6"]);
  });

  it("保底总数超过名额时保留分数最高的", () => {
    const groups = selectForSubscriber(pool, { topicOrder: ["ai", "crypto", "startup"], total: 2, minPerTopic: 1 });
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(["1", "6"]);
  });

  it("当天没有内容的主题不出现，内容不足时不凑数", () => {
    const groups = selectForSubscriber([c("1", "ai", 0.9)], { topicOrder: ["ai", "crypto"], total: 10, minPerTopic: 1 });
    expect(groups).toEqual([{ topicId: "ai", items: [c("1", "ai", 0.9)] }]);
  });
});

describe("selectFeedIssues", () => {
  const f = (id: string, issueDate: string, finalScore: number, topicId = "ai") => ({ id, topicId, finalScore, issueDate });

  it("按期分组，期号从新到旧，期内按综合分排序", () => {
    const issues = selectFeedIssues(
      [f("a", "2026-10-29", 0.5), f("b", "2026-10-30", 0.4), f("c", "2026-10-30", 0.9), f("d", "2026-10-30", 0.7, "crypto")],
      { topicId: "ai", total: 60, minPerTopic: 1, limit: 30 },
    );
    expect(issues.map((i) => [i.date, i.items.map((x) => x.id)])).toEqual([
      ["2026-10-30", ["c", "b"]],
      ["2026-10-29", ["a"]],
    ]);
  });

  it("每期最多 total 条，整个 Feed 最多 limit 条", () => {
    const pool = [f("a", "2026-10-30", 0.9), f("b", "2026-10-30", 0.8), f("c", "2026-10-30", 0.1), f("d", "2026-10-29", 0.5), f("e", "2026-10-29", 0.4)];
    const issues = selectFeedIssues(pool, { topicId: "ai", total: 2, minPerTopic: 1, limit: 3 });
    expect(issues.map((i) => [i.date, i.items.map((x) => x.id)])).toEqual([
      ["2026-10-30", ["a", "b"]],
      ["2026-10-29", ["d"]],
    ]);
  });
});
