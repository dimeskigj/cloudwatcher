# Critique Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cloudwatcher’s safety controls, warning settings, range management, recovery copy, and documented design tokens match its vigilant, evidence-first product promise.

**Architecture:** Preserve the existing Preact component boundaries and WXT message contracts. Each component owns its own transient success state and user-facing fallback copy; no new shared mutation abstraction is necessary. Reorganize the range action markup with semantic groups and extend the existing Options CSS rather than introducing a new layout system.

**Tech Stack:** TypeScript, Preact, WXT, Vitest, Testing Library, axe-core, CSS with OKLCH tokens.

## Global Constraints

- Do not change detection logic, storage schemas, browser permissions, or the Options tab structure.
- Keep the neutral-plus-signal visual language and use existing `--cw-*` CSS tokens.
- Retain native dialog, keyboard focus, reduced-motion, and destructive-confirmation behavior.
- Do not display raw caught `Error.message` values in changed generic Options failure paths.
- Preserve CIDR line-level validation details.
- Use the ellipsis character (`…`) in all changed pending labels.
- Run TDD red-green cycles before each implementation step.

---

## File Structure

- `src/entrypoints/cloudwatcher.content/Notice.tsx`: retain the visible primary action while making Escape a neutral overlay dismissal.
- `src/entrypoints/cloudwatcher.content/Notice.test.tsx`: lock down Escape’s dismiss behavior and existing action semantics.
- `src/entrypoints/options/WarningsView.tsx`: add outcome-led help, save confirmation, and stable failure copy.
- `src/entrypoints/options/RangesView.tsx`: separate primary, transfer, and draft-management actions; add save confirmation and stable generic recovery copy.
- `src/entrypoints/options/IgnoredView.tsx`: replace raw remove failure text with stable recovery copy.
- `src/entrypoints/options/ActivityView.tsx`: replace raw clear failure text and remove duplicated empty-state privacy copy.
- `src/entrypoints/options/App.tsx`: provide stable Options-load recovery copy.
- `src/entrypoints/options/style.css`: style the range action groups without nested card treatment.
- `src/entrypoints/options/App.test.tsx`: cover warning copy/status, grouped range controls, curated recovery copy, and activity empty state.
- `src/entrypoints/options/RangesView.test.tsx`: cover range grouping, confirmation state, and generic range/import failures.
- `src/entrypoints/popup/App.tsx`: make unavailable and zero-count status copy self-explanatory.
- `src/entrypoints/popup/App.test.tsx`: cover unavailable and zero-count copy.
- `DESIGN.md`: document the real typography, radius, and hover variants already in CSS.

### Task 1: Make Overlay Escape a Neutral Dismissal

**Files:**
- Modify: `src/entrypoints/cloudwatcher.content/Notice.tsx:158-165`
- Test: `src/entrypoints/cloudwatcher.content/Notice.test.tsx:272-292`

**Interfaces:**
- Consumes: `NoticeAction`, where `{ type: "continue" }` removes the current notice without adding an ignore rule or navigating away.
- Produces: unchanged `NoticeAction` contract; Escape and the visible `Continue once` button both send `{ type: "continue" }`.

- [ ] **Step 1: Write the failing keyboard-behavior test**

Replace the existing generic Escape expectation with a test that proves the visible action is still explicit and Escape does not select an ignore or leave action:

```tsx
it("dismisses an overlay with Escape while leaving explicit actions unchanged", async () => {
  const user = userEvent.setup();
  const onAction = resolvedAction();
  render(<Notice notice={directNotice} onAction={onAction} />);

  expect(screen.getByRole("button", { name: "Continue once" })).toBeVisible();
  await user.keyboard("{Escape}");

  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onAction).toHaveBeenCalledWith({ type: "continue" });
  expect(onAction).not.toHaveBeenCalledWith({ type: "leave" });
  expect(onAction).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ignore" }));
});
```

- [ ] **Step 2: Run the focused test to verify the current behavior contract**

Run: `npm test -- src/entrypoints/cloudwatcher.content/Notice.test.tsx`

Expected: the new test passes only after the implementation wording/intent is made explicit; existing keyboard tests continue to pass.

- [ ] **Step 3: Implement the minimal behavior clarification**

Keep the existing action shape and prevent future ambiguity by isolate the Escape route in `handleKeyDown`:

```tsx
if (event.key === "Escape") {
  event.preventDefault();
  event.stopPropagation();
  if (!pending) {
    // Escape dismisses the notice; it never ignores the site or navigates away.
    void performAction({ type: "continue" });
  }
  return;
}
```

