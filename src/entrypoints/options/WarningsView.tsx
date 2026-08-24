import { useEffect, useState } from "preact/hooks";
import type { Settings } from "../../core/model";

export function WarningsView({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    if (!saved) return;
    const timeout = window.setTimeout(() => setSaved(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [saved]);

  async function save(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      await onSave(draft);
      setSaved(true);
    } catch {
      setError("Cloudwatcher could not save warning settings. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="warnings-heading">
      <h2 id="warnings-heading">Warnings</h2>
      <p class="options__intro">Disabled warnings still count detections in local activity.</p>
      <div class="options__settings-ledger">
        <fieldset class="options__setting-row">
          <legend>Direct-site notice</legend>
          <select
            value={draft.directNoticeMode}
            aria-label="Direct-site notice"
            disabled={pending}
            onChange={(event) => {
              setSaved(false);
              setDraft({
                ...draft,
                directNoticeMode: event.currentTarget.value as Settings["directNoticeMode"],
              });
            }}
          >
            <option value="overlay">Overlay</option>
            <option value="banner">Banner</option>
            <option value="off">Off</option>
          </select>
          <p class="options__setting-note">
            Overlay blocks the page until you dismiss the notice. Banner is non-blocking. Off still
            records activity locally.
          </p>
        </fieldset>
        <fieldset class="options__setting-row">
          <legend>Content notice</legend>
          <select
            value={draft.contentNoticeMode}
            aria-label="Content notice"
            disabled={pending}
            onChange={(event) => {
              setSaved(false);
              setDraft({
                ...draft,
                contentNoticeMode: event.currentTarget.value as Settings["contentNoticeMode"],
              });
            }}
          >
            <option value="banner">Banner</option>
            <option value="off">Off</option>
          </select>
          <p class="options__setting-note">
            Banner is non-blocking. Off still records activity locally.
          </p>
        </fieldset>
      </div>
      {error === undefined ? null : (
        <p class="options__mutation-error" role="alert">
          {error}
        </p>
      )}
      <div class="options__completion-bar">
        <button
          class="options__primary"
          type="button"
          disabled={pending || saved}
          aria-busy={pending ? "true" : "false"}
          onClick={() => void save()}
        >
          {pending ? "Saving warning settings…" : saved ? "Saved" : "Save warning settings"}
        </button>
      </div>
    </section>
  );
}
