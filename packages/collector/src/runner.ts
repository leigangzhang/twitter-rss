import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanTweetText, InboxFile } from "@xrss/core";
import { parseXGraphQL } from "./parsers/x-graphql.ts";
import { inboxDir } from "./paths.ts";
import type { CrawlPlan } from "./plan.ts";

/**
 * 逐步采集：由脚本决定"下一步做什么、等多久、做完没有"，采集端（AI + Browser Skill）只负责照做一步、报告结果。
 * 这样 AI 没法自行缩小范围、跳过等待或只采样：没做完的步骤 `pnpm crawl next` 会一直给出来，
 * 没有保存网络响应的 `pnpm crawl done` 不会通过，没采完时 scripts/daily.sh 不会发送。
 */

export type StepKind = "account" | "detail";
export type StepStatus = "pending" | "in_progress" | "done";
export type BlockStatus = "rate_limited" | "login_required" | "captcha" | "error";

export interface Step {
  /** account 为账号名；detail 为 detail-<推文 ID> */
  key: string;
  kind: StepKind;
  handle: string;
  url: string;
  /** 账号：滚动到早于这个时间的推文就停 */
  since?: string;
  lastSeenId?: string | null;
  scrollPausesMs?: number[];
  /** 开始这一步之前要等的秒数（含长休息） */
  waitSec: number;
  status: StepStatus;
  /** 完成情况说明，如"解析出 12 条推文" */
  result?: string;
  doneAt?: string;
}

export interface Progress {
  date: string;
  phase: "timeline" | "detail" | "finished";
  /** 下一步最早什么时候可以开始（ISO） */
  nextAt: string;
  /** 遇到限流、验证码、登录失效时停止，不再给出任何步骤 */
  stopped: { status: BlockStatus; handle: string; error?: string } | null;
  steps: Step[];
  updatedAt: string;
}

export const progressPath = (date: string) => join(inboxDir(date), "progress.json");
const rawDir = (date: string) => join(inboxDir(date), "raw");

export function loadPlan(date: string): CrawlPlan | undefined {
  const p = join(inboxDir(date), "plan.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as CrawlPlan) : undefined;
}

export function loadProgress(date: string): Progress | undefined {
  const p = progressPath(date);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Progress) : undefined;
}

export function saveProgress(progress: Progress): void {
  progress.updatedAt = new Date().toISOString();
  writeFileSync(progressPath(progress.date), `${JSON.stringify(progress, null, 2)}\n`);
}

/** 按采集清单建立进度：第一步要先等 startDelaySec */
export function initProgress(plan: CrawlPlan, now = new Date()): Progress {
  return {
    date: plan.date,
    phase: plan.accounts.length ? "timeline" : "finished",
    nextAt: new Date(now.getTime() + plan.startDelaySec * 1000).toISOString(),
    stopped: null,
    steps: plan.accounts.map((a, i) => ({
      key: a.handle,
      kind: "account",
      handle: a.handle,
      url: a.url,
      since: a.since,
      lastSeenId: a.lastSeenId,
      scrollPausesMs: a.scrollPausesMs,
      // 第一个账号的等待已经算在 startDelaySec 里
      waitSec: i === 0 ? 0 : a.waitBeforeSec + a.longBreakBeforeSec,
      status: "pending",
    })),
    updatedAt: now.toISOString(),
  };
}

/** parse 之后，把 detail-needed.json 里排好的详情页加进来 */
export function addDetailSteps(progress: Progress, now = new Date()): number {
  const p = join(inboxDir(progress.date), "detail-needed.json");
  if (!existsSync(p)) return 0;
  const needed = JSON.parse(readFileSync(p, "utf8")) as {
    stop: string | null;
    scheduled: Array<{ id: string; handle: string; url: string; waitBeforeSec: number; longBreakBeforeSec: number }>;
  };
  if (needed.stop) return 0;
  const existing = new Set(progress.steps.map((s) => s.key));
  const added = needed.scheduled
    .filter((d) => !existing.has(`detail-${d.id}`))
    .map((d, i): Step => ({
      key: `detail-${d.id}`,
      kind: "detail",
      handle: d.handle,
      url: d.url,
      waitSec: i === 0 ? d.waitBeforeSec : d.waitBeforeSec + d.longBreakBeforeSec,
      status: "pending",
    }));
  progress.steps.push(...added);
  if (added.length) progress.nextAt = new Date(now.getTime() + added[0]!.waitSec * 1000).toISOString();
  return added.length;
}

export function counts(progress: Progress) {
  const of = (kind: StepKind) => progress.steps.filter((s) => s.kind === kind);
  const done = (list: Step[]) => list.filter((s) => s.status === "done").length;
  const accounts = of("account");
  const details = of("detail");
  return { accounts: accounts.length, accountsDone: done(accounts), details: details.length, detailsDone: done(details) };
}

/** 进行中或下一个待做的步骤 */
export function currentStep(progress: Progress): Step | undefined {
  return progress.steps.find((s) => s.status === "in_progress") ?? progress.steps.find((s) => s.status === "pending");
}