Do not rename the visible `Continue once` control and do not add a new action type.

- [ ] **Step 4: Run the focused test suite**

Run: `npm test -- src/entrypoints/cloudwatcher.content/Notice.test.tsx`

Expected: PASS with all notice semantics, focus trapping, and keyboard tests green.

- [ ] **Step 5: Commit the task**

```bash
git add src/entrypoints/cloudwatcher.content/Notice.tsx src/entrypoints/cloudwatcher.content/Notice.test.tsx
git commit -m "fix: clarify overlay escape dismissal"
```

### Task 2: Clarify Warning Modes and Confirm Successful Saves

**Files:**
- Modify: `src/entrypoints/options/WarningsView.tsx:4-85`
- Test: `src/entrypoints/options/App.test.tsx:70-112`

**Interfaces:**
- Consumes: `onSave(settings: Settings): Promise<void>`.
- Produces: `Saved` button state after a successful mutation; it resets on input and after a 2-second timeout.

- [ ] **Step 1: Write failing warning-view behavior tests**

Add tests through `App` that assert the descriptions and success state:

```tsx
expect(screen.getByText("Blocks the page until you dismiss the notice.")).toBeVisible();
expect(screen.getByText("Shows a compact notice without blocking the page.")).toBeVisible();
expect(screen.getByText("Shows no notice and still records activity locally.")).toBeVisible();

await user.click(screen.getByRole("button", { name: "Save warning settings" }));
expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
```

Use `vi.useFakeTimers()` in a separate test to advance 2 seconds and assert that `Save warning settings` returns. Add a failed-save assertion for `Cloudwatcher could not save warning settings. Try again.`

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- src/entrypoints/options/App.test.tsx`

Expected: FAIL because descriptions, the `Saved` state, and curated error copy do not exist yet.

- [ ] **Step 3: Implement descriptions, success state, and curated error copy**

In `WarningsView`, add `saved` state, reset it in either select `onInput`, and use a timer after a successful `onSave`:

```tsx
const [saved, setSaved] = useState(false);

function changeDraft(next: Settings): void {
  setDraft(next);
  setSaved(false);
}

// after await onSave(draft)
setSaved(true);
window.setTimeout(() => setSaved(false), 2000);
```

Render one concise description directly below each select. Use stable fallback text in `catch`:

```tsx
setError("Cloudwatcher could not save warning settings. Try again.");
```

Render the button label as `pending ? "Saving warning settings…" : saved ? "Saved" : "Save warning settings"` and disable it when `pending || saved`.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npm test -- src/entrypoints/options/App.test.tsx`

Expected: PASS, including current options navigation, dialog, accessibility, and warning-save tests.

- [ ] **Step 5: Commit the task**

```bash
git add src/entrypoints/options/WarningsView.tsx src/entrypoints/options/App.test.tsx
git commit -m "feat: clarify warning settings outcomes"
```

### Task 3: Separate Range Workflows and Add Range Save Feedback

**Files:**
- Modify: `src/entrypoints/options/RangesView.tsx:20-159`
- Modify: `src/entrypoints/options/style.css:185-195`
- Test: `src/entrypoints/options/RangesView.test.tsx:36-205`

**Interfaces:**
- Consumes: `onSave(draft: string): Promise<string[]>`.
- Produces: semantic `Transfer ranges` and `Draft management` groups; same import/export/reset/discard behavior; `Saved` feedback after a successful range save.

- [ ] **Step 1: Write failing range-editor tests**

Add tests for the groups, success state, and stable generic recovery:

```tsx
expect(screen.getByRole("group", { name: "Transfer ranges" })).toContainElement(
  screen.getByLabelText("Import IP ranges"),
);
expect(screen.getByRole("group", { name: "Draft management" })).toHaveTextContent(
  "Reset draft to defaults",
);

await user.click(screen.getByRole("button", { name: "Save IP ranges" }));
expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
```

For a rejected save without `validationErrors`, assert `Cloudwatcher could not save IP ranges. Try again.`. For a rejected import read, assert `Cloudwatcher could not read this file. Try again.`. Retain the existing line-error test unchanged.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- src/entrypoints/options/RangesView.test.tsx`

Expected: FAIL because no named action groups or `Saved` state exist and generic errors still expose `Error.message`.

- [ ] **Step 3: Implement the structural and state changes**

Use `<fieldset>` and `<legend>` for the secondary groups, leaving Save outside them:

```tsx
<div class="options__range-actions">
  <button class="options__primary" /* save props */>{saveLabel}</button>
  <fieldset class="options__range-action-group">
    <legend>Transfer ranges</legend>
    {/* existing import label and export button */}
  </fieldset>
  <fieldset class="options__range-action-group">
    <legend>Draft management</legend>
    {/* existing dirty discard and reset buttons */}
  </fieldset>
