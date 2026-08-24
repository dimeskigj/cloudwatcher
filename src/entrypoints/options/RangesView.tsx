import { useEffect, useRef, useState } from "preact/hooks";
import type { CidrError } from "../../core/cidr";
import { DEFAULT_CIDRS } from "../../core/default-ranges";
import { ConfirmationDialog } from "./ConfirmationDialog";

interface RangeSaveError extends Error {
  validationErrors?: CidrError[];
}

export function RangesView({
  ranges,
  onDirtyChange,
  onSave,
}: {
  ranges: readonly string[];
  onDirtyChange: (dirty: boolean) => void;
  onSave: (draft: string) => Promise<string[]>;
}) {
  const savedText = ranges.join("\n");
  const [draft, setDraft] = useState(savedText);
  const [saved, setSaved] = useState(savedText);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<CidrError[]>();
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<"discard" | "reset">();
  const heading = useRef<HTMLHeadingElement>(null);
  const importToken = useRef(0);

  useEffect(() => {
    setDraft(savedText);
    setSaved(savedText);
  }, [savedText]);

  useEffect(() => onDirtyChange(draft !== saved), [draft, onDirtyChange, saved]);

  async function save(): Promise<void> {
    setPending(true);
    setErrors(undefined);
    setError(undefined);
    try {
      const replacement = await onSave(draft);
      const text = replacement.join("\n");
      setDraft(text);
      setSaved(text);
    } catch (cause) {
      const saveError = cause as RangeSaveError;
      setErrors(saveError.validationErrors);
      setError(saveError.message || "Cloudwatcher could not save IP ranges.");
    } finally {
      setPending(false);
    }
  }

  async function importFile(file: File | undefined): Promise<void> {
    const token = ++importToken.current;
    if (file === undefined) return;
    if (!file.name.toLowerCase().endsWith(".txt") && file.type !== "text/plain") {
      setErrors(undefined);
      setError("Choose a plain-text .txt file.");
      return;
    }

    try {
      const text = await file.text();
      if (token !== importToken.current) return;
      setDraft(text);
      setErrors(undefined);
      setError(undefined);
    } catch (cause) {
      if (token !== importToken.current) return;
      setErrors(undefined);
      setError(cause instanceof Error ? cause.message : "Cloudwatcher could not read this file.");
    }
  }

  function exportRanges(): void {
    const url = URL.createObjectURL(
      new Blob([saved === "" ? "" : `${saved}\n`], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "cloudwatcher-ip-ranges.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  const dirty = draft !== saved;
  const errorDescription = errors === undefined ? undefined : "range-errors";

  return (
    <section aria-labelledby="ranges-heading">
      <h2 ref={heading} id="ranges-heading" tabIndex={-1}>
        IP ranges
      </h2>
      <p class="options__intro">One CIDR per line. Changes are active only after you save them.</p>
      <label class="options__range-label">
        <span>CIDR ranges</span>
        <textarea
          value={draft}
          disabled={pending}
          aria-describedby={errorDescription}
          aria-invalid={errors === undefined ? undefined : "true"}
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
      </label>
      {errors === undefined ? null : (
        <section
          id="range-errors"
          class="options__range-errors"
          role="alert"
          aria-label="Range errors"
        >
          <p>{error}</p>
          <ul>
            {errors.map((item) => (
              <li key={`${item.line}-${item.input}`}>
                Line {item.line}: {item.input}. {item.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      {errors === undefined && error !== undefined ? (
        <p class="options__mutation-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved === "" ? <p class="options__empty">Header-only detection is active.</p> : null}
      <div class="options__range-actions">
        <button
          class="options__primary"
          type="button"
          disabled={pending || !dirty}
          aria-busy={pending ? "true" : "false"}
          onClick={() => void save()}
        >
          {pending ? "Saving IP ranges..." : "Save IP ranges"}
        </button>
        <label class="options__file-control">
          <span>Import IP ranges</span>
          <input
            type="file"
            accept=".txt,text/plain"
            disabled={pending}
            onChange={(event) => void importFile(event.currentTarget.files?.[0])}
          />
        </label>
        <button type="button" disabled={pending} onClick={exportRanges}>
          Export IP ranges
        </button>
        {dirty ? (
          <button type="button" disabled={pending} onClick={() => setConfirmation("discard")}>
            Discard range changes
          </button>
        ) : null}
        <button type="button" disabled={pending} onClick={() => setConfirmation("reset")}>
          Reset draft to defaults
        </button>
      </div>
      {confirmation === undefined ? null : (
        <ConfirmationDialog
          labelledBy="range-confirmation-heading"
          fallback={heading}
          confirmLabel={confirmation === "reset" ? "Reset draft" : "Discard changes"}
          pending={false}
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => {
            if (confirmation === "reset") setDraft(DEFAULT_CIDRS.join("\n"));
            else setDraft(saved);
            setErrors(undefined);
            setError(undefined);
            setConfirmation(undefined);
          }}
        >
          <h3 id="range-confirmation-heading">
            {confirmation === "reset" ? "Reset IP ranges draft" : "Discard IP range changes"}
          </h3>
          <p>
            {confirmation === "reset"
              ? "This replaces only the draft with Cloudwatcher’s bundled ranges. Save to activate it."
              : "This discards unsaved IP range changes."}
          </p>
        </ConfirmationDialog>
      )}
    </section>
  );
}
