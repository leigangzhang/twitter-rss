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

/** 一次 GraphQL 请求的记录，写进 calls.jsonl 作为限流排查的依据 */
export interface CallRecord {
  op: string;
  status: number;
  limit?: number;
  remaining?: number;
  /** 额度重置时间（ISO） */
  reset?: string;
}

export type StepOutcome =
  | { kind: "ok"; files: string[]; calls: CallRecord[]; note?: string }
  | { kind: "not_found"; reason: string; calls?: CallRecord[] }
  | { kind: "blocked"; status: BlockStatus; error: string; calls?: CallRecord[] }
  | { kind: "offline"; error: string };

/** X 在每个 GraphQL 响应头里给出的额度：x-rate-limit-limit / -remaining / -reset */
export interface RateLimit {
  op: string;
  limit: number;
  remaining: number;
  /** 重置时间，毫秒时间戳 */
  resetAt: number;
  status: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const GRAPHQL = /\/i\/api\/graphql\/[^/]+\/([A-Za-z]+)/;
const TIMELINE_OPS = new Set(["UserTweets", "UserOriginalsTimeline"]);
/** 采集真正需要的接口：只有它们返回 429 才算限流。主页上推荐关注、侧边栏等其他请求的 429 只记录，不停止 */
export const ESSENTIAL_OPS = new Set(["UserTweets", "UserOriginalsTimeline", "UserByScreenName", "TweetDetail"]);

/** 各接口最近一次看到的额度，跨账号共用（同一个小号的额度），由 cli-auto 读写 ratelimit.json 持久化 */
export const rateLimits = new Map<string, RateLimit>();

/** 从响应头读出额度；没有这几个头时返回 null */
export function readRateLimit(op: string, status: number, headers: Record<string, string>): RateLimit | null {
  const raw = ["x-rate-limit-limit", "x-rate-limit-remaining", "x-rate-limit-reset"].map((k) => headers[k]?.trim());
  if (raw.some((v) => !v)) return null;
  const [limit, remaining, reset] = raw.map(Number) as [number, number, number];
  if (![limit, remaining, reset].every(Number.isFinite)) return null;
  return { op, limit, remaining, resetAt: reset * 1000, status };
}

/** 额度重置时间，按北京时间显示 hh:mm */
export function formatClock(ms: number, timeZone = "Asia/Shanghai"): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
}

/**
 * 下一步需要 need[op] 次请求，已知额度不够且还没到重置时间时，返回要等多久（取等得最久的那个接口）。
 * 额度未知（还没见过这个接口的响应头）时不等。
 */
