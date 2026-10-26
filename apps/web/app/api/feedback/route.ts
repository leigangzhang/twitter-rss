import { parseFeedbackParams, parseReason, recordFeedback, verifyFeedback } from "@xrss/core/db";
import { db, siteUrl } from "@/lib/server";

/** 确认页提交：校验链接后记录 👍 / 👎（同一订阅者对同一条重复提交会覆盖上一次） */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const get = (k: string) => {
    const v = form?.get(k);
    return typeof v === "string" ? v : null;
  };
  const parsed = parseFeedbackParams(get);
  const d = await db();
  const ok = parsed ? await verifyFeedback(d, parsed) : null;
  if (!parsed || !ok) return Response.redirect(siteUrl("/f?invalid=1"), 303);
  await recordFeedback(d, { tweetId: parsed.tweetId, issueDate: parsed.issueDate, vote: parsed.vote, reason: parseReason(get("reason")), subscriberId: ok.subscriberId });
  return Response.redirect(siteUrl("/f?done=1"), 303);
}
