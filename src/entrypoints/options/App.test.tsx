import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeResponse } from "../../core/messages";
import type { OptionsSnapshot } from "../../core/model";

const runtime = vi.hoisted(() => ({ browser: { runtime: { sendMessage: vi.fn() } } }));

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

  it("filters canonical ignored-rule labels and confirms removal", async () => {
    const user = userEvent.setup();
    runtime.browser.runtime.sendMessage
      .mockResolvedValueOnce(success(snapshot))
      .mockResolvedValueOnce(success([{ scope: "site", value: "example.org" }]));
    render(<App />);
    await screen.findByRole("heading", { name: "Warnings" });
    await user.click(screen.getByRole("tab", { name: "Ignored sites" }));

    await user.type(screen.getByLabelText("Search ignored sites"), "cdn.example");
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
  it("shows storage diagnostics without offering the Task 10 range editor", async () => {
    renderOptions({
      ...snapshot,
      diagnostics: [{ section: "ipRanges", message: "Saved IP ranges need recovery." }],
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Saved IP ranges need recovery.");
    expect(screen.queryByText(/Reset this section/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /IP ranges/i })).not.toBeInTheDocument();
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

  it("uses an adaptive rail, native-control sizing, dark mode, and reduced motion", () => {
    const css = readFileSync(resolve(process.cwd(), "src/entrypoints/options/style.css"), "utf8");
    const html = readFileSync(resolve(process.cwd(), "src/entrypoints/options/index.html"), "utf8");

    expect(css).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(css).toMatch(/@media \(min-width:\s*800px\)/);
    expect(css).toMatch(/@media \(max-width:\s*640px\)/);
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(html).toContain('<meta name="manifest.open_in_tab" content="true" />');
  });
});
