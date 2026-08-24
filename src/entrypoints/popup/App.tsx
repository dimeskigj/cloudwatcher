import { useEffect, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import type { PopupState, RuntimeResponse } from "../../core/messages";
import type { DetectionEvidence } from "../../core/model";
import { Brand } from "../../ui/brand";

type PopupView = { kind: "loading" } | { kind: "error" } | { kind: "ready"; state: PopupState };

const HEADER_EVIDENCE_LABELS: Record<
  Extract<DetectionEvidence, { kind: "header" }>["signal"],
  string
> = {
  "cf-ray": "CF-Ray header",
  "cf-cache-status": "CF-Cache-Status header",
  "cf-mitigated": "CF-Mitigated header",
  "server: cloudflare": "Cloudflare server header",
};

function evidenceLabel(evidence: DetectionEvidence): string {
  return evidence.kind === "header"
    ? HEADER_EVIDENCE_LABELS[evidence.signal]
    : "Cloudflare IP range";
}

function headingFor(status: PopupState["status"]): string {
  switch (status) {
    case "direct":
      return "Site uses Cloudflare";
    case "content":
      return "Cloudflare content observed";
    case "none":
      return "No Cloudflare observed";
    case "unavailable":
      return "Detection unavailable";
  }
}

export function App() {
  const [view, setView] = useState<PopupView>({ kind: "loading" });
  const [openingSettings, setOpeningSettings] = useState(false);
  const [settingsError, setSettingsError] = useState(false);

  async function load(): Promise<void> {
    setView({ kind: "loading" });
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) {
        setView({ kind: "ready", state: { status: "unavailable", ignored: false, evidence: [] } });
        return;
      }

      const response = (await browser.runtime.sendMessage({
        type: "popup/get",
        tabId: tab.id,
      })) as RuntimeResponse<PopupState>;
      if (!response.ok) {
        throw new Error(response.error);
      }

      setView({ kind: "ready", state: response.data });
    } catch {
      setView({ kind: "error" });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function openSettings(): Promise<void> {
    if (openingSettings) {
      return;
    }

    setOpeningSettings(true);
    setSettingsError(false);
    try {
      await browser.runtime.openOptionsPage();
    } catch {
      setSettingsError(true);
    } finally {
      setOpeningSettings(false);
    }
  }

  return (
    <main class="popup" aria-busy={view.kind === "loading" ? "true" : "false"}>
      <header class="popup__header">
        <Brand />
        <span>Cloudwatcher</span>
      </header>

      {view.kind === "loading" ? (
        <p class="popup__loading" role="status">
          Checking this tab
        </p>
      ) : view.kind === "error" ? (
        <section class="popup__error" aria-labelledby="popup-error-heading">
          <h1 id="popup-error-heading">Detection unavailable</h1>
          <p role="alert">Cloudwatcher could not check this tab.</p>
          <button class="popup__button" type="button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : (
        <Status state={view.state} />
      )}

      <footer class="popup__footer">
        {settingsError ? <p role="alert">Cloudwatcher could not open settings.</p> : null}
        <button
          class="popup__button popup__button--primary"
          type="button"
          disabled={openingSettings}
          aria-busy={openingSettings ? "true" : "false"}
          onClick={() => void openSettings()}
        >
          {openingSettings
            ? "Opening settings…"
            : settingsError
              ? "Try opening settings again"
              : "Open Cloudwatcher settings"}
        </button>
      </footer>
    </main>
  );
}

function Status({ state }: { state: PopupState }) {
  const directVisits = state.summary?.directNavigations ?? 0;
  const contentVisits = state.summary?.contentNavigations ?? 0;

  return (
    <section class="popup__status" aria-labelledby="popup-status-heading" aria-live="polite">
      <div class="popup__status-heading">
        <div>
          <h1 id="popup-status-heading">{headingFor(state.status)}</h1>
          {state.hostname !== undefined ? <code>{state.hostname}</code> : null}
        </div>
        {state.ignored ? <span class="popup__pill">Ignored for this site</span> : null}
      </div>

      {state.status === "content" && state.contentHost !== undefined ? (
        <dl class="popup__metadata">
          <dt>Observed content</dt>
          <dd>
            <code>{state.contentHost}</code>
          </dd>
        </dl>
      ) : null}

      {state.evidence.length > 0 ? (
        <dl class="popup__metadata">
          <dt>Evidence</dt>
          <dd class="popup__evidence">
            {state.evidence.map((evidence, index) => (
              <span key={`${evidence.kind}-${index}`}>{evidenceLabel(evidence)}</span>
            ))}
          </dd>
        </dl>
      ) : null}

      <dl class="popup__counts" aria-label="Current site history">
        <div>
          <dt>Direct visits</dt>
          <dd>{directVisits}</dd>
        </div>
        <div>
          <dt>Content visits</dt>
          <dd>{contentVisits}</dd>
        </div>
      </dl>
    </section>
  );
}
