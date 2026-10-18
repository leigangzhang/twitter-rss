import Link from "next/link";

/** 确认、退订等结果页的通用卡片 */
export function Notice({ title, children, tone = "neutral" }: { title: string; children?: React.ReactNode; tone?: "neutral" | "success" | "error" }) {
  const bar = tone === "success" ? "bg-[#2F7D4F]" : tone === "error" ? "bg-danger" : "bg-ink";
  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-col gap-6 py-10">
      <div className="overflow-hidden rounded-[14px] border border-line bg-white">
        <div className={`h-1 ${bar}`} />
        <div className="flex flex-col gap-4 p-8">
          <h1 className="m-0 text-2xl font-black">{title}</h1>
          <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-body">{children}</div>
        </div>
      </div>
      <Link href="/" className="text-sm">
        ← 返回首页
      </Link>
    </main>
  );
}
