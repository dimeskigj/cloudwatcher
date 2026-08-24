# Compact Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make banner notices a compact top strip that leaves page content usable.

**Architecture:** Keep the existing Notice component and its overlay branch intact. Add a banner-only details disclosure and compact CSS rules that constrain panel height, preserve local hit testing, and avoid full-width stacked controls on narrow screens.

**Tech Stack:** Preact, TypeScript, CSS, Vitest, Testing Library.

## Global Constraints

- Overlay modal semantics, focus containment, and actions remain unchanged.
- Banner mode remains non-modal and only its panel accepts pointer events.
- Use the existing OKLCH visual system and 44px minimum controls.
- Test behavior before implementation and run the focused suite after each change.

---

### Task 1: Compact Banner Layout

**Files:**
- Modify: `src/entrypoints/cloudwatcher.content/Notice.tsx`
- Modify: `src/entrypoints/cloudwatcher.content/notice.css`
- Test: `src/entrypoints/cloudwatcher.content/Notice.test.tsx`

**Interfaces:**
- Consumes: `NoticeState`, `NoticeAction`, existing `onAction` callback.
- Produces: a compact banner with an accessible details disclosure.

- [ ] **Step 1: Add a failing stylesheet-contract assertion**

```ts
expect(noticeCss).toMatch(/\.notice--banner\s+\.notice__panel\s*{[^}]*max-height:\s*min\(/s);
expect(noticeCss).toMatch(/\.notice--banner\s+\.notice__actions\s*{[^}]*margin-top:\s*0/s);
```

- [ ] **Step 2: Run the focused test**

Run: `npm test -- src/entrypoints/cloudwatcher.content/Notice.test.tsx`

Expected: FAIL because the existing banner has a full-height panel and a separate action row.

- [ ] **Step 3: Add banner details disclosure and compact CSS**

Render detection readout, Go back, and ignore controls in a banner details section. Keep the primary Continue once button inline. Use a max-height based on a few control rows and avoid the mobile full-width button override for banner controls.

- [ ] **Step 4: Run the focused test**

Run: `npm test -- src/entrypoints/cloudwatcher.content/Notice.test.tsx`

Expected: PASS with existing overlay and accessibility tests retained.

- [ ] **Step 5: Run project verification**

Run: `npm run verify && npm run test:e2e`

Expected: all checks pass; Firefox lint warnings remain documented generated-bundle warnings only.
