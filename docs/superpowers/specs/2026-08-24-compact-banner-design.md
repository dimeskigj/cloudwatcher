# Compact Banner Design

## Goal

Make banner-mode Cloudwatcher notices a small, non-blocking top strip instead of a page-preview-sized panel.

## Design

Banner mode remains fixed above page content and accepts pointer events only inside its own panel. The panel uses a compact single-row layout on wide screens: product/status, concise detection message, primary dismissal, and a details control. It does not reserve page layout space or block interactions outside the strip.

Detection metadata, secondary navigation, and ignore controls move into an expandable details section within the strip. On narrow viewports the strip can wrap naturally, but controls retain their compact inline sizing rather than becoming full-width stacked buttons. Overlay mode and its modal focus behavior are unchanged.

## Testing

Update the stylesheet contract test to assert compact banner dimensions, local hit testing, and non-blocking placement. Preserve existing accessibility and action behavior tests.
