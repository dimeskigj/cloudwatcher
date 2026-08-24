import { useState } from "preact/hooks";
import type { DomainSummary } from "../../core/model";
import { ConfirmationDialog } from "./ConfirmationDialog";

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(timestamp),
  );
}

export function ActivityView({
  summaries,
  onClear,
}: {
  summaries: Record<string, DomainSummary>;
  onClear: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const rows = Object.entries(summaries).sort(([, a], [, b]) =>
    b.lastSeenAt.localeCompare(a.lastSeenAt),
  );

  async function clear(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      await onClear();
      setConfirming(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Cloudwatcher could not clear local activity.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="activity-heading">
      <div class="options__section-heading">
        <div>
          <h2 id="activity-heading">Activity</h2>
          <p class="options__intro">
            Counts are stored locally by domain. No detailed URL history is stored.
          </p>
        </div>
        {rows.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setError(undefined);
              setConfirming(true);
            }}
          >
            Clear all activity
          </button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p class="options__empty">
          No activity has been recorded. No detailed URL history is stored.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div class="options__table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Domain</th>
                <th scope="col">Direct</th>
                <th scope="col">Content</th>
                <th scope="col">Last observed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([domain, summary]) => (
                <tr key={domain}>
                  <th scope="row">
                    <code>{domain}</code>
                  </th>
                  <td>{summary.directNavigations}</td>
                  <td>{summary.contentNavigations}</td>
                  <td>
                    <time dateTime={summary.lastSeenAt}>
                      Last observed: {formatTimestamp(summary.lastSeenAt)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {confirming ? (
        <ConfirmationDialog
          labelledBy="clear-activity-heading"
          confirmLabel={pending ? "Clearing activity…" : "Clear activity"}
          pending={pending}
          onCancel={() => !pending && setConfirming(false)}
          onConfirm={() => void clear()}
        >
          <h3 id="clear-activity-heading">Clear local activity</h3>
          <p>This permanently removes local domain counts and observation times.</p>
          {error === undefined ? null : (
            <p class="options__mutation-error" role="alert">
              {error}
            </p>
          )}
        </ConfirmationDialog>
      ) : null}
    </section>
  );
}
