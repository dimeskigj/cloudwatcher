import { useEffect, useRef, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import type { CidrError } from "../../core/cidr";
import type { RuntimeResponse } from "../../core/messages";
import type { IgnoreRule, OptionsSnapshot, Settings, StorageDiagnostic } from "../../core/model";
import { ActivityView } from "./ActivityView";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { IgnoredView } from "./IgnoredView";
import { RangesView } from "./RangesView";
import { WarningsView } from "./WarningsView";

type View = "warnings" | "ignored" | "activity" | "ranges";
type LoadState =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "ready"; data: OptionsSnapshot };

function sectionLabel(section: StorageDiagnostic["section"]): string {
  return section === "ignoreRules"
    ? "Ignored sites"
    : section === "ipRanges"
      ? "IP ranges"
      : section === "summaries"
        ? "Activity"
        : "Warnings";
}

async function request<T>(message: unknown): Promise<T> {
  const response = (await browser.runtime.sendMessage(message)) as RuntimeResponse<T>;
  if (!response.ok) {
    const error = new Error(response.error) as Error & { validationErrors?: CidrError[] };
    error.validationErrors = response.validationErrors;
    throw error;
  }
  return response.data;
}

export function App() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [view, setView] = useState<View>("warnings");
  const [resetting, setResetting] = useState<StorageDiagnostic>();
  const [resetPending, setResetPending] = useState(false);
  const [resetError, setResetError] = useState<string>();
  const [rangesDirty, setRangesDirty] = useState(false);
  const [discardingFor, setDiscardingFor] = useState<View>();
  const panelFallback = useRef<HTMLElement>(null);

  async function load(): Promise<void> {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", data: await request<OptionsSnapshot>({ type: "options/get" }) });
    } catch {
      setState({
        kind: "error",
        error: "Cloudwatcher could not load settings. Try again.",
      });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveSettings(settings: Settings): Promise<void> {
    const replacement = await request<Settings>({ type: "options/update-settings", settings });
    setState((current) =>
      current.kind === "ready"
        ? { kind: "ready", data: { ...current.data, settings: replacement } }
        : current,
    );
  }

  async function removeIgnore(rule: IgnoreRule): Promise<void> {
    const ignoreRules = await request<IgnoreRule[]>({ type: "options/remove-ignore", rule });
    setState((current) =>
      current.kind === "ready"
        ? { kind: "ready", data: { ...current.data, ignoreRules } }
        : current,
    );
  }

  async function clearActivity(): Promise<void> {
    await request<undefined>({ type: "options/clear-activity" });
    setState((current) =>
      current.kind === "ready"
        ? { kind: "ready", data: { ...current.data, summaries: {} } }
        : current,
    );
  }

  async function saveRanges(draft: string): Promise<string[]> {
    const ranges = await request<string[]>({ type: "options/save-ranges", draft });
    setState((current) =>
      current.kind === "ready"
        ? { kind: "ready", data: { ...current.data, ipRanges: ranges } }
        : current,
    );
    return ranges;
  }

  async function resetSection(): Promise<void> {
    if (resetting === undefined) return;
    setResetPending(true);
    setResetError(undefined);
    try {
      const data = await request<OptionsSnapshot>({
        type: "options/reset-section",
        section: resetting.section,
      });
      setState({ kind: "ready", data });
      setResetting(undefined);
    } catch (error) {
      setResetError(
        error instanceof Error ? error.message : "Cloudwatcher could not reset this section.",
      );
    } finally {
      setResetPending(false);
    }
  }

  function selectTab(next: View): void {
    setView(next);
    document.getElementById(`${next}-tab`)?.focus();
  }

  function activateTab(next: View): void {
    if (view === "ranges" && next !== "ranges" && rangesDirty) {
      setDiscardingFor(next);
      return;
    }
    selectTab(next);
  }

  function handleTabKey(event: KeyboardEvent): void {
    const tabs = ["warnings", "ignored", "activity", "ranges"] as const;
    const index = tabs.indexOf(view);
    const next =
      event.key === "ArrowRight"
        ? tabs[(index + 1) % tabs.length]
        : event.key === "ArrowLeft"
          ? tabs[(index + tabs.length - 1) % tabs.length]
          : event.key === "Home"
            ? tabs[0]
            : event.key === "End"
              ? tabs.at(-1)
              : undefined;
    if (next === undefined) return;
    activateTab(next);
    event.preventDefault();
  }

  return (
    <main class="options" aria-busy={state.kind === "loading" ? "true" : "false"}>
      <header class="options__header">
        <p class="options__product">Cloudwatcher</p>
        <h1>Settings</h1>
        <p>Local controls for warnings, shared ignore rules, and observed domains.</p>
      </header>

      {state.kind === "loading" ? (
        <p class="options__loading" role="status">
          Loading settings
        </p>
      ) : null}
      {state.kind === "error" ? (
        <section class="options__error" aria-labelledby="options-load-error">
          <h2 id="options-load-error">Settings unavailable</h2>
          <p role="alert">{state.error}</p>
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : null}
      {state.kind === "ready" ? (
        <div class="options__workspace">
          <div
            class="options__nav"
            role="tablist"
            aria-label="Settings sections"
            onKeyDown={handleTabKey}
          >
            {(
              [
                ["warnings", "Warnings"],
                ["ignored", "Ignored sites"],
                ["activity", "Activity"],
                ["ranges", "IP ranges"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`${id}-tab`}
                aria-controls={`${id}-panel`}
                aria-selected={view === id ? "true" : "false"}
                tabIndex={view === id ? 0 : -1}
                class={view === id ? "is-current" : undefined}
                onClick={() => activateTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <section
            ref={panelFallback}
            class="options__view"
            id={`${view}-panel`}
            role="tabpanel"
            aria-labelledby={`${view}-tab`}
            tabIndex={-1}
          >
            {state.data.diagnostics.length > 0 ? (
              <section class="options__diagnostics" aria-label="Storage diagnostics">
                {state.data.diagnostics.map((diagnostic) => {
                  return (
                    <div key={`${diagnostic.section}-${diagnostic.message}`}>
                      <p role="alert">
                        <strong>{sectionLabel(diagnostic.section)}:</strong> {diagnostic.message}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setResetError(undefined);
                          setResetting(diagnostic);
                        }}
                      >
                        Reset this section
                      </button>
                    </div>
                  );
                })}
              </section>
            ) : null}
            {view === "warnings" ? (
              <WarningsView settings={state.data.settings} onSave={saveSettings} />
            ) : null}
            {view === "ignored" ? (
              <IgnoredView rules={state.data.ignoreRules} onRemove={removeIgnore} />
            ) : null}
            {view === "activity" ? (
              <ActivityView summaries={state.data.summaries} onClear={clearActivity} />
            ) : null}
            {view === "ranges" ? (
              <RangesView
                ranges={state.data.ipRanges}
                onDirtyChange={setRangesDirty}
                onSave={saveRanges}
              />
            ) : null}
            {resetting === undefined ? null : (
              <ConfirmationDialog
                labelledBy="reset-section-heading"
                fallback={panelFallback}
                confirmLabel={resetPending ? "Resetting section…" : "Reset section"}
                pending={resetPending}
                onCancel={() => !resetPending && setResetting(undefined)}
                onConfirm={() => void resetSection()}
              >
                <h3 id="reset-section-heading">
                  Reset{" "}
                  {resetting.section === "ignoreRules"
                    ? "ignored sites"
                    : resetting.section === "ipRanges"
                      ? "IP ranges"
                      : resetting.section}
                </h3>
                <p>This replaces the affected local settings with safe defaults.</p>
                {resetError === undefined ? null : (
                  <p class="options__mutation-error" role="alert">
                    {resetError}
                  </p>
                )}
              </ConfirmationDialog>
            )}
            {discardingFor === undefined ? null : (
              <ConfirmationDialog
                labelledBy="discard-range-navigation-heading"
                fallback={panelFallback}
                confirmLabel="Discard changes"
                pending={false}
                onCancel={() => setDiscardingFor(undefined)}
                onConfirm={() => {
                  const next = discardingFor;
                  setRangesDirty(false);
                  setDiscardingFor(undefined);
                  selectTab(next);
                }}
              >
                <h3 id="discard-range-navigation-heading">Discard IP range changes</h3>
                <p>Your unsaved IP range changes will be discarded.</p>
              </ConfirmationDialog>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