</div>
```

Add `saved` state with the same reset-on-edit and 2-second timeout behavior as warning settings. Use stable generic fallback messages in import and non-validation save failures. Keep `errors` and line-level error display unchanged when `validationErrors` is present. Update CSS so the groups wrap cleanly, have no filled card background, and use a 1px `var(--cw-line)` separator only between secondary groups at wider widths.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npm test -- src/entrypoints/options/RangesView.test.tsx`

Expected: PASS with all import ordering, export, reset, discard, line-validation, grouping, and success-feedback tests green.

- [ ] **Step 5: Commit the task**

```bash
git add src/entrypoints/options/RangesView.tsx src/entrypoints/options/style.css src/entrypoints/options/RangesView.test.tsx
git commit -m "feat: simplify range editor actions"
```

### Task 4: Curate Options Recovery Copy and Remove Duplicated Activity Copy

**Files:**
- Modify: `src/entrypoints/options/App.tsx:48-57`
- Modify: `src/entrypoints/options/IgnoredView.tsx:25-36`
- Modify: `src/entrypoints/options/ActivityView.tsx:26-38,64-68`
- Test: `src/entrypoints/options/App.test.tsx:95-111,241-306,309-317`

**Interfaces:**
- Consumes: existing rejected browser-runtime message promises.
- Produces: stable text for load, remove, and clear failures; no raw error content in those paths.

- [ ] **Step 1: Write failing recovery-copy tests**

Change existing failed mutation expectations to stable messages and add a load-failure assertion:

```tsx
expect(await screen.findByRole("alert")).toHaveTextContent(
  "Cloudwatcher could not load settings. Try again.",
);
expect(await screen.findByRole("alert")).toHaveTextContent(
  "Cloudwatcher could not remove that ignored site. Try again.",
);
expect(await screen.findByRole("alert")).toHaveTextContent(
  "Cloudwatcher could not clear local activity. Try again.",
);
```

Update the empty-activity test to assert `No detailed URL history is stored.` appears once, in the introduction.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- src/entrypoints/options/App.test.tsx`

Expected: FAIL because the components currently render backend message strings and duplicate the activity privacy sentence.

- [ ] **Step 3: Implement stable copy**

Replace each generic `catch` branch with its exact stable text:

```tsx
// App load
error: "Cloudwatcher could not load settings. Try again.";
// IgnoredView remove
setError("Cloudwatcher could not remove that ignored site. Try again.");
// ActivityView clear
setError("Cloudwatcher could not clear local activity. Try again.");
```

Change the empty Activity copy to `No activity has been recorded yet.` while leaving the introductory privacy statement unchanged.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npm test -- src/entrypoints/options/App.test.tsx`

Expected: PASS with existing retries, dialog lifecycle, focus restoration, and axe checks intact.

- [ ] **Step 5: Commit the task**

```bash
git add src/entrypoints/options/App.tsx src/entrypoints/options/IgnoredView.tsx src/entrypoints/options/ActivityView.tsx src/entrypoints/options/App.test.tsx
git commit -m "fix: curate options recovery copy"
```

### Task 5: Clarify Popup Unavailable and Zero-Observation States

**Files:**
- Modify: `src/entrypoints/popup/App.tsx:25-35,97-104,163-172`
- Test: `src/entrypoints/popup/App.test.tsx:136-172`

**Interfaces:**
- Consumes: unchanged `PopupState` values (`none`, `unavailable`, absent `summary`).
- Produces: user-facing state descriptions without claiming a detection result or an unverified failure cause.

- [ ] **Step 1: Write failing popup copy tests**

Add assertions such as:

```tsx
expect(await screen.findByText("No observations have been recorded for this site yet.")).toBeVisible();
expect(await screen.findByText("Cloudwatcher could not inspect this tab. Try again.")).toBeVisible();
```

