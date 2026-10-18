/** 某个时区下的日期字符串 YYYY-MM-DD */
export function localDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** 某时刻在指定时区的 UTC 偏移（毫秒），例如 Asia/Shanghai 为 +8 小时 */
function tzOffsetMs(at: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name ?? "");
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0)) * 60_000;
}

/** 指定时区某一天 00:00 对应的时刻 */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const utcMidnight = new Date(`${date}T00:00:00Z`);
  // 先按当天中午估算偏移，避免夏令时切换当天出错
  const offset = tzOffsetMs(new Date(utcMidnight.getTime() + 12 * 3_600_000), timeZone);
  return new Date(utcMidnight.getTime() - offset);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface TimeRange {
  /** 包含 */
  since: Date;
  /** 不包含 */
  until: Date;
  /** 内容所属日期（previous_day 模式下为前一天），用于标题 */
  contentDate: string;
}

/**
 * 本次运行要处理的推文发布时间范围。
 * previous_day：运行日期的前一天 0:00 到当天 0:00（按配置的时区）
 * rolling：此刻往前 windowHours 小时
 */
export function collectRange(
  opts: { mode: "previous_day" | "rolling"; timezone: string; windowHours: number },
  runDate: string,
  now = new Date(),
): TimeRange {
  if (opts.mode === "rolling") {
    return { since: new Date(now.getTime() - opts.windowHours * 3_600_000), until: now, contentDate: runDate };
  }
  const contentDate = addDays(runDate, -1);
  return { since: startOfLocalDay(contentDate, opts.timezone), until: startOfLocalDay(runDate, opts.timezone), contentDate };
}

/** 邮件和卡片里显示的时间：今天显示 09:12，昨天显示"昨天 22:05"，更早显示 10月16日 */
export function displayTime(iso: string, timeZone: string, now = new Date()): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("zh-CN", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const day = localDate(d, timeZone);
  if (day === localDate(now, timeZone)) return time;
  if (day === localDate(new Date(now.getTime() - 86_400_000), timeZone)) return `昨天 ${time}`;
  const md = new Intl.DateTimeFormat("zh-CN", { timeZone, month: "numeric", day: "numeric" }).format(d);
  return md;
}

/** 2.3万 / 3,104 */
export function compactNumber(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}万`;
  return n.toLocaleString("en-US");
}
