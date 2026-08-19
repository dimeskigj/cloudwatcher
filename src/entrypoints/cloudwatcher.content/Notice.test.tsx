import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoticeState } from "../../core/model";
import { Notice, type NoticeAction } from "./Notice";

const noticeCss = readFileSync(
  resolve(process.cwd(), "src/entrypoints/cloudwatcher.content/notice.css"),
  "utf8",
);

const directNotice: NoticeState = {
  navigationId: "nav-1",
  kind: "direct",
  mode: "overlay",
  siteHost: "shop.example.com",
  evidence: [
    { kind: "header", signal: "cf-ray" },
    { kind: "ip", ip: "203.0.113.7", cidr: "203.0.113.0/24" },
  ],
  ignoreChoices: [
    {
      label: "shop.example.com only",
      rule: { scope: "host", value: "shop.example.com" },
    },
    {
      label: "example.com and all subdomains",
      rule: { scope: "site", value: "example.com" },
    },
  ],
};

const contentNotice: NoticeState = {
  navigationId: "nav-1",
  kind: "content",
  mode: "banner",
  siteHost: "news.example.com",
  resourceHost: "cdn.example.net",
  evidence: [{ kind: "header", signal: "cf-cache-status" }],
  ignoreChoices: [
    {
      label: "news.example.com only",
      rule: { scope: "host", value: "news.example.com" },
    },
    {
      label: "example.com and all subdomains",
      rule: { scope: "site", value: "example.com" },
    },
  ],
};

const directBannerNotice: NoticeState = {
  ...directNotice,
  mode: "banner",
};

function resolvedAction() {
  return vi.fn<(action: NoticeAction) => Promise<void>>().mockResolvedValue(undefined);
}

function addPageButton(name = "Page control"): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = name;
  document.body.append(button);
  button.focus();
  return button;
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Notice content and semantics", () => {
  it("renders calm direct copy, host metadata, evidence, and modal semantics without a URL", async () => {
    const notice = {
      ...directNotice,
      sourceUrl: "https://shop.example.com/private/path?token=secret",
    } as NoticeState & { sourceUrl: string };
    const { container } = render(<Notice notice={notice} onAction={resolvedAction()} />);

    const dialog = screen.getByRole("dialog", { name: "Cloudflare detected for this site" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Cloudwatcher observed a Cloudflare signal while this site loaded.",
    );
    expect(dialog).toHaveTextContent("Site shop.example.com");
    expect(dialog).toHaveTextContent("CF-Ray header");
    expect(dialog).toHaveTextContent("Cloudflare IP range");
    expect(container).not.toHaveTextContent("https://");
    expect(container).not.toHaveTextContent("private/path");
  });

  it("renders calm content copy, only host metadata, and non-modal banner semantics", () => {
    const pageButton = addPageButton();

    render(<Notice notice={contentNotice} onAction={resolvedAction()} />);

    const banner = screen.getByRole("region", {
      name: "This page loads content through Cloudflare",
    });
    expect(banner).not.toHaveAttribute("aria-modal");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const status = within(banner).getByRole("status");
    expect(status).toHaveTextContent("This page loads content through Cloudflare");
    expect(status).toHaveTextContent(
      "Cloudwatcher observed a Cloudflare signal in content loaded by this page.",
    );
    expect(within(status).queryByRole("button")).not.toBeInTheDocument();
    expect(banner).toHaveTextContent(
      "Cloudwatcher observed a Cloudflare signal in content loaded by this page.",
    );
    expect(banner).toHaveTextContent("Site news.example.com");
    expect(banner).toHaveTextContent("Observed host cdn.example.net");
    expect(banner).toHaveTextContent("CF-Cache-Status header");
    expect(banner).not.toHaveTextContent("https://");
    expect(document.activeElement).toBe(pageButton);
  });

  it("uses direct copy and status semantics in a non-modal direct banner without autofocus", () => {
    const pageButton = addPageButton();

    render(<Notice notice={directBannerNotice} onAction={resolvedAction()} />);

    const banner = screen.getByRole("region", { name: "Cloudflare detected for this site" });
    expect(banner).not.toHaveAttribute("aria-modal");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(banner).getByRole("status")).toHaveTextContent(
      "Cloudwatcher observed a Cloudflare signal while this site loaded.",
    );
    expect(within(banner).queryByText("Observed host")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(pageButton);
  });

  it.each([
    ["direct overlay", directNotice],
    ["direct banner", directBannerNotice],
    ["content banner", contentNotice],
  ] as const)("has no serious or critical axe violations for the %s", async (_mode, notice) => {
    const { container } = render(<Notice notice={notice} onAction={resolvedAction()} />);

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    const severe = results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    );

    expect(severe).toEqual([]);
  });
});

