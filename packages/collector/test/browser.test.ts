import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import { chromeArgs, chromeOptions, connectChrome, ensureChrome } from "../src/browser/chrome.ts";
import { captureAccount, classifyPage, isOfflineError, pinnedIds, reachedEnd } from "../src/browser/x-page.ts";
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
      if (url.startsWith("/i/api/graphql/t/UserTweets")) return url.includes("limited") ? json(429, "{}") : json(200, fixture);
      res.writeHead(200, { "content-type": "text/html" });
      const who = url.slice(1);
      if (who === "ghost") return res.end(html(`fetch('/i/api/graphql/p/UserByScreenName?u=ghost')`));
      if (who === "locked") return res.end(html(`location.href='/i/flow/login'`));
      if (who === "i/flow/login") return res.end(html(""));
      res.end(
        html(`fetch('/i/api/graphql/p/UserByScreenName?u=${who}');fetch('/i/api/graphql/t/UserTweets?u=${who}&page=1');
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
    expect(out).toEqual({ kind: "ok", files: ["mirachen_ml-profile.json", "mirachen_ml-1.json", "mirachen_ml-2.json"] });
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
    expect(await captureAccount(page, step("ghost"), raw, createRandom(1))).toEqual({ kind: "not_found", reason: "账号不存在" });
    expect(await captureAccount(page, step("limited"), raw, createRandom(1))).toMatchObject({ kind: "blocked", status: "rate_limited" });
    expect(await captureAccount(page, step("locked"), raw, createRandom(1))).toMatchObject({ kind: "blocked", status: "login_required" });
  }, 90_000);
});
