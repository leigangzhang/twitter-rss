import Link from "next/link";
import type { Page } from "@/lib/paging";

/** 表格底部的分页：范围、总数和页码；只有一页时不显示 */
export function Pager({ page, href }: { page: Page<unknown>; href: (n: number) => string }) {
  if (page.pages <= 1) return null;
  const from = (page.page - 1) * page.size + 1;
  const to = Math.min(page.page * page.size, page.total);
  // 页码多时只显示首尾和当前页附近
  const nums = Array.from({ length: page.pages }, (_, i) => i + 1).filter((n) => n === 1 || n === page.pages || Math.abs(n - page.page) <= 2);
  const btn = "flex h-8 min-w-8 items-center justify-center rounded-md border px-2 font-mono text-xs no-underline";
  return (
    <nav aria-label="分页" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-muted">
      <span>
        第 {from}–{to} 条，共 {page.total} 条
      </span>
      <span className="flex items-center gap-1">
        {page.page > 1 ? (
          <Link href={href(page.page - 1)} aria-label="上一页" className={`${btn} border-line bg-white text-body`}>
            ‹
          </Link>
        ) : null}
        {nums.map((n, i) => (
          <span key={n} className="flex items-center gap-1">
            {i > 0 && n - nums[i - 1]! > 1 ? <span className="px-1">…</span> : null}
            <Link
              href={href(n)}
              aria-current={n === page.page ? "page" : undefined}
              className={`${btn} ${n === page.page ? "border-ink bg-ink font-bold text-white hover:text-white" : "border-line bg-white text-body"}`}
            >
              {n}
            </Link>
          </span>
        ))}
        {page.page < page.pages ? (
          <Link href={href(page.page + 1)} aria-label="下一页" className={`${btn} border-line bg-white text-body`}>
            ›
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
