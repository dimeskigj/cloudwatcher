---
target: current extension UI (src/entrypoints)
total_score: 27
p0_count: 0
p1_count: 2
timestamp: 2026-08-24T21-03-20Z
slug: src-entrypoints
---
Method: dual-agent (A: ses_fca6c4128ffeW1g7JMx4TsM5C9 · B: ses_fca6c4103ffeKPML2h4FY89idC)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3/4 | Saving settings has no explicit success confirmation. |
| 2 | Match System / Real World | 3/4 | Overlay, banner, CIDR, and header-only detection lack in-context explanation. |
| 3 | User Control and Freedom | 2/4 | Escape accepts “Continue once” in a blocking notice. |
| 4 | Consistency and Standards | 4/4 | Shared tokens, controls, focus handling, and readouts are notably consistent. |
| 5 | Error Prevention | 3/4 | Warning-mode consequences are not made clear before selection. |
| 6 | Recognition Rather Than Recall | 3/4 | Users must infer warning modes and technical terms. |
| 7 | Flexibility and Efficiency | 2/4 | No fast expert path beyond native control and tab-keyboard support. |
| 8 | Aesthetic and Minimalist Design | 3/4 | The dirty range editor gives five actions equal prominence. |
| 9 | Error Recovery | 3/4 | Several UI paths surface uncurated runtime messages. |
| 10 | Help and Documentation | 1/4 | No discoverable help or concise definitions at consequential decisions. |
| **Total** | | **27/40** | **Acceptable: significant improvements needed** |

## Anti-Patterns Verdict

The source does not read as AI-generated. It has a product-specific field-notebook character: neutral structural surfaces, evidence-first definition lists, purposeful red and teal semantics, compact system typography, and no decorative dashboard scaffolding.

The deterministic scan found 16 advisory token-drift findings across `notice.css`, `options/style.css`, and `popup/style.css`: 14 undocumented font sizes, one undocumented radius, and one undocumented hover color. Most are expected compact metadata or intentional hierarchy variants. The 8px Options dialog radius is the only probable mismatch with the current DESIGN.md token inventory. Browser overlay inspection was unavailable because this environment exposes no browser automation or mutable page evaluation; no user-visible overlay was created.

## Overall Impression

Cloudwatcher is visually disciplined and unusually considerate of accessibility for a browser extension. The largest opportunity is to make consequential choices feel as protective as the visual system promises: explain warning outcomes, reserve consent for explicit actions, and calm the technical range-management flow.

## What's Working

- Evidence is treated as inspectable facts, not alarmist speculation: the Popup and Notice definition lists identify the site, host, and detection signal without decorative noise.
- Accessibility engineering is robust: native dialog use, focus restoration, keyboard tab navigation, visible focus, semantic status/error announcements, and reduced-motion behavior are all deliberate.
- The visual vocabulary holds together across Options, Popup, and injected notices: shared tokens, 44px controls, structural rules, and restrained semantic accents support the product purpose.

## Priority Issues

### [P1] Escape accepts a safety decision

**What:** `Notice.tsx:158-165` maps `Escape` in the blocking overlay to `Continue once`.

**Why it matters:** A conventional exit key silently moves someone past a privacy warning. This conflicts with the product promise of protective, user-controlled behavior and creates a keyboard-specific risk.

**Fix:** Make Escape select a product-defined safe exit such as `Go back`, or add a neutral dismiss action if the warning model supports it. Keep `Continue once` an explicit choice.

**Suggested command:** `/impeccable harden src/entrypoints/cloudwatcher.content/Notice.tsx`

### [P1] Warning modes are implementation labels, not outcomes

**What:** `WarningsView.tsx:35-68` offers Overlay, Banner, and Off without explaining interruption level, placement, or retained activity.

**Why it matters:** First-time users must translate technical UI terms into a browsing consequence before saving a durable setting.

**Fix:** Add short outcome-based descriptions, such as “Blocking overlay before continuing,” “Non-blocking banner at the top of the page,” and “No notice; keep recording activity.”

**Suggested command:** `/impeccable clarify src/entrypoints/options/WarningsView.tsx`

### [P2] The IP-range editor gives five actions peer weight

**What:** `RangesView.tsx:129-158` exposes Save, Import, Export, Discard, and Reset together beside a technical text area.

**Why it matters:** It overloads a high-consequence workflow by combining routine editing, transfer, and recovery into one visual decision point.

**Fix:** Keep Save as the lone primary action. Group Import and Export under “Transfer ranges” and separate Reset and Discard as draft-management or destructive secondary controls.

**Suggested command:** `/impeccable distill src/entrypoints/options/RangesView.tsx`

### [P2] Runtime errors are not consistently curated for recovery

**What:** `options/App.tsx:52-56`, `WarningsView.tsx:22-25`, `RangesView.tsx:45-49`, and `IgnoredView.tsx:32-34` render `Error.message` directly.

**Why it matters:** Backend wording may be technical or lack a next step, leaving an otherwise calm, direct interface inconsistent at failure time.

**Fix:** Map non-validation failures to stable task-specific recovery copy. Preserve granular CIDR validation only where it tells the user exactly what to correct.

**Suggested command:** `/impeccable clarify src/entrypoints/options`

### [P3] DESIGN.md does not yet describe every real hierarchy token

**What:** The detector reports 14 font-size variations, an 8px dialog radius, and a primary-hover color not fully represented in the frontmatter.

**Why it matters:** The machine-readable system can drift from production styles and make future automated variants less faithful.

**Fix:** Add the real compact metadata, popup title/count, banner title, dialog radius, and primary-hover variants to DESIGN.md. Do not normalize away intentional density.

**Suggested command:** `/impeccable document`

## Persona Red Flags

### Alex, Power User

- The range editor supports bulk text and transfer operations, but it has no visible compact expert path and presents five peer actions for a routine maintenance task.
- Escape does not behave as a conventional cancellation mechanism in a blocking notice.

### Jordan, First-Timer

- Warning-mode labels assume the user understands overlay and banner behavior.
- CIDR ranges and header-only detection are unexplained technical terms.
- “Could not check this tab” in `popup/App.tsx:97-104` gives a retry but not a reason or a tailored recovery path.

### Sam, Accessibility-Dependent User

- The baseline is strong: keyboard navigation, native dialog semantics, focus restoration, text-plus-color status, and reduced motion are all present.
- Escape triggering `Continue once` is still a significant keyboard-path mismatch.
- The dirty range editor is cognitively crowded when traversed sequentially with a keyboard.

## Minor Observations

- Standardize `...` and `…` across pending labels.
- Activity repeats its local-history retention statement in both introduction and empty state.
- A popup count of 0 can read as a confirmed negative detection instead of no recorded observations.

## Questions to Consider

- Should a privacy warning ever let Escape select Continue, or should the safest action remain explicit?
- Can warning mode be described by interruption and user outcome instead of implementation terms?
- Would range maintenance feel calmer if transfer and draft recovery became secondary workflows?
