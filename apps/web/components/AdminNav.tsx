import Link from "next/link";
import { AdminLogout } from "@/components/AdminLogout";

export type AdminTab = "accounts" | "subscribers" | "deliveries" | "rss" | "feedback";

const TABS: Array<{ id: AdminTab; label: string; href: string }> = [
  { id: "accounts", label: "账号管理", href: "/admin/accounts" },
  { id: "subscribers", label: "订阅管理", href: "/admin/subscribers" },
  { id: "deliveries", label: "邮件推送", href: "/admin/deliveries" },
  { id: "rss", label: "RSS 订阅", href: "/admin/rss" },
  { id: "feedback", label: "内容反馈", href: "/admin/feedback" },
];

/** 管理页顶部：五个标签和退出 */
export function AdminNav({ current }: { current: AdminTab }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
      <nav aria-label="管理" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
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
      <AdminLogout />
    </div>
  );
}