export function budgetWait(limits: Map<string, RateLimit>, need: Record<string, number>, now: number): { ms: number; op: string; rl: RateLimit } | null {
  let worst: { ms: number; op: string; rl: RateLimit } | null = null;
  for (const [op, n] of Object.entries(need)) {
    const rl = limits.get(op);
    if (!rl || rl.remaining >= n || rl.resetAt <= now) continue;
    const ms = rl.resetAt - now;
    if (!worst || ms > worst.ms) worst = { ms, op, rl };
  }
  return worst;
}

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
  const got: Array<{ op: string; status: number; body: unknown; rl: RateLimit | null }> = [];
  const calls: CallRecord[] = [];
  const pending = new Set<Promise<void>>();
  const onResponse = (res: Response) => {
    const m = GRAPHQL.exec(res.url());
    if (!m) return;
    const op = m[1]!;
    const status = res.status();
    const rl = readRateLimit(op, status, res.headers());
    if (rl) rateLimits.set(op, rl);
    calls.push(rl ? { op, status, limit: rl.limit, remaining: rl.remaining, reset: new Date(rl.resetAt).toISOString() } : { op, status });
    const p = res
      .text()
      .then((text) => {
        let body: unknown = null;
        try {
          body = JSON.parse(text);
        } catch {
          // 非 JSON（比如限流时的 HTML）只记状态码
        }
        got.push({ op, status, body, rl });
      })
      .catch(() => {})
      .finally(() => pending.delete(p));
    pending.add(p);
  };
  page.on("response", onResponse);
  return {
    got,
    calls,
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

/** 必要接口返回 429 时给出限流结果，错误里写明是哪个接口、额度和重置时间 */
function essentialLimited(net: ReturnType<typeof listen>, when = ""): StepOutcome | null {
  const hit = net.got.find((r) => r.status === 429 && ESSENTIAL_OPS.has(r.op));
  if (!hit) return null;
  const quota = hit.rl ? `，额度 ${hit.rl.remaining}/${hit.rl.limit}，${formatClock(hit.rl.resetAt)} 重置` : "";
  return { kind: "blocked", status: "rate_limited", error: `${when}${hit.op} 返回 429（请求过多）${quota}`, calls: net.calls };
}

const limited429 = (net: ReturnType<typeof listen>) => net.got.some((r) => r.status === 429 && ESSENTIAL_OPS.has(r.op));

async function blockedByPage(page: Page): Promise<Extract<StepOutcome, { kind: "blocked" }> | null> {
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
    await waitFor(() => timelines().length > 0 || Boolean(missing()) || limited429(net) || redirected(), TIMELINE_TIMEOUT_MS);
    await net.settle();

    const reason = missing();
    if (reason) {
      const p = profile()!;
      writeFileSync(join(rawDir, `${step.handle}-profile.json`), JSON.stringify(p.body));
      return { kind: "not_found", reason, calls: net.calls };
    }
    const limited = essentialLimited(net);
    if (limited) return limited;
    const blocked = await blockedByPage(page);
    if (blocked) return { ...blocked, calls: net.calls };
    if (timelines().length === 0) return { kind: "blocked", status: "error", error: "时间线在页面加载后 30 秒内没有加载出来", calls: net.calls };

    // 按清单给的停顿往下滚，看到早于 since 的推文或上次看到的那条就停；连续两次没有新内容说明到底了
    let idle = 0;
    let note: string | undefined;
    for (const pause of step.scrollPausesMs ?? []) {
      if (reachedEnd(timelines().map((r) => r.body), step)) break;
      // 时间线额度只剩 1 次时不再滚动，留给下一个账号的第一屏；已拿到的内容照常保存
      const rl = rateLimits.get(timelines()[0]!.op);
      if (rl && rl.remaining <= 1 && rl.resetAt > Date.now()) {
        note = `${rl.op} 额度剩 ${rl.remaining}/${rl.limit}，不再往下滚`;
        break;
      }
      await sleep(pause);
      const before = timelines().length;
      await page.mouse.move(rng.int([300, 700]), rng.int([300, 600]));
      await page.mouse.wheel(0, rng.int([700, 1100]));
      const grew = await waitFor(() => timelines().length > before, SCROLL_RESPONSE_MS);
      await net.settle();
      const limitedOnScroll = essentialLimited(net, "滚动时 ");
      if (limitedOnScroll) return limitedOnScroll;
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
    return note ? { kind: "ok", files, calls: net.calls, note } : { kind: "ok", files, calls: net.calls };
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
    await waitFor(() => Boolean(detail()) || limited429(net) || Boolean(classifyPage(page.url(), "")), TIMELINE_TIMEOUT_MS);
    await net.settle();
    const limited = essentialLimited(net);
    if (limited) return limited;
    const blocked = await blockedByPage(page);
    if (blocked) return { ...blocked, calls: net.calls };
    const d = detail();
    if (!d) return { kind: "blocked", status: "error", error: "详情页 30 秒内没有加载出来", calls: net.calls };
    const name = `${step.handle}-detail-${step.key.replace(/^detail-/, "")}.json`;
    writeFileSync(join(rawDir, name), JSON.stringify(d.body));
    return { kind: "ok", files: [name], calls: net.calls };
  } finally {
    net.stop();
  }
}

/** 关注列表接口（"正在关注"页）；它和账号资料接口返回 429 时算限流 */
const FOLLOWING_OPS = new Set(["Following", "UserByScreenName"]);

export type FollowingOutcome =
  | { kind: "ok"; responses: unknown[]; complete: boolean; calls: CallRecord[]; note?: string }
  | Exclude<StepOutcome, { kind: "ok" }>;

/**
 * 读某个账号的"正在关注"列表：打开 /<handle>/following，按给定的停顿往下滚，直到连续两次没有新内容（读完）、
 * 读到 maxAccounts 个、或接口额度只剩 1 次。只滚动，不点击。返回 Following 响应原文，由 parseFollowing 解析。
 */
export async function captureFollowing(
  page: Page,
  url: string,
  opts: { scrollPausesMs: number[]; maxAccounts: number; count: (responses: unknown[]) => number },
  rng: Random,
): Promise<FollowingOutcome> {
  const net = listen(page);
  const limited = (): Extract<StepOutcome, { kind: "blocked" }> | null => {
    const hit = net.got.find((r) => r.status === 429 && FOLLOWING_OPS.has(r.op));
    if (!hit) return null;
    const quota = hit.rl ? `，额度 ${hit.rl.remaining}/${hit.rl.limit}，${formatClock(hit.rl.resetAt)} 重置` : "";
    return { kind: "blocked", status: "rate_limited", error: `${hit.op} 返回 429（请求过多）${quota}`, calls: net.calls };
  };
  try {
    const failed = await open(page, url);
    if (failed) return failed as Exclude<StepOutcome, { kind: "ok" }>;
    const lists = () => net.got.filter((r) => r.op === "Following" && r.status === 200 && r.body).map((r) => r.body);
    await waitFor(() => lists().length > 0 || Boolean(limited()) || Boolean(classifyPage(page.url(), "")), TIMELINE_TIMEOUT_MS);
    await net.settle();
    const first = limited();
    if (first) return first;
    const blocked = await blockedByPage(page);
    if (blocked) return { ...blocked, calls: net.calls };
    if (lists().length === 0) return { kind: "blocked", status: "error", error: "关注列表在页面加载后 30 秒内没有加载出来", calls: net.calls };

    let idle = 0;
    let complete = false;
    let note: string | undefined;
    for (const pause of opts.scrollPausesMs) {
      if (opts.count(lists()) >= opts.maxAccounts) {
        note = `已读到 ${opts.maxAccounts} 个（follow_sync.max_accounts），不再往下滚`;
        break;
      }
      const rl = rateLimits.get("Following");
      if (rl && rl.remaining <= 1 && rl.resetAt > Date.now()) {
        note = `Following 额度剩 ${rl.remaining}/${rl.limit}，不再往下滚，下次同步再读剩下的`;
        break;
      }
      await sleep(pause);
      const before = lists().length;
      await page.mouse.move(rng.int([300, 700]), rng.int([300, 600]));
      await page.mouse.wheel(0, rng.int([1500, 2500]));
      const grew = await waitFor(() => lists().length > before, SCROLL_RESPONSE_MS);
      await net.settle();
      const onScroll = limited();
      if (onScroll) return onScroll;
      idle = grew ? 0 : idle + 1;
      if (idle >= 2) {
        complete = true;
        break;
      }
    }
    if (!complete && !note) note = "滚动次数用完，列表可能没读完";
    return note ? { kind: "ok", responses: lists(), complete, calls: net.calls, note } : { kind: "ok", responses: lists(), complete, calls: net.calls };
  } finally {
    net.stop();
  }
}

/** 采集 Chrome 里登录的是哪个账号：首页左侧"个人资料"链接 /<handle> */
export async function loggedInHandle(page: Page, origin = "https://x.com"): Promise<string | null> {
  const failed = await open(page, `${origin}/home`);
  if (failed) return null;
  const link = page.locator('a[data-testid="AppTabBar_Profile_Link"]');
  const href = await link
    .first()
    .getAttribute("href", { timeout: 20_000 })
    .catch(() => null);
  const m = href ? /^\/?([A-Za-z0-9_]{1,15})$/.exec(href.replace(/^https?:\/\/[^/]+/, "")) : null;
  return m ? m[1]! : null;
}
