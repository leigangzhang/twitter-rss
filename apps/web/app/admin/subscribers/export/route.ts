import { listSubscribers, subscribersCsv } from "@xrss/core/db";
import { isAdmin } from "@/lib/admin";
import { config, db } from "@/lib/server";

/** 导出订阅者 CSV（需要先在管理页登录） */
export async function GET() {
  if (!(await isAdmin())) return new Response("未登录", { status: 401 });
  const cfg = config();
  const csv = subscribersCsv(await listSubscribers(await db(), cfg), cfg.digest.timezone);
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: cfg.digest.timezone }).format(new Date());
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="subscribers-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
