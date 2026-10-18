import { ManageForm } from "@/components/ManageForm";

export const dynamic = "force-dynamic";

/** 合并发送的邮件里"管理订阅 / 切换语言 / 退订"的通用入口 */
export default async function ManagePage({ searchParams }: { searchParams: Promise<{ action?: string; to?: string }> }) {
  const { action, to } = await searchParams;
  const a = action === "unsubscribe" || action === "lang" ? action : "manage";
  return <ManageForm action={a} to={to === "zh" || to === "orig" ? to : undefined} />;
}
