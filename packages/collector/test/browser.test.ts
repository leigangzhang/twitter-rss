import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import { chromeArgs, chromeOptions, connectChrome, ensureChrome } from "../src/browser/chrome.ts";
import { budgetWait, captureAccount, classifyPage, formatClock, isOfflineError, pinnedIds, type RateLimit, rateLimits, reachedEnd, readRateLimit } from "../src/browser/x-page.ts";
import { createRandom } from "../src/random.ts";
import type { Step } from "../src/runner.ts";

const fixture = readFileSync(join(import.meta.dirname, "fixtures", "user-tweets.json"), "utf8");

describe("脚本采集：页面状态判断", () => {
  it("启动参数只有独立资料和本机调试端口，没有自动化参数", () => {
    const args = chromeArgs({ path: "/x", profileDir: "/p", port: 9333, extraArgs: [] });
    expect(args).toContain("--user-data-dir=/p");
    expect(args).toContain("--remote-debugging-port=9333");
    expect(args.join(" ")).not.toMatch(/enable-automation|headless|disable-blink-features/);
  });

  it("登录页、验证页、限流提示分别识别；正常主页不算", () => {
    expect(classifyPage("https://x.com/i/flow/login?redirect_after_login=%2Fsama", "")?.status).toBe("login_required");
    expect(classifyPage("https://x.com/account/access", "")?.status).toBe("captcha");
    expect(classifyPage("https://x.com/sama", "Rate limit exceeded")?.status).toBe("rate_limited");
    expect(classifyPage("https://x.com/sama", "Sam Altman @sama")).toBeNull();
    expect(classifyPage("https://x.com/loginfan", "")).toBeNull();
  });

  it("浏览器自己的网络错误算断网，X 的超时不算", () => {
    expect(isOfflineError("page.goto: net::ERR_INTERNET_DISCONNECTED at https://x.com/sama")).toBe(true);
    expect(isOfflineError("page.goto: net::ERR_PROXY_CONNECTION_FAILED")).toBe(true);
    expect(isOfflineError("page.goto: Timeout 45000ms exceeded.")).toBe(false);
  });

  it("看到早于 since 的推文（置顶除外）或上次看到的推文就停止滚动", () => {
    const body = JSON.parse(fixture);
    const step = { handle: "mirachen_ml", since: "2026-10-17T00:00:00.000Z", lastSeenId: null };
    expect(reachedEnd([body], step)).toBe(false);
    expect(reachedEnd([body], { ...step, since: "2026-10-18T00:00:00.000Z" })).toBe(true);
    expect(reachedEnd([body], { ...step, lastSeenId: "1900000000000000003" })).toBe(true);
    // 唯一早于 since 的是置顶推文时不停
    const pin = { type: "TimelinePinEntry", entry: { content: { itemContent: { tweet_results: { result: { rest_id: "1900000000000000001" } } } } } };
    expect(pinnedIds([{ data: { instructions: [pin] } }])).toEqual(new Set(["1900000000000000001"]));
  });
});