Do not change the existing bounded `No Cloudflare observed` assertion.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- src/entrypoints/popup/App.test.tsx`

Expected: FAIL because the popup currently renders bare zeros and generic unavailable text.

- [ ] **Step 3: Implement precise status copy**

Keep `headingFor` values unchanged. In the unavailable ready-state, render an explanatory paragraph before the history counts. In `Status`, render the no-observations sentence when `state.summary === undefined`; preserve numeric count readouts for stored summaries, including valid zero counts.

For request failures, replace the error paragraph with `Cloudwatcher could not inspect this tab. Try again.` and retain the retry button.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `npm test -- src/entrypoints/popup/App.test.tsx`

Expected: PASS with all loading, direct/content/none/unavailable, retry, settings opening, and axe tests green.

- [ ] **Step 5: Commit the task**

```bash
git add src/entrypoints/popup/App.tsx src/entrypoints/popup/App.test.tsx
git commit -m "fix: clarify popup unavailable states"
```

### Task 6: Bring DESIGN.md’s Machine-Readable Tokens Up to Date

**Files:**
- Modify: `DESIGN.md:13-70,165-190`
- Test: `DESIGN.md` through YAML parsing and detector scan

**Interfaces:**
- Consumes: existing source values in `notice.css`, `options/style.css`, and `popup/style.css`.
- Produces: documented 12px, 13px, 18px, and 20px typography roles; 8px dialog radius; and darker signal hover token.

- [ ] **Step 1: Run the detector to capture the current documented-token gaps**

Run: `node /home/dimeskigj/.opencode/skills/impeccable/scripts/detect.mjs --json src/entrypoints`

Expected: exit 2 with the existing font-size, radius, and hover-color drift findings.

- [ ] **Step 2: Update the frontmatter and prose with existing values**

Add only values present in source:

```yaml
colors:
  signal-hover: "oklch(0.445 0.18 28.3)"
typography:
  popup-title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 720
    lineHeight: "24px"
  compact-readout:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    lineHeight: "18px"
rounded:
  dialog: "8px"
```

Document the 13px metadata and 18px banner-title roles in the same frontmatter/prose hierarchy. Add a `button-primary-hover` component variant referencing `{colors.signal-hover}`.

- [ ] **Step 3: Verify YAML remains valid and the detector findings shrink to intentional exceptions only**

Run:

```bash
python3 -c 'import pathlib, yaml; text = pathlib.Path("DESIGN.md").read_text(); yaml.safe_load(text.split("---", 2)[1]); print("DESIGN.md frontmatter YAML valid")'
node /home/dimeskigj/.opencode/skills/impeccable/scripts/detect.mjs --json src/entrypoints
```

Expected: YAML parser reports valid frontmatter. Detector reports no undocumented values represented in DESIGN.md; if it retains source values the schema cannot represent precisely, document the exact rule and location in the commit message.

- [ ] **Step 4: Commit the task**

```bash
git add DESIGN.md
git commit -m "docs: align design tokens with extension UI"
```

### Task 7: Run the Full Verification Suite

**Files:**
- Verify only; no source changes expected.

**Interfaces:**
- Consumes: all prior task changes.
- Produces: evidence that type safety, tests, styling checks, and Chromium/Firefox builds work together.

- [ ] **Step 1: Run targeted test files**

Run:

```bash
npm test -- src/entrypoints/cloudwatcher.content/Notice.test.tsx
npm test -- src/entrypoints/options/App.test.tsx
npm test -- src/entrypoints/options/RangesView.test.tsx
npm test -- src/entrypoints/popup/App.test.tsx
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run static checks**

Run: `npm run lint && npm run typecheck`

Expected: both commands exit 0.

- [ ] **Step 3: Run the full test suite and builds**

Run: `npm test && npm run build`

Expected: all Vitest tests pass and Chromium plus Firefox builds exit 0.

- [ ] **Step 4: Inspect the final worktree and commit verification changes only if needed**

Run: `git status --short && git diff --check`

Expected: no whitespace errors. Do not modify or stage unrelated user changes.

## Plan Self-Review

### Spec coverage

- Overlay Escape dismissal: Task 1.
- Warning-mode outcome copy and save feedback: Task 2.
- Range action hierarchy, save feedback, and stable import/save recovery: Task 3.
- Options raw-error recovery and Activity copy cleanup: Task 4.
- Popup unavailable and zero-observation clarity: Task 5.
- Documented typography, radius, and hover tokens: Task 6.
- Targeted and full verification: Task 7.

### Placeholder scan

No TODOs, TBDs, deferred implementation notes, or undefined interfaces remain. Every code-changing task includes a red-green test cycle, exact paths, concrete user-facing copy, and verification commands.

### Type consistency

The plan keeps all existing public types and message contracts unchanged. The only new component-local state is boolean `saved`; it does not cross component boundaries.
