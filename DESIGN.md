---
name: Cloudwatcher
description: A local-first, passive Cloudflare detection extension.
colors:
  porcelain: "oklch(0.985 0 0)"
  smoke: "oklch(0.95 0 0)"
  ink: "oklch(0.19 0 0)"
  muted: "oklch(0.43 0 0)"
  line: "oklch(0.8 0 0)"
  signal: "oklch(0.489 0.19 28.3)"
  signal-hover: "oklch(0.445 0.18 28.3)"
  observed: "oklch(0.47 0.08 190)"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: "36px"
  popup-title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 720
    lineHeight: "24px"
  banner-title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 720
    lineHeight: "24px"
  compact-readout:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    lineHeight: "18px"
rounded:
  control: "6px"
  dialog: "8px"
  panel: "10px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.signal-hover}"
---

# Design System: Cloudwatcher

## Overview

**Creative North Star: "The Field Notebook"**

Cloudwatcher makes observed delivery facts legible with compact, local controls. Neutral structural surfaces carry the interface; red marks explicit action and teal marks an observation.

## Colors

Signal Red is for primary actions, focus, and selection. Observed Teal is informational. Neither is decorative.

## Typography

System UI type carries labels and prose. Mono is reserved for hosts, CIDRs, and technical evidence. Compact readouts use 12px or 13px; popup status counts use 20px.

## Elevation

Flat structural layers and 1px rules establish hierarchy. Shadows are reserved for notices and dialogs.

## Components

Controls are 44px minimum height with 6px corners. Dialogs use 8px corners; notice panels use 10px. Primary hover uses Signal Hover.

## Do's and Don'ts

### Do:
- **Do** lead with observed evidence and use concise outcome-led help.
- **Do** keep action hierarchy explicit and recovery copy task-specific.

### Don't:
- **Don't** use generic SaaS dashboard styling, decorative metrics, or corporate admin-panel conventions.
- **Don't** use semantic red or teal as decorative fills or gradients.
