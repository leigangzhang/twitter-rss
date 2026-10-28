import { redirect } from "next/navigation";

/** /admin 直接进第一个标签：账号管理 */
export default function AdminHome() {
  redirect("/admin/accounts");
}
