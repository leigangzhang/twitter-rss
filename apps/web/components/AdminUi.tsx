import Link from "next/link";

/** 管理页共用的小部件：标题行、指标卡、筛选标签、状态标签 */

export function PageHead({ title, sub, children }: { title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-3xl font-black">{title}</h1>
        {sub ? <div className="m-0 text-sm text-muted">{sub}</div> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function Metric({ label, aside, value, foot, children, tone }: { label: string; aside?: React.ReactNode; value: React.ReactNode; foot?: React.ReactNode; children?: React.ReactNode; tone?: "danger" }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 rounded-[14px] border bg-white px-4 py-3.5 ${tone === "danger" ? "border-danger" : "border-line"}`}>
      <span className="flex justify-between gap-2 text-xs text-muted">
        {label}
        {aside}
      </span>
      <span className={`font-mono text-[26px] leading-tight font-bold ${tone === "danger" ? "text-danger" : ""}`}>{value}</span>
      {children}
      {foot ? <span className="text-xs text-muted">{foot}</span> : null}
    </div>
  );
}

export function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

export function FilterChip({ href, active, children, count }: { href: string; active: boolean; children: React.ReactNode; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] no-underline ${
        active ? "border-ink bg-ink text-white hover:text-white" : "border-line bg-white text-body hover:text-ink"
      }`}
    >
      {children}
      {count !== undefined ? <span className="font-mono text-xs opacity-70">{count}</span> : null}
    </Link>
  );
}

export const PILL = {
  ok: "bg-[#E7F3EC] text-[#22663D]",
  bad: "bg-[#FBE9E7] text-[#A3271A]",
  warn: "bg-[#FDF1DE] text-[#8A5300]",
  info: "bg-[#EEF3FC] text-[#1F4FA8]",
  mute: "bg-[#EEF0F2] text-[#4A5058]",
} as const;

export function Pill({ tone, children, title }: { tone: keyof typeof PILL; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${PILL[tone]}`}>
      {children}
    </span>
  );
}

/** 横向比例条：每段 [份量, 颜色] */
export function RatioBar({ parts }: { parts: Array<[number, string]> }) {
  return (
    <div className="flex h-2 gap-0.5 overflow-hidden rounded bg-[#EEF0F2]">
      {parts.filter(([n]) => n > 0).map(([n, color], i) => (
        <i key={i} className="block h-full" style={{ flex: n, background: color }} />
      ))}
    </div>
  );
}

export const TABLE = "w-full border-collapse text-left text-[13px]";
export const TH = "px-4 py-3 font-medium";
export const THEAD_ROW = "border-b border-line bg-[#F5F6F8] text-xs text-muted";
export const TR = "border-b border-line align-top last:border-b-0";
export const CARD = "overflow-hidden rounded-[14px] border border-line bg-white";