describe("Notice actions", () => {
  it("sends Continue once and Go back actions", async () => {
    const user = userEvent.setup();
    const onAction = resolvedAction();
    render(<Notice notice={directNotice} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Continue once" }));
    await user.click(screen.getByRole("button", { name: "Go back" }));

    expect(onAction).toHaveBeenNthCalledWith(1, { type: "continue" });
    expect(onAction).toHaveBeenNthCalledWith(2, { type: "leave" });
  });

  it.each(directNotice.ignoreChoices)(
    "sends the supplied ignore choice: $label",
    async (choice) => {
      const user = userEvent.setup();
      const onAction = resolvedAction();
      render(<Notice notice={directNotice} onAction={onAction} />);

      expect(screen.queryByRole("button", { name: choice.label })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Don't warn here again" }));
      await user.click(screen.getByRole("button", { name: choice.label }));

      expect(onAction).toHaveBeenCalledWith({ type: "ignore", rule: choice.rule });
    },
  );

  it("uses inline disclosure, lets Cancel close it, and offers only the exact localhost choice", async () => {
    const user = userEvent.setup();
    const localhostNotice: NoticeState = {
      ...directNotice,
      siteHost: "localhost",
      ignoreChoices: [{ label: "localhost only", rule: { scope: "host", value: "localhost" } }],
    };
    render(<Notice notice={localhostNotice} onAction={resolvedAction()} />);

    await user.click(screen.getByRole("button", { name: "Don't warn here again" }));

    const chooser = screen.getByRole("group", { name: "Stop future notices for" });
    expect(within(chooser).getByRole("button", { name: "localhost only" })).toBeVisible();
    expect(within(chooser).queryByText(/all subdomains/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBe(screen.getByRole("dialog"));

    await user.click(within(chooser).getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("group", { name: "Stop future notices for" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Don't warn here again" })).toHaveFocus(),
    );
  });

  it("disables every action while pending and reports a failed response without closing", async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const onAction = vi.fn<(action: NoticeAction) => Promise<void>>(() => pending.promise);
    render(<Notice notice={directNotice} onAction={onAction} />);
    await user.click(screen.getByRole("button", { name: "Don't warn here again" }));

    await user.click(screen.getByRole("button", { name: "example.com and all subdomains" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-busy", "true");
    for (const button of within(dialog).getAllByRole("button")) {
      expect(button).toBeDisabled();
    }

    pending.reject(new Error("storage unavailable"));

    expect(
      await screen.findByRole("alert", {
        name: "Cloudwatcher could not save that choice. Try again.",
      }),
    ).toBeVisible();
    expect(dialog).toHaveAttribute("aria-busy", "false");
    for (const button of within(dialog).getAllByRole("button")) {
      expect(button).toBeEnabled();
    }
  });
});

describe("Notice keyboard behavior", () => {
  it("autofocuses Continue once, contains focus, redirects escaped focus, and maps Escape", async () => {
    const user = userEvent.setup();
    const pageButton = addPageButton();
    const onAction = resolvedAction();
    render(<Notice notice={directNotice} onAction={onAction} />);
    const continueButton = screen.getByRole("button", { name: "Continue once" });
    const ignoreButton = screen.getByRole("button", { name: "Don't warn here again" });

    await waitFor(() => expect(continueButton).toHaveFocus());
    await user.tab({ shift: true });
    expect(ignoreButton).toHaveFocus();
    await user.tab();
    expect(continueButton).toHaveFocus();

    pageButton.focus();
    expect(continueButton).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onAction).toHaveBeenCalledWith({ type: "continue" });
  });

  it.each([
    ["direct", directBannerNotice],
    ["content", contentNotice],
  ] as const)(
    "does not autofocus or capture page Escape for a %s banner, but handles focused Escape",
    async (_kind, notice) => {
      const user = userEvent.setup();
      const pageButton = addPageButton();
      const onAction = resolvedAction();
      render(<Notice notice={notice} onAction={onAction} />);

      expect(pageButton).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(onAction).not.toHaveBeenCalled();

      screen.getByRole("button", { name: "Go back" }).focus();
      await user.keyboard("{Escape}");
      expect(onAction).toHaveBeenCalledOnce();
      expect(onAction).toHaveBeenCalledWith({ type: "continue" });
    },
  );

  it("distinguishes internal focus from escaped focus inside a closed shadow root", async () => {
    const pageButton = addPageButton();
    const host = document.createElement("cloudwatcher-notice");
    document.body.append(host);
    const root = host.attachShadow({ mode: "closed" });
    const mount = document.createElement("div");
    root.append(mount);
    render(<Notice notice={directNotice} onAction={resolvedAction()} />, { container: mount });
    const controls = within(mount);
    const continueButton = controls.getByRole("button", { name: "Continue once" });
    const goBackButton = controls.getByRole("button", { name: "Go back" });

    await waitFor(() => expect(root.activeElement).toBe(continueButton));
    goBackButton.focus();
    expect(root.activeElement).toBe(goBackButton);

    pageButton.focus();
    expect(root.activeElement).toBe(continueButton);
  });

  it("traps Tab boundaries using the active element of a closed shadow root", async () => {
    const host = document.createElement("cloudwatcher-notice");
    document.body.append(host);
    const root = host.attachShadow({ mode: "closed" });
    const mount = document.createElement("div");
    root.append(mount);
    render(<Notice notice={directNotice} onAction={resolvedAction()} />, { container: mount });
    const controls = within(mount);
    const continueButton = controls.getByRole("button", { name: "Continue once" });
    const ignoreButton = controls.getByRole("button", { name: "Don't warn here again" });

    await waitFor(() => expect(root.activeElement).toBe(continueButton));
    fireEvent.keyDown(continueButton, { key: "Tab", shiftKey: true });
    expect(root.activeElement).toBe(ignoreButton);

    fireEvent.keyDown(ignoreButton, { key: "Tab" });
    expect(root.activeElement).toBe(continueButton);
  });

  it("handles overlay Escape even though a page capture listener observes the key", async () => {
    const user = userEvent.setup();
    const pageCapture = vi.fn();
    const onAction = resolvedAction();
    document.addEventListener("keydown", pageCapture, true);

    try {
      render(<Notice notice={directNotice} onAction={onAction} />);
      const continueButton = screen.getByRole("button", { name: "Continue once" });
      await waitFor(() => expect(continueButton).toHaveFocus());

      await user.keyboard("{Escape}");

      expect(pageCapture).toHaveBeenCalled();
      expect(onAction).toHaveBeenCalledWith({ type: "continue" });
    } finally {
      document.removeEventListener("keydown", pageCapture, true);
    }
  });

  it("preserves native Enter and Space activation inside the overlay", async () => {
    const user = userEvent.setup();
    const onAction = resolvedAction();
    render(<Notice notice={directNotice} onAction={onAction} />);
    const continueButton = screen.getByRole("button", { name: "Continue once" });
    const goBackButton = screen.getByRole("button", { name: "Go back" });

    await waitFor(() => expect(continueButton).toHaveFocus());
    await user.keyboard("{Enter}");
    goBackButton.focus();
    await user.keyboard("[Space]");

    expect(onAction).toHaveBeenNthCalledWith(1, { type: "continue" });
    expect(onAction).toHaveBeenNthCalledWith(2, { type: "leave" });
  });
});

describe("notice stylesheet contract", () => {
  it("isolates a full-viewport top layer with fixed pixel sizing and an OKLCH palette", () => {
    const hostRule = noticeCss.match(/:host\s*{[^}]*}/s)?.[0];
    expect(hostRule).toMatch(/position:\s*fixed[^}]*inset:\s*0[^}]*z-index:\s*2147483647/s);
    expect(hostRule).not.toContain("--cw-surface");
    expect(noticeCss).toMatch(/\.notice\s*{[^}]*--cw-surface:\s*oklch\(1 0 0\)/s);
    expect(noticeCss).not.toMatch(/\d(?:\.\d+)?(?:rem|em)\b/);
    expect(noticeCss).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(noticeCss).toMatch(/oklch\(0\.489 0\.19(?:0)? 28\.3\)/);
    expect(noticeCss).toMatch(/--cw-focus:\s*oklch\(0\.489 0\.19(?:0)? 28\.3\)/);
    expect(noticeCss).toMatch(
      /@media \(prefers-color-scheme: dark\)[\s\S]*--cw-focus:\s*oklch\(0\.56 0\.18 28\.3\)/,
    );
    expect(noticeCss).toMatch(/:focus-visible\s*{[^}]*outline:\s*2px\s+solid\s+var\(--cw-focus\)/s);
    expect(noticeCss).toMatch(/--cw-control-border:\s*oklch\(0\.62 0 0\)/);
    expect(noticeCss).toMatch(
      /@media \(prefers-color-scheme: dark\)[\s\S]*--cw-control-border:\s*oklch\(0\.52 0 0\)/,
    );
    expect(noticeCss).toMatch(
      /\.notice__button\s*{[^}]*min-height:\s*44px[^}]*border:\s*1px\s+solid\s+var\(--cw-control-border\)/s,
    );
    expect(noticeCss).toMatch(
      /\.notice__button--quiet\s*{[^}]*border-color:\s*var\(--cw-control-border\)/s,
    );
    expect(noticeCss).toMatch(
      /\.notice__button--primary\s*{[^}]*border-color:\s*var\(--cw-focus\)/s,
    );
    expect(noticeCss).toMatch(
      /\.notice__button:not\(:disabled\):active\s*{[^}]*border-color:\s*var\(--cw-muted\)/s,
    );
    expect(noticeCss).toMatch(
      /\.notice__button--primary:not\(:disabled\):(?:hover|active)\s*{[^}]*border-color:\s*var\(--cw-focus\)/s,
    );
  });

  it("keeps banner hit testing local and defines narrow, dark, and reduced-motion behavior", () => {
    expect(noticeCss).toMatch(/\.notice--banner\s*{[^}]*pointer-events:\s*none/s);
    expect(noticeCss).toMatch(/\.notice--banner\s+\.notice__panel\s*{[^}]*pointer-events:\s*auto/s);
    expect(noticeCss).toContain("@media (max-width: 640px)");
    expect(noticeCss).toContain("@media (prefers-color-scheme: dark)");
    expect(noticeCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(noticeCss).toMatch(/\.notice--overlay\s*{[^}]*overscroll-behavior:\s*none/s);
    expect(noticeCss).toMatch(
      /\.notice--overlay\s+\.notice__panel\s*{[^}]*overscroll-behavior:\s*none/s,
    );
  });
});
