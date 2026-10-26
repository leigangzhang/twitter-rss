import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detailTargets, findProfile, parseXGraphQL, smallAvatar } from "../src/parsers/x-graphql.ts";

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "user-tweets.json"), "utf8"));
const liveFixture = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "user-originals-live.json"), "utf8"));

describe("parseXGraphQL", () => {
  const { tweets, skipped } = parseXGraphQL([fixture], "mirachen_ml");
  const byId = Object.fromEntries(tweets.map((t) => [t.id, t]));

  it("跳过广告，Thread 后续部分合并进开头那条", () => {
    expect(skipped).toEqual([]);
    expect(tweets.map((t) => t.id)).toEqual(["1900000000000000003", "1900000000000000002", "1900000000000000001"]);
  });

  it("长推文取全文，媒体链接去掉，t.co 还原", () => {
    const t = byId["1900000000000000003"]!;
    // 结尾的外链以文章卡片展示，不在正文里重复
    expect(t.text).toBe("Full long text that is longer than 280 characters would be here. Read more:");
    expect(t.author).toEqual({ handle: "mirachen_ml", name: "Mira Chen", avatarUrl: "https://pbs.twimg.com/profile_images/1/a_bigger.jpg" });
    expect(t.createdAt).toBe("2026-10-18T01:12:00.000Z");
    expect(t.metrics).toMatchObject({ likes: 23000, reposts: 3104, quotes: 88, views: 120345 });
    expect(t.media).toEqual([{ type: "video", url: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/v.jpg", width: 1280, height: 720, durationSec: 408 }]);
    expect(t.links[0]).toMatchObject({ expandedUrl: "https://www.example.org/study", title: "Long context study", domain: "example.org" });
    expect(t.thread).toEqual([{ id: "1900000000000000004", text: "Second part of the thread & more.", media: [] }]);
    expect(t.isReply).toBe(false);
  });

  it("展开引用推文，正文去掉引用链接", () => {
    const t = byId["1900000000000000002"]!;
    expect(t.text).toBe("Worth reading.");
    expect(t.links).toEqual([]);
    expect(t.quoted).toMatchObject({ id: "1800000000000000001", author: { handle: "theopark" }, text: "Quoted original text" });
  });

  it("标记纯转发", () => {
    expect(byId["1900000000000000001"]!.isRepost).toBe(true);
  });
});

describe("parseXGraphQL 真实 UserOriginalsTimeline 结构", () => {
  // 结构取自 Browser Skill 抓取到的真实响应，账号、正文、URL 和指标均已脱敏。
  const { tweets, skipped } = parseXGraphQL([liveFixture], "fixture_author");

  it("从时间线 envelope 中提取推文并合并作者自己的连续回复", () => {
    expect(skipped).toEqual([]);
    expect(tweets).toHaveLength(1);
    expect(tweets[0]).toMatchObject({
      id: "1900000000000000100",
      text: "Live timeline payload parsed correctly. Read more:",
      author: { handle: "fixture_author", name: "Fixture Author", avatarUrl: "https://example.com/avatar_bigger.jpg" },
      metrics: { likes: 42, reposts: 5, replies: 4, quotes: 3, bookmarks: 12, views: 1234 },
      thread: [{ id: "1900000000000000103", text: "Second fixture part.", media: [] }],
    });
  });

  it("保留真实响应里的媒体、链接和引用推文", () => {
    const t = tweets[0]!;
    expect(t.media).toEqual([
      { type: "photo", url: "https://example.com/photo.jpg", width: 1200, height: 800, altText: "Example diagram" },
    ]);
    expect(t.links).toEqual([{ kind: "web", url: "https://t.co/live1", expandedUrl: "https://example.org/live", domain: "example.org" }]);
    expect(t.quoted).toMatchObject({
      id: "1800000000000000100",
      author: { handle: "quoted_author", name: "Quoted Author" },
      text: "Quoted fixture text.",
    });
  });
});

describe("长推文截断与详情页补抓", () => {
  const sample = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "truncated-and-detail.json"), "utf8"));

  it("时间线里接近 280 字符上限的推文标记为可能截断，X 长文缺标题时列入补抓清单", () => {
    const { tweets } = parseXGraphQL([sample.timeline], "fixture_author");
    const byId = Object.fromEntries(tweets.map((t) => [t.id, t]));
    expect(byId["1900000000000000201"]!.textTruncated).toBe(true);
    expect(byId["1900000000000000203"]!.textTruncated).toBe(false);
    const article = byId["1900000000000000202"]!;
    expect(article.text).toBe("");
    expect(article.links).toEqual([{ kind: "x_article", url: "https://t.co/art1", expandedUrl: "https://x.com/i/article/1900000000000000999", domain: "x.com" }]);
    expect(detailTargets(tweets)).toEqual([
      { id: "1900000000000000202", url: "https://x.com/fixture_author/status/1900000000000000202", reason: "x_article" },
      { id: "1900000000000000201", url: "https://x.com/fixture_author/status/1900000000000000201", reason: "truncated" },
    ]);
  });

  it("同一个响应里有推文带 note_tweet（接口会给全文）时，没带的接近上限的推文不算截断", () => {
    const timeline = structuredClone(sample.timeline);
    // 给响应里另一条推文加上 note_tweet，模拟 UserTweets 接口
    const json = JSON.stringify(timeline);
    const withNote = json.replace(
      /("rest_id":\s*"1900000000000000203")/,
      '$1,"note_tweet":{"is_expandable":true,"note_tweet_results":{"result":{"text":"一条长推文的全文"}}}',
    );
    expect(withNote).not.toBe(json);
    const { tweets } = parseXGraphQL([JSON.parse(withNote)], "fixture_author");
    const byId = Object.fromEntries(tweets.map((t) => [t.id, t]));
    expect(byId["1900000000000000203"]!.text).toBe("一条长推文的全文");
    expect(byId["1900000000000000201"]!.textTruncated).toBe(false);
  });

  it("合并详情页响应：取全文、补上长文标题，互动数取较新的", () => {
    const { tweets } = parseXGraphQL([sample.timeline, ...sample.details], "fixture_author");
    const byId = Object.fromEntries(tweets.map((t) => [t.id, t]));
    const long = byId["1900000000000000201"]!;
    expect(long.textTruncated).toBe(false);
    expect(long.text.endsWith("第三段：直接关系。你必须直接从粉丝那里收钱。")).toBe(true);
    expect(long.metrics).toMatchObject({ likes: 5, views: 626 });
    expect(byId["1900000000000000202"]!.links[0]).toMatchObject({
      kind: "x_article",
      title: "大分发时代：导言",
      description: "为什么分发能力决定了创作者能拿到多少价值。",
      imageUrl: "https://example.com/cover.jpg",
    });
    expect(detailTargets(tweets)).toEqual([]);
  });

  it("响应顺序不影响合并结果", () => {
    const a = parseXGraphQL([sample.timeline, ...sample.details], "fixture_author").tweets;
    const b = parseXGraphQL([...sample.details, sample.timeline], "fixture_author").tweets;
    expect(b).toEqual(a);
  });
});

