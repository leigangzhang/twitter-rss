import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "精选晨报 · 每天一封，读完你关心的 X（原 Twitter）",
  description: "按主题精选 X（原 Twitter）上的优质推文，每天早上发到你的邮箱，支持中文翻译和 RSS。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="min-h-screen">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-12 px-4 pt-8 pb-16 sm:px-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2.5 text-ink no-underline hover:text-ink">
              <span className="flex size-[30px] items-center justify-center rounded-lg bg-ink text-base font-black text-white">X</span>
              <span className="text-lg font-bold tracking-wide">精选晨报</span>
            </Link>
            <nav className="flex gap-5 text-sm">
              <Link href="/#rss">RSS</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
