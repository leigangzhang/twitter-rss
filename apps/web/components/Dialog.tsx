"use client";

import { useEffect, useRef } from "react";

/** 弹窗：浏览器原生 <dialog>，Esc 和点遮罩都能关闭 */
export function Dialog({ open, onClose, title, sub, children, footer }: { open: boolean; onClose: () => void; title: string; sub?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
      className="m-auto w-[min(560px,calc(100%-32px))] max-h-[calc(100vh-32px)] rounded-[14px] border-0 bg-white p-0 text-ink shadow-[0_12px_40px_rgba(21,23,26,.18)] backdrop:bg-[rgba(21,23,26,.32)]"
    >
      {open ? (
        <div className="flex flex-col">
          <div className="flex items-start gap-3 px-5 pt-5 pb-3">
            <div className="flex flex-1 flex-col gap-1">
              <h2 className="m-0 text-lg font-bold">{title}</h2>
              {sub ? <p className="m-0 text-[13px] text-muted">{sub}</p> : null}
            </div>
            <button type="button" onClick={onClose} aria-label="关闭" className="-mt-1 -mr-1 flex size-8 cursor-pointer items-center justify-center rounded-lg text-xl text-muted hover:bg-note hover:text-ink">
              ×
            </button>
          </div>
          <div className="flex flex-col gap-4 px-5 pb-5">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
