import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type InertElement = HTMLElement & { inert: boolean };

interface HiddenSiblingState {
  element: InertElement;
  inert: boolean;
  ariaHidden: string | null;
}

/**
 * Gives Electron renderer dialogs consistent keyboard behavior without another UI dependency.
 * It traps Tab/Shift+Tab, optionally closes on Escape, restores the previous focus target,
 * and makes siblings of the backdrop inert while the dialog is open.
 */
export function useModalFocusTrap(
  active: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  closeOnEscape = true,
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backdrop = dialog.parentElement;
    const hiddenSiblings: HiddenSiblingState[] = [];

    if (backdrop?.parentElement) {
      for (const sibling of Array.from(backdrop.parentElement.children)) {
        if (sibling === backdrop || !(sibling instanceof HTMLElement)) continue;
        const inertSibling = sibling as InertElement;
        hiddenSiblings.push({
          element: inertSibling,
          inert: inertSibling.inert,
          ariaHidden: inertSibling.getAttribute("aria-hidden"),
        });
        inertSibling.inert = true;
        inertSibling.setAttribute("aria-hidden", "true");
      }
    }

    const focusFirst = (): void => {
      const focusables = getFocusableElements(dialog);
      (focusables[0] ?? dialog).focus({ preventScroll: true });
    };
    const focusFrame = window.requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent): void => {
      const modalDialogs = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
      );
      const topmostDialog = modalDialogs.at(-1);
      if (topmostDialog && topmostDialog !== dialog) return;

      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = getFocusableElements(dialog);
      if (focusables.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const current = document.activeElement;
      if (!dialog.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
        return;
      }
      if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
      for (const state of hiddenSiblings) {
        state.element.inert = state.inert;
        if (state.ariaHidden === null) state.element.removeAttribute("aria-hidden");
        else state.element.setAttribute("aria-hidden", state.ariaHidden);
      }
      if (previouslyFocused?.isConnected) {
        window.requestAnimationFrame(() =>
          previouslyFocused.focus({ preventScroll: true }),
        );
      }
    };
  }, [active, closeOnEscape, dialogRef]);
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      (element.offsetParent !== null || element === document.activeElement),
  );
}
