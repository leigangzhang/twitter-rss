import { describe, expect, it } from "vitest";
import { renderDigest } from "../src/index.ts";
import { sampleDigest } from "../src/sample.ts";

describe("每日邮件", () => {
  it("超过大小上限时，把排在后面的条目改为一句话摘要，每个主题至少保留一张完整卡片", async () => {
    const view = sampleDigest("zh");
    const full = await renderDigest(view);
    expect(full.compacted).toBe(0);
    const limit = Buffer.byteLength(full.html) - 2000;
    const slim = await renderDigest(view, { maxBytes: limit });
    expect(slim.compacted).toBeGreaterThan(0);
    expect(Buffer.byteLength(slim.html)).toBeLessThanOrEqual(limit);
    expect(slim.html).toContain("篇幅所限只列摘要");
    // 标题里的条数不变
    expect(slim.subject).toBe(full.subject);
  });

  it("标签页模式：带切换用的单选按钮和不支持时的主题目录", async () => {
    const { html } = await renderDigest(sampleDigest("zh"), { tabs: true });
    expect(html).toContain('id="xt-all"');
    expect(html).toMatch(/class="xt-toc[ "]/);
    expect(html).toContain("#xt-1:checked");
  });

  it("单张卡片的体积控制在 3KB 左右", async () => {
    const view = sampleDigest("zh");
    const one = await renderDigest({ ...view, groups: [{ ...view.groups[0]!, items: [view.groups[0]!.items[0]!] }] });
    const two = await renderDigest({ ...view, groups: [{ ...view.groups[0]!, items: view.groups[0]!.items.slice(0, 2) }] });
    expect(Buffer.byteLength(two.html) - Buffer.byteLength(one.html)).toBeLessThan(3500);
  });
});
