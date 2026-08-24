import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeResponse } from "../../core/messages";
import type { OptionsSnapshot } from "../../core/model";

const runtime = vi.hoisted(() => ({ browser: { runtime: { sendMessage: vi.fn() } } }));
const dialogs = vi.hoisted(() => ({ close: vi.fn(), showModal: vi.fn() }));

vi.mock("wxt/browser", () => ({ browser: runtime.browser }));
vi.mock("#imports", () => ({ browser: runtime.browser }));

import { App } from "./App";

const snapshot: OptionsSnapshot = {
  settings: { directNoticeMode: "overlay", contentNoticeMode: "banner" },
  ignoreRules: [
    { scope: "host", value: "cdn.example.com" },
    { scope: "site", value: "example.org" },
  ],
  ipRanges: [],
  summaries: {
    "older.example": {
      directNavigations: 1,
      contentNavigations: 2,
      lastSeenAt: "2026-08-20T10:00:00.000Z",
    },
    "recent.example": {
      directNavigations: 3,
      contentNavigations: 4,
      lastSeenAt: "2026-08-24T12:00:00.000Z",
    },
  },
  diagnostics: [],
};

function success<T>(data: T): RuntimeResponse<T> {
  return { ok: true, data };
}

function renderOptions(data: OptionsSnapshot = snapshot) {
  runtime.browser.runtime.sendMessage.mockResolvedValue(success(data));
  return render(<App />);
}

afterEach(() => {
  vi.resetAllMocks();
});

function mockDialogs() {
  dialogs.showModal.mockImplementation(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  dialogs.close.mockImplementation(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: dialogs.showModal,
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: dialogs.close,
  });
}

