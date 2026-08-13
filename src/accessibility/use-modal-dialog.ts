import { useEffect, useRef } from "react";
import type { RefObject } from "react";

type ModalDialogOptions = {
  open: boolean;
  initialFocusRef: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onDismiss?: () => void;
  dismissDisabled?: boolean;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getAttribute("aria-hidden") !== "true",
  );
}

type BackgroundElementState = {
  element: HTMLElement;
  ariaHidden: string | null;
  inert: boolean;
};

function isolateDialog(dialog: HTMLElement): BackgroundElementState[] {
  const states: BackgroundElementState[] = [];
  let branch: HTMLElement = dialog;
  while (branch.parentElement) {
    const parent = branch.parentElement;
    for (const sibling of parent.children) {
      if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
      states.push({
        element: sibling,
        ariaHidden: sibling.getAttribute("aria-hidden"),
        inert: Boolean(sibling.inert),
      });
      sibling.setAttribute("aria-hidden", "true");
      sibling.inert = true;
    }
    if (parent === document.body) break;
    branch = parent;
  }
  return states;
}

export function useModalDialog({
  open,
  initialFocusRef,
  returnFocusRef,
  onDismiss,
  dismissDisabled = false,
}: ModalDialogOptions): RefObject<HTMLElement | null> {
  const dialogRef = useRef<HTMLElement>(null);
  const dismissRef = useRef(onDismiss);
  const dismissDisabledRef = useRef(dismissDisabled);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  dismissRef.current = onDismiss;
  dismissDisabledRef.current = dismissDisabled;

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backgroundStates = dialogRef.current ? isolateDialog(dialogRef.current) : [];
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const initialFocus =
      initialFocusRef.current ??
      (dialogRef.current ? focusableElements(dialogRef.current)[0] : undefined) ??
      dialogRef.current;
    initialFocus?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !dismissDisabledRef.current && dismissRef.current) {
        event.preventDefault();
        event.stopPropagation();
        dismissRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      for (const state of backgroundStates) {
        state.element.inert = state.inert;
        if (state.ariaHidden === null) {
          state.element.removeAttribute("aria-hidden");
        } else {
          state.element.setAttribute("aria-hidden", state.ariaHidden);
        }
      }
      const returnFocus = returnFocusRef?.current ?? previousFocusRef.current;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [initialFocusRef, open, returnFocusRef]);

  return dialogRef;
}
