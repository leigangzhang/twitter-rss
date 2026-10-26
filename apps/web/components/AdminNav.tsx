import Link from "next/link";
import { AdminLogout } from "@/components/AdminLogout";

/** 管理页顶部：订阅者 / 推送历史 / 读者反馈 切换、"今日反馈"入口和退出 */
export function AdminNav({ current }: { current: "subscribers" | "deliveries" | "feedback" }) {
  const tabs = [
    { id: "subscribers", label: "订阅者", href: "/admin/subscribers" },
    { id: "deliveries", label: "推送历史", href: "/admin/deliveries" },
    { id: "feedback", label: "读者反馈", href: "/admin/feedback" },
  ] as const;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
      <nav aria-label="管理" className="flex gap-1">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            aria-current={current === t.id ? "page" : undefined}
            className={`flex min-h-10 items-center rounded-lg px-3.5 text-sm no-underline ${current === t.id ? "bg-ink font-bold text-white hover:text-white" : "text-body hover:bg-white hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        {/* 普通链接（不用 Link）：目标是一个跳转到邮件预览的接口 */}
        <a href="/admin/feedback/today" className="flex min-h-10 items-center rounded-lg bg-accent px-3.5 text-sm font-bold text-white no-underline hover:text-white hover:opacity-90">
          今日反馈
        </a>
        <AdminLogout />
      </div>
    </div>
  );
}