describe("脚本采集：X 返回的额度", () => {
  it("从响应头读出额度，缺任何一个头都返回 null", () => {
    const headers = { "x-rate-limit-limit": "50", "x-rate-limit-remaining": "37", "x-rate-limit-reset": "1793000000" };
    expect(readRateLimit("UserTweets", 200, headers)).toEqual({ op: "UserTweets", limit: 50, remaining: 37, resetAt: 1793000000_000, status: 200 });
    expect(readRateLimit("UserTweets", 200, { "x-rate-limit-limit": "50", "x-rate-limit-remaining": "37" })).toBeNull();
    expect(readRateLimit("UserTweets", 200, { ...headers, "x-rate-limit-remaining": "abc" })).toBeNull();
  });

  it("额度够、不够、已经过了重置时间", () => {
    const now = Date.parse("2026-10-26T08:00:00Z");
    const rl = (op: string, remaining: number, resetInMin: number): RateLimit => ({ op, limit: 50, remaining, resetAt: now + resetInMin * 60_000, status: 200 });
    const limits = new Map([
      ["UserTweets", rl("UserTweets", 3, 10)],
      ["UserByScreenName", rl("UserByScreenName", 1, 14)],
    ]);
    expect(budgetWait(limits, { UserTweets: 3, UserByScreenName: 1 }, now)).toBeNull();
    expect(budgetWait(limits, { UserTweets: 8, UserByScreenName: 2 }, now)).toMatchObject({ ms: 14 * 60_000, op: "UserByScreenName" });
    expect(budgetWait(limits, { UserTweets: 8 }, now + 11 * 60_000)).toBeNull();
    // 没见过的接口额度未知，不等
    expect(budgetWait(limits, { TweetDetail: 2 }, now)).toBeNull();
  });

  it("重置时间按北京时间显示", () => {
    expect(formatClock(Date.parse("2026-10-26T08:38:00Z"))).toBe("16:38");
  });
});

/**
 * 用本机 Chromium 和一个模拟 X 的本地服务器走一遍完整流程（需要设置 XRSS_TEST_CHROME=Chromium 程序路径）：
 *   XRSS_TEST_CHROME=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome pnpm --filter @xrss/collector test
 */
