import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@xrss/core";
import type { Browser, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromeOptions, connectChrome, ensureChrome } from "../src/browser/chrome.ts";
import { captureFollowing } from "../src/browser/x-page.ts";
import { explainConnectError } from "../src/browser/chrome.ts";
import { acquireBrowserLock, EMPTY_SYNC, type FollowSyncState, lockHolder, parseFollowing, planSync, runningSync, syncDue } from "../src/follows.ts";
import { EMPTY_STATE, recordBlock } from "../src/health.ts";
import { budgetWarning, estimateDailyAccounts } from "../src/quality.ts";
import { createRandom } from "../src/random.ts";

const config = loadConfig(join(import.meta.dirname, "..", "..", "..", "config"));

/** 模拟 X "正在关注"页的 GraphQL 响应：新版把 screen_name 放在 core，旧版在 legacy */
function followingPage(users: string[], legacy = false) {
  return {
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [
                    ...users.map((h) => ({
                      entryId: `user-${h}`,
                      content: {
                        itemContent: {
                          itemType: "TimelineUser",
                          user_results: { result: legacy ? { legacy: { screen_name: h, name: h.toUpperCase() } } : { core: { screen_name: h, name: h.toUpperCase() }, avatar: { image_url: `https://pbs.twimg.com/${h}_normal.jpg` } } },
                        },
                      },
                    })),
                    { entryId: "cursor-bottom-1", content: { value: "abc", cursorType: "Bottom" } },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  };
}

describe("关注列表解析", () => {
  it("新旧两种写法都能取出账号，去重并保留顺序", () => {
    const users = parseFollowing([followingPage(["Alice", "bob"]), followingPage(["BOB", "carol"], true)]);
    expect(users.map((u) => u.handle)).toEqual(["Alice", "bob", "carol"]);
    expect(users[0]).toMatchObject({ name: "ALICE", avatarUrl: "https://pbs.twimg.com/Alice_bigger.jpg" });
  });
});

describe("同步计划", () => {
  const users = (...hs: string[]) => hs.map((handle) => ({ handle }));

  it("只加名单里没有的，跳过自己和已在任何主题里的账号", () => {
    const plan = planSync(EMPTY_SYNC, users("Karpathy", "NewOne", "me", "other"), config.accounts, "Me", true);
    expect(plan.add).toEqual(["NewOne", "other"]);
    expect(plan.next.added).toEqual(["newone", "other"]);
  });

  it("同步加进来后被手动移出的，以后不再加；取关的只在列表读完时标出", () => {
    const state: FollowSyncState = { ...EMPTY_SYNC, added: ["gone", "kept", "dropped"] };
    const tracked = [...config.accounts, "kept", "dropped"];
    const plan = planSync(state, users("gone", "kept", "fresh"), tracked, "me", true);
    expect(plan.newlyIgnored).toEqual(["gone"]);
    expect(plan.add).toEqual(["fresh"]);
    expect(plan.unfollowed).toEqual(["dropped"]);
    expect(plan.next.ignored).toEqual(["gone"]);

    const partial = planSync({ ...state, unfollowed: ["dropped"] }, users("kept"), tracked, "me", false);
    expect(partial.unfollowed).toEqual(["dropped"]);
    expect(partial.add).toEqual([]);
  });

  it("按间隔判断是否该自动同步；上次失败的不算", () => {
    const now = new Date("2026-10-28T08:00:00Z");
    expect(syncDue(EMPTY_SYNC, config, now)).toBe(true);
    const ok = { ...EMPTY_SYNC, lastSyncAt: "2026-10-25T08:00:00Z", last: { at: "", ok: true, message: "", added: [] } };
    expect(syncDue(ok, config, now)).toBe(false);
    expect(syncDue({ ...ok, lastSyncAt: "2026-10-21T08:30:00Z" }, config, now)).toBe(true);
    expect(syncDue({ ...ok, last: { ...ok.last, ok: false } }, config, now)).toBe(true);
    expect(syncDue({ ...ok, last: { ...ok.last, dryRun: true } }, config, now)).toBe(true);
  });

  it("进度里的进程已经不在时，不算正在同步", () => {
    const progress = { pid: process.pid, startedAt: "", dryRun: false, step: "read" as const, read: 40 };
    expect(runningSync({ ...EMPTY_SYNC, progress })).toEqual(progress);
    expect(runningSync({ ...EMPTY_SYNC, progress: { ...progress, pid: 2 ** 22 + 12345 } })).toBeNull();
  });

  it("连不上采集 Chrome 时给出能照着做的说明", () => {
    const e = new Error("browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.\nCall log: ...");
    const msg = explainConnectError(e, { port: 9333 });
    expect(msg).toContain("pnpm crawl:chrome");
    expect(msg).toContain("Browser context management is not supported");
    expect(msg).not.toContain("Call log");
  });
});

describe("同步时遇到限制", () => {
  it("和采集一样进入冷却，但不算一次采集", () => {
    const now = new Date("2026-10-28T08:00:00Z");
    const next = recordBlock(EMPTY_STATE, { date: "2026-10-28", handle: "me", status: "rate_limited", error: "Following 返回 429" }, config.crawl, now);
    expect(next.cooldownUntil).toBe(new Date(now.getTime() + config.crawl.cooldown.rate_limited_hours * 3_600_000).toISOString());
    expect(next.runs).toEqual([]);
    expect(next.incidents).toHaveLength(1);
  });
});

describe("采集 Chrome 的锁", () => {
  it("本进程拿到锁；锁里的进程已经不在时视为没有锁", () => {
    const path = join(mkdtempSync(join(tmpdir(), "xrss-lock-")), "browser.lock");
    expect(acquireBrowserLock("测试", path)).toBeNull();
    expect(lockHolder(path)?.pid).toBe(process.pid);
    writeFileSync(path, JSON.stringify({ pid: 999_999_999, what: "采集", at: "" }));
    expect(lockHolder(path)).toBeNull();
    writeFileSync(path, JSON.stringify({ pid: process.ppid, what: "采集", at: "x" }));
    expect(acquireBrowserLock("同步关注", path)).toContain("采集正在使用");
  });
});

describe("每天要采的账号数", () => {
  it("按采集间隔估算；轮一遍超过补收天数时才提醒", () => {
    // 20 小时 = 每天，44 = 隔天，68 = 每 3 天，92 = 每 4 天
    expect(estimateDailyAccounts([20, 20, 44, 44, 68, 92, 92, 92, 92], config)).toBe(Math.round(2 + 1 + 1 / 3 + 1));
    expect(budgetWarning(Array(40).fill(20), config)).toBeNull();
    // 超过上限但补收天数内能轮一遍：不漏内容，不提醒
    expect(budgetWarning(Array(150).fill(20), config)).toBeNull();
    const warn = budgetWarning(Array(300).fill(20), config);
    expect(warn).toContain("超过每天上限 50 个");
    expect(warn).toContain("部分内容会漏掉");
  });
});

/** 用本机 Chromium 和模拟 X 的本地服务器读一遍关注列表（需要 XRSS_TEST_CHROME，见 browser.test.ts） */
describe.skipIf(!process.env.XRSS_TEST_CHROME)("同步关注：连接真实 Chrome 走一遍", () => {
  let server: Server;
  let base = "";
  let browser: Browser;
  let page: Page;
  const pages = [["a1", "a2"], ["a3", "a4"], ["a5"]];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? "/";
      if (url.startsWith("/i/api/graphql/f/Following")) {
        const n = Number(new URL(url, "http://x").searchParams.get("p"));
        if (url.includes("u=limited")) {
          res.writeHead(429, { "content-type": "application/json" });
          return res.end("{}");
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(followingPage(pages[n] ?? [])));
      }
      const who = url.split("/")[1];
      res.writeHead(200, { "content-type": "text/html" });
      // 第一屏一页，之后每次滚动加载下一页，没有更多时不再请求
      res.end(
        `<!doctype html><body style="height:20000px"><script>let p=0;const load=()=>fetch('/i/api/graphql/f/Following?u=${who}&p='+p++);load();
        addEventListener('scroll',()=>{if(p<${pages.length}&&scrollY>p*1000-1500)load()})</script></body>`,
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const opts = { ...chromeOptions(), path: process.env.XRSS_TEST_CHROME!, profileDir: mkdtempSync(join(tmpdir(), "xrss-chrome-")), port: 9340, extraArgs: ["--headless=new", "--no-sandbox"] };
    await ensureChrome(opts);
    browser = await connectChrome(opts);
    page = await browser.contexts()[0]!.newPage();
  }, 60_000);

  afterAll(async () => {
    await browser?.newBrowserCDPSession().then((s) => s.send("Browser.close")).catch(() => {});
    server?.close();
  });

  const opts = (maxAccounts = 100) => ({ scrollPausesMs: Array(10).fill(100), maxAccounts, count: (r: unknown[]) => parseFollowing(r).length });

  it("滚到底读完整个列表", async () => {
    const out = await captureFollowing(page, `${base}/me/following`, opts(), createRandom(1));
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.complete).toBe(true);
    expect(parseFollowing(out.responses).map((u) => u.handle)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  }, 60_000);

  it("读到上限就停，不算读完", async () => {
    const out = await captureFollowing(page, `${base}/me/following`, opts(2), createRandom(1));
    expect(out).toMatchObject({ kind: "ok", complete: false });
  }, 60_000);

  it("关注列表接口 429 算限流", async () => {
    const out = await captureFollowing(page, `${base}/limited/following`, opts(), createRandom(1));
    expect(out).toMatchObject({ kind: "blocked", status: "rate_limited" });
  }, 60_000);
});
