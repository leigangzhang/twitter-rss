import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, RawTweet, toCardView } from "@xrss/core";
import { createDb, migrateDb, tweets } from "@xrss/core/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Summarizer } from "../src/ai.ts";
import { extractArticle, fetchArticle, fetchCandidateArticles, isSkipped, loadDigests, primaryArticle, summarizeArticles } from "../src/links.ts";

const ARTICLE = `<!doctype html><html><head>
<title>Maintaining software | Dev Blog</title>
<meta property="og:title" content="Maintaining software with agents">
<meta property="og:description" content="How a team uses coding agents to remove unused code and speed up CI.">
<meta property="og:image" content="/img/cover.png">
<meta property="og:site_name" content="Dev Blog">
</head><body><nav>Home · Blog · About</nav><article><h1>Maintaining software with agents</h1>
${"<p>A few months ago we had to tell the agent exactly where to look for dead code. Now it finds candidates on its own, checks them against production telemetry, and drafts cleanup pull requests for review.</p>".repeat(6)}
</article><footer>© Dev Blog</footer></body></html>`;

let server: Server;
let base = "";
let hits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    if (req.url === "/post") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(ARTICLE);
    } else if (req.url === "/moved") {
      res.writeHead(301, { location: "/post" });
      res.end();
    } else if (req.url === "/pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end("%PDF");
    } else if (req.url === "/slow") {
      setTimeout(() => res.end("<html></html>"), 2000);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const opts = { timeoutMs: 1000, maxBytes: 1_000_000 };

describe("抓取外部文章", () => {
  it("提取 og 信息和正文，封面转成绝对地址", () => {
    const a = extractArticle(ARTICLE, "https://blog.example.com/post");
    expect(a).toMatchObject({
      title: "Maintaining software with agents",
      description: "How a team uses coding agents to remove unused code and speed up CI.",
      imageUrl: "https://blog.example.com/img/cover.png",
      siteName: "Dev Blog",
    });
    expect(a.text).toContain("checks them against production telemetry");
    expect(a.text).not.toContain("© Dev Blog");
  });

  it("跟随跳转，记录最终地址", async () => {
    const d = await fetchArticle(`${base}/moved`, opts);
    expect(d).toMatchObject({ status: "fetched", finalUrl: `${base}/post`, title: "Maintaining software with agents" });
    expect(d.textLength).toBeGreaterThan(500);
  });

  it("非网页、404、超时都返回 failed 而不是抛错", async () => {
    expect(await fetchArticle(`${base}/pdf`, opts)).toMatchObject({ status: "failed" });
    expect(await fetchArticle(`${base}/missing`, opts)).toMatchObject({ status: "failed", error: "HTTP 404" });
    expect(await fetchArticle(`${base}/slow`, { ...opts, timeoutMs: 200 })).toMatchObject({ status: "failed", error: "请求超时" });
  });

  it("需要登录的站点不抓取", () => {
    expect(isSkipped("https://x.com/i/article/1", ["x.com"])).toBe(true);
    expect(isSkipped("https://mobile.twitter.com/a", ["twitter.com"])).toBe(true);
    expect(isSkipped("https://developers.example.com/blog", ["x.com"])).toBe(false);
  });
});

// 一条引用推文，被引用的推文里有外部文章链接（对应 OpenAI Developers 引用 Rodrigo Roim 的场景）
const quoting = (url: string) =>
  RawTweet.parse({
    id: "300",
    url: "https://x.com/devs/status/300",
    author: { handle: "devs", name: "Devs" },
    createdAt: "2026-10-18T03:00:00Z",
    lang: "en",
    text: "Here's how our engineers chip away at the maintenance backlog:",
    metrics: { likes: 1913, reposts: 130, replies: 98 },
    quoted: {
      id: "299",
      url: "https://x.com/eng/status/299",
      author: { handle: "eng", name: "Engineer" },
      text: "Software maintenance is changing. Here's how we do this.",
      links: [{ kind: "web", url: "https://t.co/x", expandedUrl: url, domain: "127.0.0.1", title: "Card title from X" }],
    },
  });

describe("文章缓存、摘要和展示", () => {
  it("引用推文里的文章：抓取一次并缓存，生成摘要后显示在引用框内", async () => {
    const config = loadConfig(join(import.meta.dirname, "..", "..", "..", "config"));
    config.digest.links.skip_domains = ["x.com"];
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "xrss-")), "app.db")}`);
    await migrateDb(db);
    const raw = quoting(`${base}/post`);
    expect(primaryArticle(raw)).toMatchObject({ source: "quoted" });

    const row = { id: raw.id, handle: "devs", createdAt: new Date(raw.createdAt), kind: "text" as const, raw, engagement: 1, status: "scored" as const, topicId: "ai" };
    await db.insert(tweets).values(row);
    const [stored] = await db.select().from(tweets);

    hits = 0;
    const first = await fetchCandidateArticles(db, config, [stored!]);
    expect(first.fetched).toBe(1);
    expect(first.byTweet.get("300")).toMatchObject({ status: "fetched", title: "Maintaining software with agents" });
    const second = await fetchCandidateArticles(db, config, [stored!]);
    expect(second.fetched).toBe(0);
    expect(hits).toBe(1);

    const summarizer: Summarizer = {
      async summarize(article, context) {
        expect(context.lang).toBe("en");
        return {
          titleZh: "用智能体维护软件",
          summary: `概要：${article.title}`,
          points: ["自动找死代码", "对照线上遥测核实", "起草清理 PR"],
          orig: { lang: "en", summary: "Agents find dead code and draft cleanup PRs.", points: ["Checks live telemetry first"] },
        };
      },
    };
    const range = { since: new Date("2026-10-17T16:00:00Z"), until: new Date("2026-10-18T16:00:00Z"), contentDate: "2026-10-18" };
    expect(await summarizeArticles(db, range, summarizer)).toMatchObject({ summarized: 1, failed: [] });
    expect(await summarizeArticles(db, range, summarizer)).toMatchObject({ summarized: 0 });

    const digest = (await loadDigests(db, [`${base}/post`])).get(`${base}/post`)!;
    const view = (lang: "zh" | "orig") =>
      toCardView({ id: raw.id, topicId: "ai", kind: "text", raw, ai: null, article: digest }, { lang, timezone: "Asia/Shanghai", videoMode: "summary", maxThreadParts: 8 });
    const zh = view("zh");
    expect(zh.article).toBeUndefined();
    expect(zh.quoted?.article).toMatchObject({
      title: "用智能体维护软件",
      originalTitle: "Maintaining software with agents",
      summary: "概要：Maintaining software with agents",
      aiSummary: true,
      points: ["自动找死代码", "对照线上遥测核实", "起草清理 PR"],
      url: `${base}/post`,
    });
    expect(zh.quoted?.article?.imageUrl).toBe(`${base}/img/cover.png`);
    // 原文版：原标题 + 按推文语言写的概要，卡片格式和中文版相同
    expect(view("orig").quoted?.article).toMatchObject({
      title: "Maintaining software with agents",
      originalTitle: undefined,
      summary: "Agents find dead code and draft cleanup PRs.",
      aiSummary: true,
      points: ["Checks live telemetry first"],
    });
  });

  it("抓取失败时用 X 卡片的标题兜底", async () => {
    const config = loadConfig(join(import.meta.dirname, "..", "..", "..", "config"));
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), "xrss-")), "app.db")}`);
    await migrateDb(db);
    const raw = quoting(`${base}/missing`);
    await db.insert(tweets).values({ id: raw.id, handle: "devs", createdAt: new Date(raw.createdAt), kind: "text", raw, engagement: 1, status: "new" });
    const [stored] = await db.select().from(tweets);
    const res = await fetchCandidateArticles(db, config, [stored!]);
    expect(res.failed).toBe(1);
    expect(res.byTweet.get("300")).toMatchObject({ status: "failed", title: "Card title from X" });
  });
});