describe.skipIf(!process.env.XRSS_TEST_CHROME)("脚本采集：连接真实 Chrome 走一遍", () => {
  let server: Server;
  let base = "";
  let browser: Browser;
  let page: Page;
  const raw = mkdtempSync(join(tmpdir(), "xrss-auto-"));

  const html = (script: string) => `<!doctype html><body style="height:6000px"><script>${script}</script></body>`;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? "/";
      const json = (status: number, body: string) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(body);
      };
      if (url.startsWith("/i/api/graphql/p/UserByScreenName")) return json(200, url.includes("ghost") ? '{"data":{}}' : '{"data":{"user":{"result":{"__typename":"User"}}}}');
      if (url.startsWith("/i/api/graphql/t/UserTweets")) return url.includes("u=limited") ? json(429, "{}") : json(200, fixture);
      // 主页上的附带请求（推荐关注等）：sidelimited 账号返回 429
      if (url.startsWith("/i/api/graphql/s/ProfileSpotlightsQuery")) return json(url.includes("sidelimited") ? 429 : 200, "{}");
      res.writeHead(200, { "content-type": "text/html" });
      const who = url.slice(1);
      if (who === "ghost") return res.end(html(`fetch('/i/api/graphql/p/UserByScreenName?u=ghost')`));
      if (who === "locked") return res.end(html(`location.href='/i/flow/login'`));
      if (who === "i/flow/login") return res.end(html(""));
      res.end(
        html(`fetch('/i/api/graphql/s/ProfileSpotlightsQuery?u=${who}');fetch('/i/api/graphql/p/UserByScreenName?u=${who}');fetch('/i/api/graphql/t/UserTweets?u=${who}&page=1');
          let more=false;addEventListener('scroll',()=>{if(!more&&scrollY>300){more=true;fetch('/i/api/graphql/t/UserTweets?u=${who}&page=2')}})`),
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const opts = { ...chromeOptions(), path: process.env.XRSS_TEST_CHROME!, profileDir: mkdtempSync(join(tmpdir(), "xrss-chrome-")), port: 9339, extraArgs: ["--headless=new", "--no-sandbox"] };
    process.env.XRSS_CHROME_PORT = "9339";
    await ensureChrome(opts);
    browser = await connectChrome(opts);
    page = await browser.contexts()[0]!.newPage();
    mkdirSync(raw, { recursive: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.newBrowserCDPSession().then((s) => s.send("Browser.close")).catch(() => {});
    server?.close();
  });

  const step = (handle: string, extra: Partial<Step> = {}): Step => ({
    key: handle,
    kind: "account",
    handle,
    url: `${base}/${handle}`,
    since: "2026-10-01T00:00:00.000Z",
    lastSeenId: null,
    scrollPausesMs: [200, 200, 200, 200],
    waitSec: 0,
    status: "in_progress",
    ...extra,
  });

  it("正常账号：保存资料和时间线响应，滚动后的响应依次编号", async () => {
    const out = await captureAccount(page, step("mirachen_ml"), raw, createRandom(1));
    expect(out).toMatchObject({ kind: "ok", files: ["mirachen_ml-profile.json", "mirachen_ml-1.json", "mirachen_ml-2.json"] });
    expect(out.kind === "ok" && out.calls.map((c) => c.op)).toContain("UserTweets");
    expect(readdirSync(raw).filter((f) => f.startsWith("mirachen_ml"))).toHaveLength(3);
    expect(JSON.parse(readFileSync(join(raw, "mirachen_ml-1.json"), "utf8")).data.user).toBeTruthy();
    // 连接正常启动的 Chrome，页面里没有自动化标记
    expect(await page.evaluate(() => navigator.webdriver)).toBe(false);
  }, 60_000);

  it("已经看到早于 since 的推文时不再滚动", async () => {
    const out = await captureAccount(page, step("early", { since: "2026-10-18T00:00:00.000Z", handle: "mirachen_ml", url: `${base}/early` }), raw, createRandom(1));
    expect(out.kind).toBe("ok");
    expect(out.kind === "ok" && out.files.filter((f) => /-\d+\.json$/.test(f))).toHaveLength(1);
  }, 60_000);

  it("账号不存在、限流、跳到登录页分别返回对应结果", async () => {
    expect(await captureAccount(page, step("ghost"), raw, createRandom(1))).toMatchObject({ kind: "not_found", reason: "账号不存在" });
    expect(await captureAccount(page, step("limited"), raw, createRandom(1))).toMatchObject({ kind: "blocked", status: "rate_limited" });
    expect(await captureAccount(page, step("locked"), raw, createRandom(1))).toMatchObject({ kind: "blocked", status: "login_required" });
  }, 90_000);

  it("附带请求返回 429 不算限流，必要接口 429 才停止", async () => {
    const side = await captureAccount(page, step("sidelimited"), raw, createRandom(1));
    expect(side.kind).toBe("ok");
    expect(side.kind === "ok" && side.calls).toContainEqual({ op: "ProfileSpotlightsQuery", status: 429 });
    const essential = await captureAccount(page, step("limited"), raw, createRandom(1));
    expect(essential).toMatchObject({ kind: "blocked", status: "rate_limited", error: expect.stringContaining("UserTweets 返回 429") });
  }, 90_000);

  it("时间线额度只剩 1 次时不再往下滚", async () => {
    rateLimits.clear();
    const server2 = createServer((req, res) => {
      const url = req.url ?? "/";
      if (url.startsWith("/i/api/graphql/t/UserTweets")) {
        res.writeHead(200, { "content-type": "application/json", "x-rate-limit-limit": "50", "x-rate-limit-remaining": "1", "x-rate-limit-reset": String(Math.floor(Date.now() / 1000) + 600) });
        return res.end(fixture);
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html(`fetch('/i/api/graphql/t/UserTweets?page=1');addEventListener('scroll',()=>fetch('/i/api/graphql/t/UserTweets?page=2'))`));
    });
    await new Promise<void>((r) => server2.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server2.address() as { port: number }).port}/budget`;
    const out = await captureAccount(page, step("mirachen_ml", { url }), raw, createRandom(1));
    server2.close();
    expect(out).toMatchObject({ kind: "ok", note: expect.stringContaining("UserTweets 额度剩 1/50") });
    expect(out.kind === "ok" && out.calls.filter((c) => c.op === "UserTweets")).toHaveLength(1);
    rateLimits.clear();
  }, 60_000);
});
