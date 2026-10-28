import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveTopicId, loadConfig, normalizeTopicIds, resolveTopicId } from "../src/config.ts";

const config = loadConfig(join(import.meta.dirname, "..", "..", "..", "config"));

describe("topics.yaml", () => {
  it("合并成 5 个主题，账号不重复且超过 10 个", () => {
    expect(config.topics.map((t) => t.id)).toEqual(["labs", "research", "builders", "cn-insight", "cn-builders"]);
    expect(new Set(config.accounts).size).toBe(config.accounts.length);
    expect(config.accounts.length).toBeGreaterThan(10);
    expect(config.topics.every((t) => t.description)).toBe(true);
  });

  it("旧主题 id 映射到合并后的主题，按 topics.yaml 顺序去重", () => {
    expect(normalizeTopicIds(config, ["cn-creative", "official-labs", "lab-leaders", "gone"])).toEqual(["labs", "cn-builders"]);
    expect(normalizeTopicIds(config, ["research", "researchers"])).toEqual(["research"]);
    expect(resolveTopicId(config, "open-source")).toBe("builders");
    expect(resolveTopicId(config, "labs")).toBe("labs");
    expect(resolveTopicId(config, "gone")).toBeUndefined();
    expect(resolveTopicId(config, null)).toBeUndefined();
  });

  it("已不存在的主题退回到账号自己的主题", () => {
    expect(effectiveTopicId(config, "startup", "oran_ge")).toBe("cn-insight");
    expect(effectiveTopicId(config, "official-labs", "karpathy")).toBe("labs");
    expect(effectiveTopicId(config, null, "unknown_user")).toBeUndefined();
  });

  it("订阅页配置有默认值", () => {
    expect(config.digest.subscribe_page).toEqual({ max_avatars: 7, overwrite_existing: true });
  });
});
