/** 某个时区下的日期字符串 YYYY-MM-DD */
export function localDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
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
