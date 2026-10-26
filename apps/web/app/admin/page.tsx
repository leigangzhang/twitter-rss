import { redirect } from "next/navigation";

/** /admin 直接进反馈页：顶部有"今日反馈"入口和按期列表 */
export default function AdminHome() {
  redirect("/admin/feedback");
}
