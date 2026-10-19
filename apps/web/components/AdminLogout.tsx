"use client";

export function AdminLogout() {
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/admin/login", { method: "DELETE" });
        window.location.reload();
      }}
      className="min-h-9 cursor-pointer rounded-lg border border-line bg-white px-3 text-[13px] text-body"
    >
      退出
    </button>
  );
}
