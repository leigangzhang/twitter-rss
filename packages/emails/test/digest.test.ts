import { describe, expect, it } from "vitest";
import { renderDigest, renderDigestParts } from "../src/index.ts";
import { sampleDigest } from "../src/sample.ts";

describe("每日邮件", () => {
  it("超过大小上限时去掉分数最低的条目，每个主题至少保留一条，邮件里只有完整卡片", async () => {
    const view = sampleDigest("zh");
    const full = await renderDigest(view);
    expect(full.dropped).toEqual([]);
    const limit = Buffer.byteLength(full.html) - 2000;
    const slim = await renderDigest(view, { maxBytes: limit });
    expect(slim.dropped.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(slim.html)).toBeLessThanOrEqual(limit);
    expect(slim.html).not.toContain("篇幅所限");
    expect(slim.tweetIds.length + slim.dropped.length).toBe(view.total);
    for (const g of view.groups) expect(g.items.some((c) => slim.tweetIds.includes(c.id))).toBe(true);
  });

  it("放不进一封时分卷发送：每封都是完整卡片、不超过上限，标题注明第几封，条目不重不漏", async () => {
    const view = sampleDigest("zh");
    const full = await renderDigest(view);
    const limit = Math.ceil(Buffer.byteLength(full.html) * 0.7);
    const parts = await renderDigestParts(view, { maxBytes: limit, maxParts: 3 });
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(Buffer.byteLength(p.html)).toBeLessThanOrEqual(limit);
      expect(p.dropped).toEqual([]);
    }
    expect(parts[0]!.subject).toContain(`${view.total} 条（1/${parts.length}）`);
    expect(parts[0]!.html).toContain(`这是第 1 封`);
    const all = view.groups.flatMap((g) => g.items.map((i) => i.id));
    expect(parts.flatMap((p) => p.tweetIds)).toEqual(all);

    // 放得下时只有一封，和原来一样
    const one = await renderDigestParts(view, { maxBytes: Buffer.byteLength(full.html) + 1000, maxParts: 3 });
    expect(one).toHaveLength(1);
    expect(one[0]!.subject).toBe(full.subject);
    // 不分卷（maxParts 1）时也是去掉低分条目
    const single = await renderDigestParts(view, { maxBytes: limit, maxParts: 1 });
    expect(single).toHaveLength(1);
    expect(single[0]!.dropped.length).toBeGreaterThan(0);
  });

  it("60 条分 3 封仍放不下时，去掉分数最低的，每个主题至少留一条", async () => {
    const base = sampleDigest("zh");
    const cards = base.groups.flatMap((g) => g.items);
    // 3 个主题共 60 条，分数从高到低；第三个主题只有 2 条且分数最低
    const sizes = [34, 24, 2];
    let n = 0;
    const groups = sizes.map((size, gi) => ({
      topic: { ...base.groups[gi % base.groups.length]!.topic, id: `t${gi}` },
      items: Array.from({ length: size }, () => {
        const card = cards[n % cards.length]!;
        n++;
        return { ...card, id: `9${String(n).padStart(5, "0")}`, score: 1 - n / 100 };
      }),
    }));
    const view = { ...base, groups, total: 60 };
    const oneCard = Buffer.byteLength((await renderDigest({ ...view, groups: [{ ...groups[0]!, items: groups[0]!.items.slice(0, 1) }], total: 1 })).html);
    const tenCards = Buffer.byteLength((await renderDigest({ ...view, groups: [{ ...groups[0]!, items: groups[0]!.items.slice(0, 10) }], total: 10 })).html);
    // 每封大约放 12 条，3 封放不下 60 条
    const limit = oneCard + Math.round(((tenCards - oneCard) / 9) * 11);
    const parts = await renderDigestParts(view, { maxBytes: limit, maxParts: 3 });
    expect(parts.length).toBeLessThanOrEqual(3);
    for (const p of parts) {
      expect(Buffer.byteLength(p.html)).toBeLessThanOrEqual(limit);
      expect(p.html).not.toContain("篇幅所限");
    }
    const kept = parts.flatMap((p) => p.tweetIds);
    const { dropped } = parts[0]!;
    expect(dropped.length).toBeGreaterThan(0);
    expect(kept.length + dropped.length).toBe(60);
    // 去掉的都比留下的分数低（只剩一条的主题保底留下的那条除外）
    const score = new Map(groups.flatMap((g) => g.items.map((c) => [c.id, c.score!])));
    const floors = groups.filter((g) => g.items.filter((c) => kept.includes(c.id)).length === 1).flatMap((g) => g.items.map((c) => c.id));
    const keptExceptFloor = kept.filter((id) => !floors.includes(id));
    expect(Math.max(...dropped.map((id) => score.get(id)!))).toBeLessThan(Math.min(...keptExceptFloor.map((id) => score.get(id)!)));
    for (const g of groups) expect(g.items.some((c) => kept.includes(c.id))).toBe(true);
  }, 60_000);

  it("标签页模式：带切换用的单选按钮和不支持时的主题目录", async () => {
    const { html } = await renderDigest(sampleDigest("zh"), { tabs: true });
    expect(html).toContain('id="xt-all"');
    expect(html).toMatch(/class="xt-toc[ "]/);
    expect(html).toContain("#xt-1:checked");
  });

  it("桌面最宽 640px（每行约 36 个汉字），窄于此宽度切换为手机版", async () => {
    const { html } = await renderDigest(sampleDigest("zh"));
    expect(html).toContain("max-width:640px");
    expect(html).toContain("@media (max-width:640px)");
    expect(html).toContain('name="viewport"');
  });

  it("单张卡片的体积控制在 3KB 左右", async () => {
    const view = sampleDigest("zh");
    const one = await renderDigest({ ...view, groups: [{ ...view.groups[0]!, items: [view.groups[0]!.items[0]!] }] });
    const two = await renderDigest({ ...view, groups: [{ ...view.groups[0]!, items: view.groups[0]!.items.slice(0, 2) }] });
    expect(Buffer.byteLength(two.html) - Buffer.byteLength(one.html)).toBeLessThan(3500);
  });

  it("超过 300 字的推文：作者行下先给 AI 摘要，原文折叠；短推文不加摘要", async () => {
    const view = sampleDigest("zh");
    const long = { ...view.groups[0]!.items[0]!, parts: ["很长的正文。".repeat(60)] };
    const short = view.groups[0]!.items[1]!;
    const { html } = await renderDigest({ ...view, groups: [{ ...view.groups[0]!, items: [long, short] }] });
    expect(html).toContain("AI 摘要");
    expect(html).toContain(long.summary!);
    expect(html).toContain(`id="xr-${long.id}"`);
    expect(html).toContain("展开原文");
    expect(html).not.toContain(`id="xr-${short.id}"`);
    // 不支持 :checked 的邮箱看到的是摘要 + 原文，原文不能只靠 CSS 才显示
    expect(html).toMatch(/class="xr-body"[^>]*>/);
    expect(html).not.toMatch(/class="xr-body"[^>]*display:none/);
  });

  it("多图：滑动横条 + 原地放大（不用浮层）；视频封面不链到 X；不支持的邮箱点图打开大图文件", async () => {
    const view = sampleDigest("zh");
    const imgs = [1, 2].map((n) => ({ url: `https://pbs.twimg.com/media/i${n}?name=small`, href: `https://pbs.twimg.com/media/i${n}?name=large` }));
    const card = { ...view.groups[0]!.items[0]!, images: imgs };
    const video = { ...view.groups[0]!.items[1]!, images: [], video: { thumbUrl: "https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg" } };
    const { html } = await renderDigest({ ...view, groups: [{ ...view.groups[0]!, items: [card, video] }] });
    expect(html).toContain(`class="xgm xg-${card.id}"`);
    // 两张图共用一组单选按钮：默认"都不放大"，点哪张放大哪张
    expect(html).toContain(`id="xi-${card.id}-n"`);
    expect(html).toContain(`id="xi-${card.id}-1"`);
    expect(html).toContain('class="xz-1"');
    expect(html).not.toContain("position:fixed");
    expect(html).toMatch(/class="xi-a"[^>]*href="https:\/\/pbs\.twimg\.com\/media\/i1\?name=large"|href="https:\/\/pbs\.twimg\.com\/media\/i1\?name=large"[^>]*class="xi-a"/);
    expect(html).toContain("左右滑动查看");
    // 视频封面不再包在链接里
    expect(html).not.toMatch(/<a[^>]*>\s*<img[^>]*amplify_video_thumb/);
    // 两张图都没给尺寸时不生成比例规则，用默认的最高 480px
    expect(html).not.toContain(`.xg-${card.id} .xgi img{aspect-ratio`);
  });

  it("长推文优先显示 2–4 句的阅读摘要，没有时退回一句话摘要", async () => {
    const view = sampleDigest("zh");
    const base = { ...view.groups[0]!.items[0]!, parts: ["很长的正文。".repeat(60)] };
    const withReader = { ...base, readerSummary: { lead: "长上下文的瓶颈在位置而不是规模", points: ["超过 32k 后不同尺寸差距消失", "关键指令放末尾召回率提升 18%"] } };
    const one = await renderDigest({ ...view, groups: [{ ...view.groups[0]!, items: [withReader] }] });
    expect(one.html).toContain("长上下文的瓶颈在位置而不是规模");
    expect(one.html).toContain("· <!-- -->关键指令放末尾召回率提升 18%");
    // "展开原文"跟在最后一条要点后面，只出现一次
    expect(one.html.match(/class="xr-l"/g)).toHaveLength(1);
    const two = await renderDigest({ ...view, groups: [{ ...view.groups[0]!, items: [base] }] });
    expect(two.html).toContain(base.summary!);
  });

  it("带赞 / 踩链接（后台预览用）时在卡片底部最左边，每张只多几百字节", async () => {
    const view = sampleDigest("zh");
    const plain = await renderDigest(view);
    const items = view.groups.flatMap((g) => g.items);
    const withLinks = {
      ...view,
      groups: view.groups.map((g) => ({ ...g, items: g.items.map((c) => ({ ...c, feedback: { up: `https://x.test/f?t=${c.id}&v=up`, down: `https://x.test/f?t=${c.id}&v=down` } })) })),
    };
    const html = (await renderDigest(withLinks)).html;
    expect(html).toContain(`https://x.test/f?t=${items[0]!.id}&amp;v=down`);
    expect(plain.html).not.toContain("/f?t=");
    // 在卡片底部，排在"在 X 上查看"前面
    const down = html.indexOf(`/f?t=${items[0]!.id}&amp;v=down`);
    expect(down).toBeGreaterThan(html.indexOf(items[0]!.author.handle));
    expect(html.indexOf("在 X 上", down)).toBeGreaterThan(down);
    expect(html).toContain('data-vote="up"');
    expect((Buffer.byteLength(html) - Buffer.byteLength(plain.html)) / items.length).toBeLessThan(400);
  });
});