export interface DoneCheck {
  ok: boolean;
  message: string;
}

/**
 * 检查这一步是不是真做完了：
 * - 账号：raw/<handle>-*.json 里要有能解析的时间线响应；拿不到响应时（--no-response）要有按格式写好的 <handle>.json
 * - 详情页：raw/<handle>-detail-<id>.json 要存在；拿不到响应时（--no-response）要有从页面读取的全文
 *   raw/<handle>-detail-<id>.txt，且比截断版长，检查通过后合并进 <handle>.json
 */
export function verifyStep(date: string, step: Step, opts: { noResponse?: string }): DoneCheck {
  const dir = rawDir(date);
  const files = existsSync(dir) ? readdirSync(dir) : [];
  if (step.kind === "detail") {
    const id = step.key.replace(/^detail-/, "");
    const name = files.find((f) => f.toLowerCase() === `${step.handle.toLowerCase()}-detail-${id}.json`);
    if (name) return { ok: true, message: `已保存 ${name}` };
    if (opts.noResponse) return mergeDetailText(date, step.handle, id, opts.noResponse);
    return {
      ok: false,
      message: `没有找到 raw/${step.handle}-detail-${id}.json。请把地址含 TweetDetail 的网络响应原样保存到这个文件后再运行。确实拿不到响应时，把页面上这条推文的完整正文保存到 raw/${step.handle}-detail-${id}.txt，再加 --no-response "原因" 运行。`,
    };
  }

  const own = files.filter((f) => f.toLowerCase().startsWith(`${step.handle.toLowerCase()}-`) && !f.toLowerCase().includes("-detail-"));
  if (own.length > 0) {
    const responses: unknown[] = [];
    for (const f of own) {
      try {
        responses.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
      } catch {
        return { ok: false, message: `raw/${f} 不是有效的 JSON。请把网络响应原样保存（完整的响应正文），不要改写。` };
      }
    }
    const timeline = own.filter((f) => !f.toLowerCase().endsWith("-profile.json"));
    if (timeline.length === 0 && !opts.noResponse) {
      return { ok: false, message: `只找到账号资料，没有时间线响应。请保存地址含 UserOriginalsTimeline 或 UserTweets 的响应到 raw/${step.handle}-1.json。` };
    }
    const { tweets } = parseXGraphQL(responses, step.handle);
    const ownTweets = tweets.filter((t) => t.author.handle === step.handle.toLowerCase());
    return { ok: true, message: `${own.length} 个响应文件，解析出 ${ownTweets.length} 条推文` };
  }

  if (!opts.noResponse) {
    return {
      ok: false,
      message: `没有找到 raw/${step.handle}-*.json。请把地址含 UserOriginalsTimeline 或 UserTweets 的网络响应原样保存到 raw/${step.handle}-1.json（滚动后的响应依次存 -2、-3…），UserByScreenName 存为 raw/${step.handle}-profile.json，然后再运行。确实拿不到网络响应时，按 AGENT_PROMPT.md "只能读取页面内容时"写好 ${step.handle}.json，再加 --no-response "原因" 运行。`,
    };
  }
  const file = join(inboxDir(date), `${step.handle}.json`);
  if (!existsSync(file)) return { ok: false, message: `--no-response 时需要先写好 data/inbox/${date}/${step.handle}.json（格式见 schemas/inbox-file.schema.json）。` };
  const parsed = InboxFile.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) return { ok: false, message: `${step.handle}.json 格式不符：${parsed.error.issues[0]?.message ?? "格式错误"}` };
  if (!parsed.data.profile?.avatarUrl) return { ok: false, message: `${step.handle}.json 缺少 profile.avatarUrl（主页头像地址）。` };
  return { ok: true, message: `页面读取 ${parsed.data.tweets.length} 条推文（未保存网络响应：${opts.noResponse}）` };
}

/**
 * 详情页拿不到网络响应时：读取采集端从页面保存的全文 raw/<handle>-detail-<id>.txt，
 * 确认比账号文件里的截断版长，再写回 <handle>.json（textTruncated 改为 false）。
 */
