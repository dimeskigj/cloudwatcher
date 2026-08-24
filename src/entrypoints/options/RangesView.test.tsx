import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CidrError } from "../../core/cidr";
import { DEFAULT_CIDRS } from "../../core/default-ranges";
import { RangesView } from "./RangesView";

const dialogs = vi.hoisted(() => ({ close: vi.fn(), showModal: vi.fn() }));

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

function selectFile(input: HTMLElement, file: File): void {
  fireEvent.change(input, { target: { files: [file] } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("RangesView", () => {
  it("starts with the saved CIDRs as an untouched draft", () => {
    render(<RangesView ranges={["203.0.113.0/24"]} onDirtyChange={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByLabelText("CIDR ranges")).toHaveValue("203.0.113.0/24");
    expect(screen.getByRole("button", { name: "Save IP ranges" })).toBeDisabled();
  });

  it("shows authoritative line errors and does not replace the draft", async () => {
    const user = userEvent.setup();
    const errors: CidrError[] = [{ line: 2, input: "not-a-cidr", message: "Invalid CIDR" }];
    const onSave = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("Invalid ranges"), { validationErrors: errors }));
    render(<RangesView ranges={["203.0.113.0/24"]} onDirtyChange={vi.fn()} onSave={onSave} />);

    const draft = screen.getByLabelText("CIDR ranges");
    await user.type(draft, "\nnot-a-cidr");
    await user.click(screen.getByRole("button", { name: "Save IP ranges" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Line 2: not-a-cidr. Invalid CIDR");
    expect(draft).toHaveAttribute("aria-describedby", "range-errors");
    expect(draft).toHaveValue("203.0.113.0/24\nnot-a-cidr");
    expect(onSave).toHaveBeenCalledWith("203.0.113.0/24\nnot-a-cidr");
  });

  it("replaces the draft with canonical saved ranges", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(["203.0.113.0/24"]);
    render(<RangesView ranges={[]} onDirtyChange={vi.fn()} onSave={onSave} />);

    await user.type(screen.getByLabelText("CIDR ranges"), "203.0.113.9/24");
    await user.click(screen.getByRole("button", { name: "Save IP ranges" }));

    await waitFor(() => expect(screen.getByLabelText("CIDR ranges")).toHaveValue("203.0.113.0/24"));
    expect(screen.getByRole("button", { name: "Save IP ranges" })).toBeDisabled();
  });

  it("explains intentional empty saved ranges as header-only detection", async () => {
    const user = userEvent.setup();
    render(
      <RangesView
        ranges={["203.0.113.0/24"]}
        onDirtyChange={vi.fn()}
        onSave={vi.fn().mockResolvedValue([])}
      />,
    );

    await user.clear(screen.getByLabelText("CIDR ranges"));
    await user.click(screen.getByRole("button", { name: "Save IP ranges" }));

    expect(await screen.findByText("Header-only detection is active.")).toBeVisible();
  });

  it("imports valid text into only the draft", async () => {
    const onSave = vi.fn();
    render(<RangesView ranges={["203.0.113.0/24"]} onDirtyChange={vi.fn()} onSave={onSave} />);
    const input = screen.getByLabelText("Import IP ranges");
    const file = new File(["198.51.100.0/24"], "ranges.txt", { type: "text/plain" });
    vi.spyOn(file, "text").mockResolvedValue("198.51.100.0/24");

    selectFile(input, file);

    await waitFor(() =>
      expect(screen.getByLabelText("CIDR ranges")).toHaveValue("198.51.100.0/24"),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("reports import type and read failures without replacing the draft", async () => {
    render(<RangesView ranges={["203.0.113.0/24"]} onDirtyChange={vi.fn()} onSave={vi.fn()} />);
    const input = screen.getByLabelText("Import IP ranges");

    selectFile(input, new File(["bad"], "ranges.csv", { type: "text/csv" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a plain-text .txt file.");
    expect(screen.getByLabelText("CIDR ranges")).toHaveValue("203.0.113.0/24");

    const unreadable = new File([""], "ranges.txt", { type: "text/plain" });
    vi.spyOn(unreadable, "text").mockRejectedValue(new Error("Read failed"));
    selectFile(input, unreadable);
    expect(await screen.findByRole("alert")).toHaveTextContent("Read failed");
    expect(screen.getByLabelText("CIDR ranges")).toHaveValue("203.0.113.0/24");
  });

  it("exports the last saved ranges as a revoked UTF-8 object URL", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:ranges");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(<RangesView ranges={["203.0.113.0/24"]} onDirtyChange={vi.fn()} onSave={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Export IP ranges" }));

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    if (blob === undefined) throw new Error("Expected export to create a Blob");
    expect(await blob.text()).toBe("203.0.113.0/24\n");
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:ranges");
  });

  it("copies bundled defaults into the draft after confirmation without saving", async () => {
    mockDialogs();
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<RangesView ranges={["203.0.113.0/24"]} onDirtyChange={vi.fn()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Reset draft to defaults" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Reset IP ranges draft" })).getByRole("button", {
        name: "Reset draft",
      }),
    );

    expect(screen.getByLabelText("CIDR ranges")).toHaveValue(DEFAULT_CIDRS.join("\n"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("warns before leaving a dirty draft", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<RangesView ranges={[]} onDirtyChange={vi.fn()} onSave={onSave} />);

    await user.type(screen.getByLabelText("CIDR ranges"), "203.0.113.0/24");
    await user.click(screen.getByRole("button", { name: "Discard range changes" }));

    expect(screen.getByRole("dialog", { name: "Discard IP range changes" })).toBeVisible();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Discard changes" }),
    );
    expect(screen.getByLabelText("CIDR ranges")).toHaveValue("");
    expect(onSave).not.toHaveBeenCalled();
  });
});
