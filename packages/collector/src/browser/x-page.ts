import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page, Response } from "playwright-core";
import { parseXGraphQL, profileUnavailable } from "../parsers/x-graphql.ts";
import type { Random } from "../random.ts";
import type { BlockStatus, Step } from "../runner.ts";

/**
 * 用脚本在真实 Chrome 里完成一步采集：打开页面、把 X 自己发出的 GraphQL 响应原样存下来、按清单给的停顿滚动。
 * 和 Browser Skill 的做法一样，只是响应正文没有 256 KiB 的上限，时间线响应里的长推文全文（note_tweet）也一起保存。
 * 只浏览，不点击任何按钮；遇到登录页、验证页、限流就返回对应状态，由调用方停止采集。
 */

export type StepOutcome =
  | { kind: "ok"; files: string[] }
  | { kind: "not_found"; reason: string }
  | { kind: "blocked"; status: BlockStatus; error: string }
  | { kind: "offline"; error: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const GRAPHQL = /\/i\/api\/graphql\/[^/]+\/([A-Za-z]+)/;
const TIMELINE_OPS = new Set(["UserTweets", "UserOriginalsTimeline"]);

/** 页面加载出来后这么久还没有时间线响应，就算没加载出来 */
const TIMELINE_TIMEOUT_MS = 30_000;
/** 滚动后等新响应的时间；连续两次滚动都没有新内容，说明到底了 */
const SCROLL_RESPONSE_MS = 5_000;

/** 浏览器自己的网络错误（断网、代理/VPN 没开），不是 X 的问题 */
export function isOfflineError(message: string): boolean {
  return /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_|PROXY_|ADDRESS_UNREACHABLE|NETWORK_|TIMED_OUT|TUNNEL_)/.test(message);
}

/** 页面地址或内容说明需要人工处理时，返回对应状态 */
export function classifyPage(url: string, text: string): { status: BlockStatus; error: string } | null {
  const path = new URL(url).pathname;
  if (/^\/(i\/flow\/login|login|logout)(\/|$)/.test(path)) return { status: "login_required", error: `跳转到了登录页 ${url}` };
  if (/\/account\/access|\/i\/flow\/(consent|verify)|arkose/i.test(url)) return { status: "captcha", error: `跳转到了验证页 ${url}` };
  if (/Rate limit exceeded|请求过多|超出速率限制/i.test(text)) return { status: "rate_limited", error: "页面提示 Rate limit exceeded" };
  if (/Your account is (locked|suspended)|账号已被锁定|账号已被冻结/i.test(text)) return { status: "login_required", error: "页面提示账号被锁定或冻结" };
  return null;
}

/** 时间线响应里的置顶推文 ID（滚动停止条件里要排除它） */
export function pinnedIds(responses: unknown[]): Set<string> {
  const out = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 30) return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    const o = node as Record<string, any>;
    if (o.type === "TimelinePinEntry") {
      const id = o.entry?.content?.itemContent?.tweet_results?.result?.rest_id ?? o.entry?.content?.itemContent?.tweet_results?.result?.tweet?.rest_id;
      if (typeof id === "string") out.add(id);
    }
    for (const v of Object.values(o)) visit(v, depth + 1);
  };
  for (const r of responses) visit(r, 0);
  return out;
}

/** 已经看到早于 since 的推文（置顶除外）或上次看到的那条推文时，不用再往下滚 */
export function reachedEnd(responses: unknown[], step: Pick<Step, "handle" | "since" | "lastSeenId">): boolean {
  const pinned = pinnedIds(responses);
  const { tweets } = parseXGraphQL(responses, step.handle);
  const since = step.since ? new Date(step.since).getTime() : undefined;
  return tweets.some(
    (t) => !pinned.has(t.id) && ((step.lastSeenId && t.id === step.lastSeenId) || (since !== undefined && new Date(t.createdAt).getTime() < since)),
  );
}

/** 监听页面发出的 GraphQL 请求，返回已收到的响应（按到达顺序） */
function listen(page: Page) {
  const got: Array<{ op: string; status: number; body: unknown }> = [];
  const pending = new Set<Promise<void>>();
  const onResponse = (res: Response) => {
    const m = GRAPHQL.exec(res.url());
    if (!m) return;
    const op = m[1]!;
    const p = res
      .text()
      .then((text) => {
        let body: unknown = null;
        try {
          body = JSON.parse(text);
        } catch {
          // 非 JSON（比如限流时的 HTML）只记状态码
        }
        got.push({ op, status: res.status(), body });
      })
      .catch(() => {})
      .finally(() => pending.delete(p));
    pending.add(p);
  };
  page.on("response", onResponse);
  return {
    got,
    settle: () => Promise.all([...pending]),
    stop: () => page.off("response", onResponse),
  };
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (check()) return true;
    await sleep(300);
  }
  return check();
}

