import { useState } from "preact/hooks";
import type { IgnoreRule } from "../../core/model";
import { ConfirmationDialog } from "./ConfirmationDialog";

function ruleLabel(rule: IgnoreRule): string {
  return rule.value;
}

export function IgnoredView({
  rules,
  onRemove,
}: {
  rules: IgnoreRule[];
  onRemove: (rule: IgnoreRule) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<IgnoreRule>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const matching = rules.filter((rule) =>
    ruleLabel(rule).trim().toLowerCase().includes(query.trim().toLowerCase()),
  );

  async function remove(): Promise<void> {
    if (selected === undefined) return;
    setPending(true);
    setError(undefined);
    try {
      await onRemove(selected);
      setSelected(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cloudwatcher could not remove that rule.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="ignored-heading">
      <h2 id="ignored-heading">Ignored sites</h2>
      <p class="options__intro">Rules apply to both direct-site and content warnings.</p>
      <label class="options__search">
        <span>Search ignored sites</span>
        <input
          value={query}
          type="search"
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      {rules.length === 0 ? (
        <p class="options__empty">
          No sites are ignored. New rules appear here after you silence a site warning.
        </p>
      ) : null}
      {rules.length > 0 && matching.length === 0 ? (
        <p class="options__empty">No ignored sites match that search.</p>
      ) : null}
      <ul class="options__rows" aria-label="Ignored site rules">
        {matching.map((rule) => (
          <li key={`${rule.scope}-${rule.value}`}>
            <div>
              <code>{ruleLabel(rule)}</code>
              <span>{rule.scope === "host" ? "Exact host" : "Whole site"}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setError(undefined);
                setSelected(rule);
              }}
              aria-label={`Remove ${ruleLabel(rule)}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {selected === undefined ? null : (
        <ConfirmationDialog
          labelledBy="remove-rule-heading"
          confirmLabel={pending ? "Removing rule…" : "Remove rule"}
          pending={pending}
          onCancel={() => !pending && setSelected(undefined)}
          onConfirm={() => void remove()}
        >
          <h3 id="remove-rule-heading">Remove ignored site</h3>
          <p>
            Warnings for <code>{ruleLabel(selected)}</code> can appear again.
          </p>
          {error === undefined ? null : (
            <p class="options__mutation-error" role="alert">
              {error}
            </p>
          )}
        </ConfirmationDialog>
      )}
    </section>
  );
}
