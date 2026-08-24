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
  const [error, setError] = useState<string>();

  useEffect(() => setDraft(settings), [settings]);

  async function save(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      await onSave(draft);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Cloudwatcher could not save warning settings.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="warnings-heading">
      <h2 id="warnings-heading">Warnings</h2>
      <p class="options__intro">Disabled warnings still count detections in local activity.</p>
      <div class="options__controls">
        <label>
          <span>Direct-site notice</span>
          <select
            value={draft.directNoticeMode}
            disabled={pending}
            onInput={(event) =>
              setDraft({
                ...draft,
                directNoticeMode: event.currentTarget.value as Settings["directNoticeMode"],
              })
            }
          >
            <option value="overlay">Overlay</option>
            <option value="banner">Banner</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label>
          <span>Content notice</span>
          <select
            value={draft.contentNoticeMode}
            disabled={pending}
            onInput={(event) =>
              setDraft({
                ...draft,
                contentNoticeMode: event.currentTarget.value as Settings["contentNoticeMode"],
              })
            }
          >
            <option value="banner">Banner</option>
            <option value="off">Off</option>
          </select>
        </label>
      </div>
      {error === undefined ? null : (
        <p class="options__mutation-error" role="alert">
          {error}
        </p>
      )}
      <button
        class="options__primary"
        type="button"
        disabled={pending}
        aria-busy={pending ? "true" : "false"}
        onClick={() => void save()}
      >
        {pending ? "Saving warning settings…" : "Save warning settings"}
      </button>
    </section>
  );
}