async function open(page: Page, url: string): Promise<StepOutcome | null> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    return null;
  } catch (e) {
    const message = (e as Error).message;
    if (isOfflineError(message)) return { kind: "offline", error: message.split("\n")[0]! };
    return { kind: "blocked", status: "error", error: `页面打不开：${message.split("\n")[0]}` };
  }
}

async function blockedByPage(page: Page): Promise<StepOutcome | null> {
  const text = await page
    .locator("body")
    .innerText({ timeout: 3000 })
    .catch(() => "");
  const hit = classifyPage(page.url(), text);
  return hit ? { kind: "blocked", ...hit } : null;
}

/** 账号主页：保存时间线响应 raw/<handle>-1.json、-2.json…，账号资料 raw/<handle>-profile.json */
export async function captureAccount(page: Page, step: Step, rawDir: string, rng: Random): Promise<StepOutcome> {
  const net = listen(page);
  try {
    const failed = await open(page, step.url);
    if (failed) return failed;

    const timelines = () => net.got.filter((r) => TIMELINE_OPS.has(r.op));
    const profile = () => net.got.find((r) => r.op === "UserByScreenName");
    const missing = () => {
      const p = profile();
      return p?.body ? profileUnavailable(p.body) : undefined;
    };
    const redirected = () => Boolean(classifyPage(page.url(), ""));
    await waitFor(() => timelines().length > 0 || Boolean(missing()) || net.got.some((r) => r.status === 429) || redirected(), TIMELINE_TIMEOUT_MS);
    await net.settle();

    const reason = missing();
    if (reason) {
      const p = profile()!;
      writeFileSync(join(rawDir, `${step.handle}-profile.json`), JSON.stringify(p.body));
      return { kind: "not_found", reason };
    }
    if (net.got.some((r) => r.status === 429)) return { kind: "blocked", status: "rate_limited", error: "X 接口返回 429（请求过多）" };
    const blocked = await blockedByPage(page);
    if (blocked) return blocked;
    if (timelines().length === 0) return { kind: "blocked", status: "error", error: "时间线在页面加载后 30 秒内没有加载出来" };

    // 按清单给的停顿往下滚，看到早于 since 的推文或上次看到的那条就停；连续两次没有新内容说明到底了
    let idle = 0;
    for (const pause of step.scrollPausesMs ?? []) {
      if (reachedEnd(timelines().map((r) => r.body), step)) break;
      await sleep(pause);
      const before = timelines().length;
      await page.mouse.move(rng.int([300, 700]), rng.int([300, 600]));
      await page.mouse.wheel(0, rng.int([700, 1100]));
      const grew = await waitFor(() => timelines().length > before, SCROLL_RESPONSE_MS);
      await net.settle();
      if (net.got.some((r) => r.status === 429)) return { kind: "blocked", status: "rate_limited", error: "滚动时 X 接口返回 429（请求过多）" };
      idle = grew ? 0 : idle + 1;
      if (idle >= 2) break;
    }

    const files: string[] = [];
    const p = profile();
    if (p?.body) {
      writeFileSync(join(rawDir, `${step.handle}-profile.json`), JSON.stringify(p.body));
      files.push(`${step.handle}-profile.json`);
    }
    timelines()
      .filter((r) => r.body)
      .forEach((r, i) => {
        writeFileSync(join(rawDir, `${step.handle}-${i + 1}.json`), JSON.stringify(r.body));
        files.push(`${step.handle}-${i + 1}.json`);
      });
    return { kind: "ok", files };
  } finally {
    net.stop();
  }
}

/** 详情页：保存 TweetDetail 响应 raw/<handle>-detail-<id>.json，不滚动、不展开评论 */
export async function captureDetail(page: Page, step: Step, rawDir: string): Promise<StepOutcome> {
  const net = listen(page);
  try {
    const failed = await open(page, step.url);
    if (failed) return failed;
    const detail = () => net.got.find((r) => r.op === "TweetDetail" && r.body);
    await waitFor(() => Boolean(detail()) || net.got.some((r) => r.status === 429) || Boolean(classifyPage(page.url(), "")), TIMELINE_TIMEOUT_MS);
    await net.settle();
    if (net.got.some((r) => r.status === 429)) return { kind: "blocked", status: "rate_limited", error: "X 接口返回 429（请求过多）" };
    const blocked = await blockedByPage(page);
    if (blocked) return blocked;
    const d = detail();
    if (!d) return { kind: "blocked", status: "error", error: "详情页 30 秒内没有加载出来" };
    const name = `${step.handle}-detail-${step.key.replace(/^detail-/, "")}.json`;
    writeFileSync(join(rawDir, name), JSON.stringify(d.body));
    return { kind: "ok", files: [name] };
  } finally {
    net.stop();
  }
}
