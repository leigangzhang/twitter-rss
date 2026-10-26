import { FEEDBACK_REASONS, NOTE_MAX, setAdminFeedback } from "@xrss/core/db";
import { z } from "zod";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/server";

const Body = z.object({
  tweetId: z.string().regex(/^\d{1,25}$/),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vote: z.enum(["up", "down"]).nullable(),
  /** 👎 的原因和说明：不传表示不变，null 表示清除 */
  reason: z.enum(FEEDBACK_REASONS).nullable().optional(),
  note: z.string().max(NOTE_MAX).nullable().optional(),
});

/** 后台预览里的赞 / 踩：vote 为 null 时取消；之后可以再补原因和说明 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ message: "未登录" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "参数有误" }, { status: 400 });
  await setAdminFeedback(await db(), parsed.data);
  return Response.json({ ok: true });
}
