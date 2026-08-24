import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

export function ConfirmationDialog({
  children,
  confirmLabel,
  fallback,
  labelledBy,
  onCancel,
  onConfirm,
  pending,
}: {
  children: ComponentChildren;
  confirmLabel: string;
  fallback: { current: HTMLElement | null };
  labelledBy: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useLayoutEffect(() => {
    const current = dialog.current;
    if (current === null) return;
    if (typeof current.showModal === "function") current.showModal();
    if (!current.open) current.setAttribute("open", "");
    cancel.current?.focus();
    return () => {
      if (typeof current.close === "function") current.close();
      else current.removeAttribute("open");
      (opener.current?.isConnected ? opener.current : fallback.current)?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
    >
      {children}
      <div class="options__dialog-actions">
        <button ref={cancel} type="button" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button
          class="options__primary"
          type="button"
          disabled={pending}
          aria-busy={pending ? "true" : "false"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
