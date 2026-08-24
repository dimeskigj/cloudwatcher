# Critique Improvements Design

## Goal

Apply every finding from the `src/entrypoints` design critique without redesigning Cloudwatcher’s evidence-first visual system. The result must make protective decisions explicit, clarify configuration consequences, reduce cognitive load in range management, curate recovery copy, and keep the documented design system faithful to production.

## Scope

The work covers the injected Cloudwatcher notice, Options warning/range/activity/ignored flows, Popup unavailable state, corresponding tests, and `DESIGN.md`. It does not change detection logic, storage schemas, browser permissions, tab structure, or the established neutral-plus-signal visual language.

## Interaction Changes

### Notice overlay dismissal

When a Cloudwatcher overlay is open, `Escape` dismisses the notice and leaves the user on the current page. This uses the existing `continue` action path, but it must not present `Continue once` as the label or focus target for the keyboard dismissal. The visible primary action remains `Continue once`; Escape is an equivalent neutral dismissal that does not add an ignore rule or navigate away.

### Warning-setting clarity and confirmation

Each warning-mode select receives adjacent outcome-led help text:

- Overlay: blocks the page until the user dismisses the notice.
- Banner: shows a compact notice at the top of the page without blocking it.
- Off: shows no notice while continuing to record activity locally.

The save button changes to `Saved` after a successful save, then returns to `Save warning settings` after a short, reduced-motion-safe timeout or when the user changes either setting. Failed saves retain the existing error treatment and never show success.

### Range-editor hierarchy

Save remains the only primary action. Import and Export form a labeled `Transfer ranges` group. Reset draft and Discard changes form a visibly separate `Draft management` group; Discard only appears for dirty drafts, and Reset retains its confirmation dialog. Existing import/export behavior and draft semantics remain unchanged.

After a successful save, the button changes to `Saved` briefly, resets if the draft changes, and remains disabled when the draft matches the saved value. Validation errors remain line-specific.

### Error recovery

Generic caught runtime errors in Options views use stable, task-specific copy rather than displaying `Error.message` directly. This applies to loading Options, saving warnings, reading imports, saving ranges when no CIDR validation details exist, removing an ignore rule, and clearing activity. CIDR validation errors continue to identify each invalid line and its correction context.

The Popup unavailable state distinguishes a generic inspection failure from unavailable state data where the current API already exposes it. Its user-facing fallback states that Cloudwatcher could not inspect the current tab and offers retry; it does not invent unsupported causes or permission advice.

### Small copy cleanup

Use the ellipsis character consistently in pending labels. Remove repeated privacy-retention language from the Activity empty state while retaining it in the Activity introduction. Popup zero-count labels clarify that no observations have been recorded when that is the rendered state.

## Design-System Documentation

`DESIGN.md` is expanded to document the real hierarchy already used in source: compact metadata (12px and 13px), popup title and count (20px), banner title (18px), the 8px dialog radius, and the darker signal hover color. These are additions to the token inventory, not visual changes. The detector should no longer report intentional production values as undocumented drift.

## Testing

Add or extend tests that prove:

- Escape triggers the dismiss/continue action for overlays without navigation or ignore behavior.
- Warning descriptions render and successful saves temporarily show `Saved`; changes and failures clear or prevent the confirmation.
- Range actions render in their named groups, retain all existing behavior, and successful saves show `Saved` before returning to normal.
- Generic runtime errors render the curated task-specific messages while CIDR line validation remains intact.
- Popup unavailable copy is actionable and does not claim an unverified cause.
- Updated `DESIGN.md` values match the established CSS values.

Existing keyboard, focus restoration, reduced-motion, and destructive-confirmation behavior must remain covered.

## Acceptance Criteria

- No keyboard shortcut silently navigates away, adds an ignore rule, or changes a durable preference.
- A first-time user can tell what each warning setting does before saving.
- The range editor communicates one primary action, a transfer workflow, and draft-recovery actions without changing import, export, reset, or discard behavior.
- Every changed asynchronous mutation has a clear pending, success, and failure state.
- No generic raw runtime message appears in the changed Options paths.
- `DESIGN.md` accurately describes the existing values flagged by the detector.
- Relevant component tests, linting, type checking, and the build pass.