export function mergeDetailText(date: string, handle: string, id: string, reason: string): DoneCheck {
  const txt = join(rawDir(date), `${handle}-detail-${id}.txt`);
  if (!existsSync(txt)) {
    return {
      ok: false,
      message: `没有找到 raw/${handle}-detail-${id}.txt。请先点"显示更多"，把页面上这条推文正文元素（[data-testid="tweetText"]）的 textContent 原样保存到这个文件，再运行。`,
    };
  }
  const full = cleanTweetText(readFileSync(txt, "utf8")).trim();
  const file = join(inboxDir(date), `${handle}.json`);
  const parsed = existsSync(file) ? InboxFile.safeParse(JSON.parse(readFileSync(file, "utf8"))) : undefined;
  const tweet = parsed?.success ? parsed.data.tweets.find((t) => t.id === id) : undefined;
  if (!parsed?.success || !tweet) return { ok: true, message: `已保存全文 ${full.length} 字，但 ${handle}.json 里没有这条推文，未合并（${reason}）` };
  const before = cleanTweetText(tweet.text).replace(/[…\s]+$/, "");
  if (full.length <= before.length) {
    return {
      ok: false,
      message: `raw/${handle}-detail-${id}.txt 只有 ${full.length} 字，没有比截断版（${before.length} 字）更长。请确认已点开"显示更多"，读取的是这条推文完整的正文。`,
    };
  }
  tweet.text = full;
  tweet.textTruncated = false;
  writeFileSync(file, `${JSON.stringify(parsed.data, null, 2)}\n`);
  return { ok: true, message: `从页面读取全文 ${full.length} 字（原截断版 ${before.length} 字），已合并（未保存详情页响应：${reason}）` };
}

/** 完成一步，并按下一步的等待时间算出 nextAt */
export function completeStep(progress: Progress, step: Step, result: string, now = new Date()): void {
  step.status = "done";
  step.result = result;
  step.doneAt = now.toISOString();
  const next = progress.steps.find((s) => s.status === "pending");
  progress.nextAt = new Date(now.getTime() + (next?.waitSec ?? 0) * 1000).toISOString();
}

/** 写入异常状态文件并停止整个采集 */
export function stopProgress(progress: Progress, step: Step, status: BlockStatus, error: string | undefined, now = new Date()): void {
  const file = join(inboxDir(progress.date), `${step.handle}.json`);
  const body: InboxFile = { source: "tencent-browser-skill", collectedAt: now.toISOString(), handle: step.handle.toLowerCase(), status, error, tweets: [] };
  // 已经解析出内容的账号文件只改状态，保留推文
  if (existsSync(file)) {
    const prev = InboxFile.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (prev.success) body.tweets = prev.data.tweets;
  }
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  step.status = "done";
  step.result = `异常：${status}${error ? `（${error}）` : ""}`;
  step.doneAt = now.toISOString();
  progress.stopped = { status, handle: step.handle, error };
  progress.phase = "finished";
}

/** 采集是否结束（全部做完，或因异常停止，或今天不采集）。scripts/daily.sh 据此决定能不能发送 */
export function isFinished(date: string): { finished: boolean; reason: string } {
  const plan = loadPlan(date);
  if (!plan) return { finished: true, reason: "今天没有采集清单（未运行 pnpm plan）" };
  if (plan.skip) return { finished: true, reason: `今天不采集：${plan.skip.reason}` };
  const progress = loadProgress(date);
  if (!progress) return { finished: false, reason: `清单里有 ${plan.accounts.length} 个账号，还一个都没开始（运行 pnpm crawl next）` };
  if (progress.stopped) return { finished: true, reason: `采集因异常停止：@${progress.stopped.handle} ${progress.stopped.status}` };
  const c = counts(progress);
  if (progress.phase === "finished") return { finished: true, reason: `已完成：账号 ${c.accountsDone}/${c.accounts}，详情页 ${c.detailsDone}/${c.details}` };
  return { finished: false, reason: `还没采完：账号 ${c.accountsDone}/${c.accounts}，详情页 ${c.detailsDone}/${c.details}（继续运行 pnpm crawl next）` };
}

/**
 * 本机原因（断网、代理没开）被误判为异常后，从出错的那一步接着采：
 * 取消停止状态，把出错的账号步骤恢复为待采集，删掉它空的异常账号文件（有推文的只改回正常）。
 * 返回恢复的账号；没有因异常停止时返回 null。
 */
export function resumeProgress(progress: Progress, now = new Date()): string | null {
  const stopped = progress.stopped;
  if (!stopped) return null;
  const step = progress.steps.find((s) => s.kind === "account" && s.handle.toLowerCase() === stopped.handle.toLowerCase());
  if (step) {
    step.status = "pending";
    delete step.result;
    delete step.doneAt;
  }
  const file = join(inboxDir(progress.date), `${stopped.handle}.json`);
  if (existsSync(file)) {
    const parsed = InboxFile.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (parsed.success && parsed.data.status !== "ok") {
      if (parsed.data.tweets.length === 0) unlinkSync(file);
      else writeFileSync(file, `${JSON.stringify({ ...parsed.data, status: "ok", error: undefined }, null, 2)}\n`);
    }
  }
  progress.stopped = null;
  const pending = progress.steps.find((s) => s.status !== "done");
  progress.phase = !pending ? "finished" : pending.kind === "account" ? "timeline" : "detail";
  progress.nextAt = now.toISOString();
  return stopped.handle;
}

/** 本机网络不通：这一步退回待采集，不写账号文件、不停止、不计入异常，网络恢复后从这一步继续 */
export function pauseStep(progress: Progress, step: Step, now = new Date()): void {
  step.status = "pending";
  delete step.result;
  delete step.doneAt;
  progress.nextAt = now.toISOString();
}
