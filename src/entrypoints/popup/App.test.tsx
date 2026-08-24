import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PopupState, RuntimeResponse } from "../../core/messages";

const runtime = vi.hoisted(() => {
  const browser = {
    runtime: {
      openOptionsPage: vi.fn(),
      sendMessage: vi.fn(),
    },
    tabs: { query: vi.fn() },
  };

  return { browser };
});

vi.mock("wxt/browser", () => ({ browser: runtime.browser }));
vi.mock("#imports", () => ({ browser: runtime.browser }));

import { App } from "./App";

const directState: PopupState = {
  status: "direct",
  ignored: false,
  hostname: "shop.example.com",
  evidence: [
    { kind: "header", signal: "cf-ray" },
    { kind: "header", signal: "server: cloudflare" },
    { kind: "ip", ip: "203.0.113.7", cidr: "203.0.113.0/24" },
  ],
  summary: {
    directNavigations: 8,
    contentNavigations: 3,
    lastSeenAt: "2026-08-24T12:00:00.000Z",
  },
};

const contentState: PopupState = {
  status: "content",
  ignored: false,
  hostname: "news.example.com",
  contentHost: "cdn.example.net",
  evidence: [{ kind: "header", signal: "cf-cache-status" }],
  summary: {
    directNavigations: 0,
    contentNavigations: 4,
    lastSeenAt: "2026-08-24T12:00:00.000Z",
  },
};

const noneState: PopupState = {
  status: "none",
  ignored: false,
  hostname: "example.com",
  evidence: [],
};

const unavailableState: PopupState = {
  status: "unavailable",
  ignored: false,
  evidence: [],
};

function success(data: PopupState): RuntimeResponse<PopupState> {
  return { ok: true, data };
}

function deferred<T>() {
  let reject: (reason?: unknown) => void = () => undefined;
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

function renderPopup(response: RuntimeResponse<PopupState> | Promise<RuntimeResponse<PopupState>>) {
  runtime.browser.tabs.query.mockResolvedValue([{ id: 42 }]);
  runtime.browser.runtime.sendMessage.mockReturnValue(response);
  return render(<App />);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("popup state loading", () => {
  it("shows a loading status before the active-tab response arrives", () => {
    let resolveResponse: (response: RuntimeResponse<PopupState>) => void = () => undefined;
    const response = new Promise<RuntimeResponse<PopupState>>((resolve) => {
      resolveResponse = resolve;
    });
    renderPopup(response);

    expect(screen.getByRole("status")).toHaveTextContent("Checking this tab");
    resolveResponse(success(directState));
  });

  it("renders direct evidence, host, and stored visit counts", async () => {
    renderPopup(success(directState));

    expect(await screen.findByRole("heading", { name: "Site uses Cloudflare" })).toBeVisible();
    expect(screen.getByText("shop.example.com")).toBeVisible();
    expect(screen.getByText("CF-Ray header")).toBeVisible();
    expect(screen.getByText("Cloudflare server header")).toBeVisible();
    expect(screen.getByText("Cloudflare IP range")).toBeVisible();
    expect(screen.getByText("Direct visits")).toBeVisible();
    expect(screen.getByText("8")).toBeVisible();
    expect(screen.getByText("Content visits")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect(runtime.browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: "popup/get",
      tabId: 42,
    });
  });

  it("renders the content host, fixed evidence label, and content counts", async () => {
    renderPopup(success(contentState));

    expect(
      await screen.findByRole("heading", { name: "Cloudflare content observed" }),
    ).toBeVisible();
    expect(screen.getByText("news.example.com")).toBeVisible();
    expect(screen.getByText("Observed content")).toBeVisible();
    expect(screen.getByText("cdn.example.net")).toBeVisible();
    expect(screen.getByText("CF-Cache-Status header")).toBeVisible();
    expect(screen.getByText("0")).toBeVisible();
    expect(screen.getByText("4")).toBeVisible();
  });

  it("uses bounded no-observation copy and zero counts when no summary exists", async () => {
    renderPopup(success(noneState));

    expect(await screen.findByRole("heading", { name: "No Cloudflare observed" })).toBeVisible();
    expect(screen.queryByText(/does not use Cloudflare/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(2);
  });

  it("keeps ignored status separate from the observed direct result", async () => {
    renderPopup(success({ ...directState, ignored: true }));

    expect(await screen.findByText("Ignored for this site")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Site uses Cloudflare" })).toBeVisible();
  });

  it("renders unavailable tabs without site details", async () => {
    renderPopup(success(unavailableState));

    expect(await screen.findByRole("heading", { name: "Detection unavailable" })).toBeVisible();
    expect(screen.queryByText("Site")).not.toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(2);
  });

  it("keeps request failures local and lets the user retry", async () => {
    const user = userEvent.setup();
    runtime.browser.tabs.query.mockResolvedValue([{ id: 42 }]);
    runtime.browser.runtime.sendMessage
      .mockResolvedValueOnce({ ok: false, error: "Background unavailable" })
      .mockResolvedValueOnce(success(directState));
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cloudwatcher could not inspect this tab. Try again.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Site uses Cloudflare" })).toBeVisible();
  });
});

describe("popup interaction and accessibility", () => {
  it("announces settings opening, recovers from an error, and restores the default after retry", async () => {
    const user = userEvent.setup();
    const firstOpen = deferred<void>();
    const retryOpen = deferred<void>();
    runtime.browser.runtime.openOptionsPage
      .mockReturnValueOnce(firstOpen.promise)
      .mockReturnValueOnce(retryOpen.promise);
    renderPopup(success(directState));

    const settings = await screen.findByRole("button", { name: "Open Cloudwatcher settings" });
    settings.focus();
    await user.keyboard("{Enter}");
    expect(runtime.browser.runtime.openOptionsPage).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Opening settings…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Opening settings…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    firstOpen.reject(new Error("Options unavailable"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cloudwatcher could not open settings.",
    );
    expect(screen.getByRole("button", { name: "Try opening settings again" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Try opening settings again" }));
    expect(screen.getByRole("button", { name: "Opening settings…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Opening settings…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    retryOpen.resolve();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open Cloudwatcher settings" })).toBeEnabled(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Site uses Cloudflare" })).toBeVisible();
  });

  it.each([
    ["direct", directState],
    ["content", contentState],
    ["none", noneState],
    ["unavailable", unavailableState],
  ] as const)("has no serious or critical axe violations for %s", async (_name, state) => {
    const { container } = renderPopup(success(state));
    await screen.findByRole("button", { name: "Open Cloudwatcher settings" });

    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(
      results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
    ).toEqual([]);
  });
});

describe("popup stylesheet contract", () => {
  it("uses a constrained, zoom-safe OKLCH panel with touch targets and reduced motion", () => {
    const css = readFileSync(resolve(process.cwd(), "src/entrypoints/popup/style.css"), "utf8");
    const baseCss = readFileSync(resolve(process.cwd(), "src/ui/base.css"), "utf8");

    expect(`${baseCss}\n${css}`).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(baseCss).toContain("oklch(0.489 0.19 28.3)");
    expect(css).toMatch(/max-width:\s*360px/);
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(baseCss).toMatch(/:focus-visible\s*{[^}]*outline:/s);
  });
});
