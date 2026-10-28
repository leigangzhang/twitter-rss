import { addAccountToTopic, editConfigFile, normalizeHandle, removeAccountFromTopics, setAccountWeight } from "@xrss/core";
import { z } from "zod";
import { isAdmin } from "@/lib/admin";
import { config } from "@/lib/server";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), handle: z.string(), topicId: z.string() }),
  z.object({ action: z.literal("remove"), handle: z.string(), topicId: z.string().optional() }),
  z.object({ action: z.literal("weight"), handle: z.string(), weight: z.number().min(0).max(2).nullable(), note: z.string().max(200).optional() }),
]);

/** 账号管理：add 加到主题、remove 从主题移出（不指定主题时全部移出）、weight 设置权重（null 恢复默认） */
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ message: "未登录" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "参数有误" }, { status: 400 });
  const body = parsed.data;
  const handle = normalizeHandle(body.handle);
  if (!handle) return Response.json({ message: "账号格式不对：最长 15 个字符，只含字母、数字、下划线" }, { status: 400 });
  const dir = config().configDir;

  try {
    if (body.action === "add") {
      editConfigFile(dir, "topics.yaml", (t) => addAccountToTopic(t, body.topicId, handle));
      const topic = config().topics.find((t) => t.id === body.topicId);
      return Response.json({ ok: true, message: `已把 @${handle} 加到「${topic?.name ?? body.topicId}」，下次生成采集清单时开始采集` });
    }
    if (body.action === "remove") {
      editConfigFile(dir, "topics.yaml", (t) => removeAccountFromTopics(t, handle, body.topicId));
      return Response.json({ ok: true, message: `已移出 @${handle}` });
    }
    // 权重 1 就是默认值，不写进文件
    const weight = body.weight === null || body.weight === 1 ? null : Math.round(body.weight * 100) / 100;
    editConfigFile(dir, "digest.yaml", (t) => setAccountWeight(t, handle, weight, body.note));
    return Response.json({ ok: true, message: weight === null ? `@${handle} 恢复默认权重 1` : `@${handle} 权重改为 ${weight}` });
  } catch (err) {
    return Response.json({ message: (err as Error).message }, { status: 400 });
  }
}
