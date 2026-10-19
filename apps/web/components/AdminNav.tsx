import Link from "next/link";
import { AdminLogout } from "@/components/AdminLogout";

/** 管理页顶部：订阅者 / 推送历史 切换和退出 */
export function AdminNav({ current }: { current: "subscribers" | "deliveries" }) {
  const tabs = [
    { id: "subscribers", label: "订阅者", href: "/admin/subscribers" },
    { id: "deliveries", label: "推送历史", href: "/admin/deliveries" },
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
      <AdminLogout />
    </div>
  );
}
