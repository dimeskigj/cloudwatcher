import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { DetectionEvidence, IgnoreRule, NoticeState } from "../../core/model";

export type NoticeAction =
  | { type: "continue" }
  | { type: "leave" }
  | { type: "ignore"; rule: IgnoreRule };

interface NoticeProps {
  notice: NoticeState;
  onAction: (action: NoticeAction) => Promise<void>;
}

const ERROR_MESSAGE = "Cloudwatcher could not save that choice. Try again.";
const FOCUSABLE_SELECTOR = "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
const OVERLAY_BUBBLE_EVENTS = [
  "keydown",
  "keyup",
  "click",
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "wheel",
] as const;

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

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function activeElementFor(panel: HTMLElement): Element | null {
  const root = panel.getRootNode();
  return "activeElement" in root
    ? (root as Document | ShadowRoot).activeElement
    : panel.ownerDocument.activeElement;
}

function focusFirstAvailable(panel: HTMLElement, preferred?: HTMLElement | null): void {
  if (preferred !== null && preferred !== undefined && !preferred.hasAttribute("disabled")) {
    preferred.focus();
    return;
  }

  (focusableElements(panel)[0] ?? panel).focus();
}

export function Notice({ notice, onAction }: NoticeProps) {
  const headingId = useId();
  const descriptionId = useId();
  const chooserId = useId();
  const noticeRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const ignoreRef = useRef<HTMLButtonElement>(null);
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const restoreIgnoreFocus = useRef(false);
  const [choosingIgnore, setChoosingIgnore] = useState(false);
  const [pending, setPending] = useState(false);
  const [hasError, setHasError] = useState(false);
  const isOverlay = notice.mode === "overlay";
  const heading =
    notice.kind === "direct"
      ? "Cloudflare detected for this site"
      : "This page loads content through Cloudflare";
  const description =
    notice.kind === "direct"
      ? "Cloudwatcher observed a Cloudflare signal while this site loaded."
      : "Cloudwatcher observed a Cloudflare signal in content loaded by this page.";

  useLayoutEffect(() => {
    if (!isOverlay) {
      return;
    }

    const noticeElement = noticeRef.current;
    if (noticeElement === null) {
      return;
    }

    const stopPageBubble = (event: Event) => event.stopPropagation();
    for (const type of OVERLAY_BUBBLE_EVENTS) {
      noticeElement.addEventListener(type, stopPageBubble);
    }

    return () => {
      for (const type of OVERLAY_BUBBLE_EVENTS) {
        noticeElement.removeEventListener(type, stopPageBubble);
      }
    };
  }, [isOverlay]);

  useEffect(() => {
    if (!isOverlay) {
      return;
    }

    const panel = panelRef.current;
    if (panel === null) {
      return;
    }

    focusFirstAvailable(panel, continueRef.current);
    const containFocus = () => {
      const activeElement = activeElementFor(panel);
      if (activeElement === null || !panel.contains(activeElement)) {
        focusFirstAvailable(panel, continueRef.current);
      }
    };
    document.addEventListener("focusin", containFocus, true);

    return () => document.removeEventListener("focusin", containFocus, true);
  }, [isOverlay]);

  useEffect(() => {
    if (choosingIgnore) {
      firstChoiceRef.current?.focus();
    } else if (restoreIgnoreFocus.current) {
      restoreIgnoreFocus.current = false;
      ignoreRef.current?.focus();
    }
  }, [choosingIgnore]);

  async function performAction(action: NoticeAction): Promise<void> {
    if (pending) {
      return;
    }

    setPending(true);
    setHasError(false);

    try {
      await onAction(action);
    } catch {
      setHasError(true);
    } finally {
      setPending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!pending) {
        void performAction({ type: "continue" });
      }
      return;
    }

    if (!isOverlay || event.key !== "Tab") {
      return;
    }

    const panel = panelRef.current;
    if (panel === null) {
      return;
    }

    const focusable = focusableElements(panel);
    const first = focusable[0];
    const last = focusable.at(-1);

    if (first === undefined || last === undefined) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const activeElement = activeElementFor(panel);
    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const panelProps = isOverlay
    ? ({ role: "dialog", "aria-modal": "true" } as const)
    : ({ role: "region" } as const);

  return (
    <div ref={noticeRef} class={`notice notice--${notice.mode}`}>
      <section
        {...panelProps}
        ref={panelRef}
        class="notice__panel"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        aria-busy={pending ? "true" : "false"}
        data-error={hasError ? "true" : "false"}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <div class="notice__identity">
          <span class="notice__product">Cloudwatcher</span>
          <span class="notice__observed">Observed</span>
        </div>

        <div class="notice__body">
          <div class="notice__message" role={isOverlay ? undefined : "status"}>
            <h1 id={headingId}>{heading}</h1>
            <p id={descriptionId}>{description}</p>
          </div>

          <dl class="notice__readout" aria-label="Detection details">
            <dt>Site </dt>
            <dd>
              <code>{notice.siteHost}</code>
            </dd>
            {notice.kind === "content" && notice.resourceHost !== undefined ? (
              <>
                <dt>Observed host </dt>
                <dd>
                  <code>{notice.resourceHost}</code>
                </dd>
              </>
            ) : null}
            {notice.evidence.length > 0 ? (
              <>
                <dt>Evidence</dt>
                <dd class="notice__evidence">
                  {notice.evidence.map((evidence, index) => (
                    <span key={`${evidence.kind}-${index}`}>{evidenceLabel(evidence)}</span>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>
        </div>

        <div class="notice__actions">
          <button
            ref={continueRef}
            class="notice__button notice__button--primary"
            type="button"
            disabled={pending}
            onClick={() => void performAction({ type: "continue" })}
          >
            Continue once
          </button>
          <button
            class="notice__button"
            type="button"
            disabled={pending}
            onClick={() => void performAction({ type: "leave" })}
          >
            Go back
          </button>
          <button
            ref={ignoreRef}
            class="notice__button notice__button--quiet"
            type="button"
            aria-expanded={choosingIgnore}
            aria-controls={choosingIgnore ? chooserId : undefined}
            disabled={pending}
            onClick={() => setChoosingIgnore(true)}
          >
            Don't warn here again
          </button>
        </div>

        {choosingIgnore ? (
          <fieldset id={chooserId} class="notice__chooser">
            <legend class="notice__chooser-label">Stop future notices for</legend>
            <div class="notice__choices">
              {notice.ignoreChoices.map((choice, index) => (
                <button
                  ref={index === 0 ? firstChoiceRef : undefined}
                  class="notice__button notice__choice"
                  type="button"
                  disabled={pending}
                  onClick={() => void performAction({ type: "ignore", rule: choice.rule })}
                  key={`${choice.rule.scope}:${choice.rule.value}`}
                >
                  {choice.label}
                </button>
              ))}
              <button
                class="notice__button notice__button--quiet"
                type="button"
                disabled={pending}
                onClick={() => {
                  restoreIgnoreFocus.current = true;
                  setChoosingIgnore(false);
                  setHasError(false);
                }}
              >
                Cancel
              </button>
            </div>
          </fieldset>
        ) : null}

        {hasError ? (
          <p class="notice__error" role="alert" aria-label={ERROR_MESSAGE}>
            {ERROR_MESSAGE}
          </p>
        ) : null}
      </section>
    </div>
  );
}
