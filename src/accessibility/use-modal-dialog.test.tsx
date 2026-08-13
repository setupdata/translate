import { useRef, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { useModalDialog } from "./use-modal-dialog";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const dialog = useModalDialog({
    open,
    initialFocusRef: cancel,
    returnFocusRef: trigger,
    onDismiss: () => setOpen(false),
  });

  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      {open ? (
        <section ref={dialog} role="dialog" aria-modal="true" aria-label="测试对话框">
          <button ref={cancel} type="button" onClick={() => setOpen(false)}>
            取消
          </button>
          <a href="#details">详情</a>
          <button type="button">确认</button>
        </section>
      ) : null}
    </>
  );
}

describe("useModalDialog", () => {
  it("keeps keyboard focus inside, closes on Escape, and restores the trigger", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const trigger = screen.getByRole("button", { name: "打开" });
    await user.click(trigger);
    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "确认" });

    await waitFor(() => expect(cancel).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-hidden", "true");
    expect(trigger.inert).toBe(true);
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute("aria-hidden");
    expect(trigger.inert).toBe(false);
    expect(trigger).toHaveFocus();
  });
});