describe("options loading and warnings", () => {
  it("loads settings into the warnings view", async () => {
    renderOptions();

    expect(await screen.findByRole("heading", { name: "Warnings" })).toBeVisible();
    expect(screen.getByLabelText("Direct-site notice")).toHaveValue("overlay");
    expect(screen.getByLabelText("Content notice")).toHaveValue("banner");
    expect(runtime.browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "options/get" });
  });

  it("keeps warning changes as a draft until explicitly saved", async () => {
    const user = userEvent.setup();
    renderOptions();
    await screen.findByRole("heading", { name: "Warnings" });

    await user.selectOptions(screen.getByLabelText("Direct-site notice"), "banner");
    expect(runtime.browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Save warning settings" }));

    expect(runtime.browser.runtime.sendMessage).toHaveBeenLastCalledWith({
      type: "options/update-settings",
      settings: { directNoticeMode: "banner", contentNoticeMode: "banner" },
    });
  });

  it("keeps the warning draft after a failed save and allows retry", async () => {
    const user = userEvent.setup();
    runtime.browser.runtime.sendMessage
      .mockResolvedValueOnce(success(snapshot))
      .mockResolvedValueOnce({ ok: false, error: "Settings are unavailable" })
      .mockResolvedValueOnce(success({ directNoticeMode: "banner", contentNoticeMode: "banner" }));
    render(<App />);
    await screen.findByRole("heading", { name: "Warnings" });

    await user.selectOptions(screen.getByLabelText("Direct-site notice"), "banner");
    await user.click(screen.getByRole("button", { name: "Save warning settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Settings are unavailable");
    expect(screen.getByLabelText("Direct-site notice")).toHaveValue("banner");

    await user.click(screen.getByRole("button", { name: "Save warning settings" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("options views", () => {
  it("navigates between warnings, ignored sites, and activity", async () => {
    const user = userEvent.setup();
    renderOptions();
    await screen.findByRole("heading", { name: "Warnings" });

    await user.click(screen.getByRole("tab", { name: "Ignored sites" }));
    expect(await screen.findByRole("heading", { name: "Ignored sites" })).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Activity" }));
    expect(await screen.findByRole("heading", { name: "Activity" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: /IP ranges/i })).not.toBeInTheDocument();
  });

  it("uses roving keyboard tabs to move focus and activate the matching panel", async () => {
    const user = userEvent.setup();
    renderOptions();
    const warnings = await screen.findByRole("tab", { name: "Warnings" });
    warnings.focus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Ignored sites" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Ignored sites" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "activity-tab");
    await user.keyboard("{Home}");
    expect(warnings).toHaveFocus();
  });

  it("filters canonical ignored-rule labels and confirms removal", async () => {
    const user = userEvent.setup();
    runtime.browser.runtime.sendMessage
      .mockResolvedValueOnce(success(snapshot))
      .mockResolvedValueOnce(success([{ scope: "site", value: "example.org" }]));
    render(<App />);
    await screen.findByRole("heading", { name: "Warnings" });
    await user.click(screen.getByRole("tab", { name: "Ignored sites" }));

    await user.type(screen.getByLabelText("Search ignored sites"), "  CDN.EXAMPLE  ");
    expect(screen.getByText("cdn.example.com")).toBeVisible();
    expect(screen.queryByText("example.org")).not.toBeInTheDocument();
    expect(screen.getByText("Exact host")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove cdn.example.com" }));
    expect(screen.getByRole("dialog", { name: "Remove ignored site" })).toBeVisible();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove rule" }),
    );
    expect(runtime.browser.runtime.sendMessage).toHaveBeenLastCalledWith({
      type: "options/remove-ignore",
      rule: { scope: "host", value: "cdn.example.com" },
    });
    await waitFor(() => expect(screen.getByLabelText("Search ignored sites")).toHaveFocus());
  });

  it("uses native dialog lifecycle and restores the remove opener after cancel", async () => {
    mockDialogs();
    const user = userEvent.setup();
    renderOptions();
    await screen.findByRole("heading", { name: "Warnings" });
    await user.click(screen.getByRole("tab", { name: "Ignored sites" }));
    const opener = screen.getByRole("button", { name: "Remove cdn.example.com" });
    await user.click(opener);
    expect(dialogs.showModal).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-modal");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(dialogs.close).toHaveBeenCalledOnce();
    expect(opener).toHaveFocus();
  });

  it("handles a native cancel event like Escape and restores the remove opener", async () => {
    mockDialogs();
    const user = userEvent.setup();
    renderOptions();
    await screen.findByRole("heading", { name: "Warnings" });
    await user.click(screen.getByRole("tab", { name: "Ignored sites" }));
    const opener = screen.getByRole("button", { name: "Remove cdn.example.com" });
    await user.click(opener);
    screen
      .getByRole("dialog")
      .dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("sorts local activity by most recent observation and confirms clearing", async () => {
    const user = userEvent.setup();
    runtime.browser.runtime.sendMessage
      .mockResolvedValueOnce(success(snapshot))
      .mockResolvedValueOnce(success(undefined));
    render(<App />);
    await screen.findByRole("heading", { name: "Warnings" });
    await user.click(screen.getByRole("tab", { name: "Activity" }));

    const rows = await screen.findAllByRole("row");
    expect(rows[1]).toHaveTextContent("recent.example");
    expect(rows[2]).toHaveTextContent("older.example");
    expect(screen.getAllByText(/Last observed:/)).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Clear all activity" }));
    expect(screen.getByRole("dialog", { name: "Clear local activity" })).toBeVisible();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Clear activity" }),
    );
    expect(runtime.browser.runtime.sendMessage).toHaveBeenLastCalledWith({
      type: "options/clear-activity",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Activity" })).toHaveFocus();
  });

  it("explains empty shared rules and activity without exposing URL history", async () => {
    const user = userEvent.setup();
    renderOptions({ ...snapshot, ignoreRules: [], summaries: {} });
    await screen.findByRole("heading", { name: "Warnings" });
    await user.click(screen.getByRole("tab", { name: "Ignored sites" }));
    expect(await screen.findByText(/No sites are ignored/i)).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Activity" }));
    expect(await screen.findAllByText(/No detailed URL history is stored/i)).toHaveLength(2);
  });
});

describe("options recovery, accessibility, and visual contracts", () => {
  it("recovers Task 9 diagnostics with a confirmed reset and refreshed snapshot", async () => {
    mockDialogs();
    const user = userEvent.setup();
    const diagnosticSnapshot = {
      ...snapshot,
      diagnostics: [{ section: "settings", message: "Saved settings need recovery." }],
    };
    runtime.browser.runtime.sendMessage
      .mockResolvedValueOnce(success(diagnosticSnapshot))
      .mockResolvedValueOnce(success(undefined))
      .mockResolvedValueOnce(success({ ...snapshot, diagnostics: [] }));
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Saved settings need recovery.");
    await user.click(screen.getByRole("button", { name: "Reset this section" }));
    expect(screen.getByRole("dialog", { name: "Reset settings" })).toBeVisible();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Reset section" }),
    );
    expect(runtime.browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: "options/reset-section",
      section: "settings",
    });
    expect(runtime.browser.runtime.sendMessage).toHaveBeenLastCalledWith({ type: "options/get" });
    await waitFor(() => expect(screen.getByRole("tabpanel")).toHaveFocus());
    expect(screen.queryByRole("tab", { name: /IP ranges/i })).not.toBeInTheDocument();
  });

  it.each(["settings", "ignoreRules", "summaries"] as const)(
    "targets the %s diagnostic reset section",
    async (section) => {
      mockDialogs();
      const user = userEvent.setup();
      renderOptions({
        ...snapshot,
        diagnostics: [{ section, message: `${section} needs recovery.` }],
      });
      await user.click(await screen.findByRole("button", { name: "Reset this section" }));
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Reset section" }),
      );
      expect(runtime.browser.runtime.sendMessage).toHaveBeenCalledWith({
        type: "options/reset-section",
        section,
      });
    },
  );

  it("keeps an IP ranges diagnostic informational", async () => {
    renderOptions({
      ...snapshot,
      diagnostics: [{ section: "ipRanges", message: "Ranges need recovery." }],
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Ranges need recovery.");
    expect(screen.queryByRole("button", { name: "Reset this section" })).not.toBeInTheDocument();
  });

  it.each([
    ["warnings", snapshot],
    ["ignored empty", { ...snapshot, ignoreRules: [] }],
    ["activity empty", { ...snapshot, summaries: {} }],
  ] satisfies Array<[string, OptionsSnapshot]>)(
    "has no serious or critical axe violations for %s",
    async (_name, data) => {
      const { container } = renderOptions(data);
      await screen.findByRole("heading", { name: "Warnings" });

      const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
      expect(
        results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
      ).toEqual([]);
    },
  );

  it("has no serious or critical axe violations for an active activity tab and clear dialog", async () => {
    mockDialogs();
    const user = userEvent.setup();
    const { container } = renderOptions();
    await screen.findByRole("heading", { name: "Warnings" });
    await user.click(screen.getByRole("tab", { name: "Activity" }));
    await user.click(screen.getByRole("button", { name: "Clear all activity" }));

    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(
      results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
    ).toEqual([]);
  });

  it("uses an adaptive rail, native-control sizing, dark mode, and reduced motion", () => {
    const css = readFileSync(resolve(process.cwd(), "src/entrypoints/options/style.css"), "utf8");
    const baseCss = readFileSync(resolve(process.cwd(), "src/ui/base.css"), "utf8");
    const html = readFileSync(resolve(process.cwd(), "src/entrypoints/options/index.html"), "utf8");

    expect(css).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(css).toMatch(/@media \(min-width:\s*800px\)/);
    expect(css).toMatch(/@media \(max-width:\s*640px\)/);
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("repeating-linear-gradient");
    expect(baseCss).toContain("--cw-porcelain: oklch(0.985 0 0)");
    expect(html).toContain('<meta name="manifest.open_in_tab" content="true" />');
  });
});