describe("引用推文里的外部链接", () => {
  const user = (screen_name: string, name: string) => ({ user_results: { result: { core: { screen_name, name } } } });
  const response = {
    data: {
      tweet_results: {
        result: {
          __typename: "Tweet",
          rest_id: "1900000000000000300",
          core: user("devs", "Devs"),
          quoted_status_result: {
            result: {
              __typename: "Tweet",
              rest_id: "1900000000000000299",
              core: user("eng", "Engineer"),
              card: {
                legacy: {
                  url: "https://t.co/post1",
                  binding_values: [
                    { key: "title", value: { string_value: "Maintaining software with agents" } },
                    { key: "domain", value: { string_value: "developers.example.com" } },
                    { key: "thumbnail_image_original", value: { image_value: { url: "https://pbs.twimg.com/card_img/9.jpg" } } },
                  ],
                },
              },
              legacy: {
                id_str: "1900000000000000299",
                created_at: "Sat Oct 17 20:00:00 +0000 2026",
                full_text: "Software maintenance is changing. Here's how we do this. https://t.co/post1",
                entities: { urls: [{ url: "https://t.co/post1", expanded_url: "https://developers.example.com/blog/maintaining" }] },
              },
            },
          },
          legacy: {
            id_str: "1900000000000000300",
            created_at: "Sun Oct 18 05:50:00 +0000 2026",
            full_text: "Here's how our engineers do it: https://t.co/q",
            quoted_status_permalink: { url: "https://t.co/q", expanded: "https://twitter.com/eng/status/1900000000000000299" },
            favorite_count: 1913,
            retweet_count: 130,
            reply_count: 98,
            quote_count: 0,
            entities: { urls: [{ url: "https://t.co/q", expanded_url: "https://twitter.com/eng/status/1900000000000000299" }] },
          },
        },
      },
    },
  };

  it("保留被引用推文里的链接和卡片，正文结尾的链接不重复显示", () => {
    const { tweets } = parseXGraphQL([response], "devs");
    expect(tweets[0]!.text).toBe("Here's how our engineers do it:");
    expect(tweets[0]!.quoted).toMatchObject({
      text: "Software maintenance is changing. Here's how we do this.",
      links: [
        {
          kind: "web",
          expandedUrl: "https://developers.example.com/blog/maintaining",
          title: "Maintaining software with agents",
          domain: "developers.example.com",
          imageUrl: "https://pbs.twimg.com/card_img/9.jpg",
        },
      ],
    });
  });
});

describe("账号资料（头像）", () => {
  it("从 UserByScreenName 响应里取头像，前一天没发推也能拿到", () => {
    const profileResponse = {
      data: {
        user: {
          result: {
            __typename: "User",
            rest_id: "1",
            core: { screen_name: "DarioAmodei", name: "Dario Amodei" },
            avatar: { image_url: "https://pbs.twimg.com/profile_images/9/abc_normal.jpg" },
          },
        },
      },
    };
    expect(findProfile([{ data: {} }, profileResponse], "darioamodei")).toEqual({
      name: "Dario Amodei",
      avatarUrl: "https://pbs.twimg.com/profile_images/9/abc_bigger.jpg",
    });
    expect(findProfile([profileResponse], "someone_else")).toBeUndefined();
  });

  it("时间线响应里的作者资料也算", () => {
    expect(findProfile([fixture], "mirachen_ml")).toEqual({ name: "Mira Chen", avatarUrl: "https://pbs.twimg.com/profile_images/1/a_bigger.jpg" });
  });

  it("头像统一换成 _bigger 尺寸", () => {
    expect(smallAvatar("https://pbs.twimg.com/profile_images/1/a_400x400.jpg")).toBe("https://pbs.twimg.com/profile_images/1/a_bigger.jpg");
    expect(smallAvatar("https://pbs.twimg.com/profile_images/1/a_bigger.png")).toBe("https://pbs.twimg.com/profile_images/1/a_bigger.png");
    expect(smallAvatar(undefined)).toBeUndefined();
  });
});
