import { useEffect, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import type { RuntimeResponse } from "../../core/messages";
import type {
  IgnoreRule,
  OptionsSnapshot,
  Settings,
  StorageDiagnostic,
  StorageSection,
} from "../../core/model";
import { ActivityView } from "./ActivityView";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { IgnoredView } from "./IgnoredView";
import { WarningsView } from "./WarningsView";

type View = "warnings" | "ignored" | "activity";
type LoadState =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "ready"; data: OptionsSnapshot };

async function request<T>(message: unknown): Promise<T> {
  const response = (await browser.runtime.sendMessage(message)) as RuntimeResponse<T>;
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.data;
}

export function App() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [view, setView] = useState<View>("warnings");
  const [resetting, setResetting] = useState<StorageDiagnostic>();
  const [resetPending, setResetPending] = useState(false);
  const [resetError, setResetError] = useState<string>();

  async function load(): Promise<void> {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", data: await request<OptionsSnapshot>({ type: "options/get" }) });
    } catch (error) {
      setState({
        kind: "error",
        error: error instanceof Error ? error.message : "Cloudwatcher could not load settings.",
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

  async function resetSection(): Promise<void> {
    if (resetting === undefined) return;
    setResetPending(true);
    setResetError(undefined);
    try {
      await request<unknown>({ type: "options/reset-section", section: resetting.section });
      const data = await request<OptionsSnapshot>({ type: "options/get" });
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

  function activateTab(next: View): void {
    setView(next);
    document.getElementById(`${next}-tab`)?.focus();
  }

  function handleTabKey(event: KeyboardEvent): void {
    const tabs = ["warnings", "ignored", "activity"] as const;
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
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <section
            class="options__view"
            id={`${view}-panel`}
            role="tabpanel"
            aria-labelledby={`${view}-tab`}
          >
            {state.data.diagnostics.length > 0 ? (
              <section class="options__diagnostics" aria-label="Storage diagnostics">
                {state.data.diagnostics.map((diagnostic) => {
                  const resettable = (
                    ["settings", "ignoreRules", "summaries"] as StorageSection[]
                  ).includes(diagnostic.section);
                  return (
                    <div key={`${diagnostic.section}-${diagnostic.message}`}>
                      <p role="alert">{diagnostic.message}</p>
                      {resettable ? (
                        <button
                          type="button"
                          onClick={() => {
                            setResetError(undefined);
                            setResetting(diagnostic);
                          }}
                        >
                          Reset this section
                        </button>
                      ) : null}
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
            {resetting === undefined ? null : (
              <ConfirmationDialog
                labelledBy="reset-section-heading"
                confirmLabel={resetPending ? "Resetting section…" : "Reset section"}
                pending={resetPending}
                onCancel={() => !resetPending && setResetting(undefined)}
                onConfirm={() => void resetSection()}
              >
                <h3 id="reset-section-heading">
                  Reset {resetting.section === "ignoreRules" ? "ignored sites" : resetting.section}
                </h3>
                <p>This replaces the affected local settings with safe defaults.</p>
                {resetError === undefined ? null : (
                  <p class="options__mutation-error" role="alert">
                    {resetError}
                  </p>
                )}
              </ConfirmationDialog>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
