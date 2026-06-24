// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "@/components/ui/modal";

afterEach(() => {
  cleanup();
});

describe("Modal", () => {
  it("Escape keydown calls onClose once", () => {
    const onClose = vi.fn();
    render(<Modal title="Test Modal" onClose={onClose}><p>body</p></Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("overlay click calls onClose; Card inner click does not", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Test Modal" onClose={onClose}>
        <button type="button">inside</button>
      </Modal>
    );
    // Card inner click — stopPropagation prevents onClose
    const dialog = screen.getByRole("dialog", { name: "Test Modal" });
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    // Overlay click — the fixed backdrop div (parent of dialog)
    const overlay = dialog.parentElement!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("body scroll-lock: overflow=hidden while rendered, restored after unmount", () => {
    document.body.style.overflow = "";
    const onClose = vi.fn();
    const { unmount } = render(
      <Modal title="Scroll Lock" onClose={onClose}><p>body</p></Modal>
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("body scroll-lock: prior overflow value restored on unmount", () => {
    document.body.style.overflow = "scroll";
    const onClose = vi.fn();
    const { unmount } = render(
      <Modal title="Scroll Lock Prior" onClose={onClose}><p>body</p></Modal>
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("scroll");
    document.body.style.overflow = "";
  });

  it("on open, activeElement is the role=dialog element with accessible name = title", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Focus Test" onClose={onClose}><p>body</p></Modal>
    );
    const dialog = screen.getByRole("dialog", { name: "Focus Test" });
    expect(document.activeElement).toBe(dialog);
  });

  it("Tab trap: Tab from last focusable wraps to first", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Trap Test" onClose={onClose}>
        <button type="button">first</button>
        <button type="button">second</button>
        <button type="button">last</button>
      </Modal>
    );
    const dialog = screen.getByRole("dialog", { name: "Trap Test" });
    const buttons = dialog.querySelectorAll<HTMLElement>("button");
    // last button in the Card (close ✕ + 3 inner): focusable nodes are [closebtn, first, second, last]
    // but close button is the first focusable in the Card; our "last" button is last
    // Focus the last focusable element and press Tab
    const allFocusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )
    );
    const lastFocusable = allFocusable[allFocusable.length - 1];
    lastFocusable.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(allFocusable[0]);
  });

  it("Shift+Tab trap: Shift+Tab from first focusable wraps to last", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Trap Shift Test" onClose={onClose}>
        <button type="button">first</button>
        <button type="button">last</button>
      </Modal>
    );
    const dialog = screen.getByRole("dialog", { name: "Trap Shift Test" });
    const allFocusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )
    );
    const firstFocusable = allFocusable[0];
    firstFocusable.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(allFocusable[allFocusable.length - 1]);
  });

  it("focus is restored to previous element after unmount", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "open";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const onClose = vi.fn();
    const { unmount } = render(
      <Modal title="Restore Focus" onClose={onClose}><p>body</p></Modal>
    );
    // focus is now on the dialog
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });
});
