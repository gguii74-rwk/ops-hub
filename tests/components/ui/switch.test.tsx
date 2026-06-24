// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Switch } from "@/components/ui/switch";

afterEach(cleanup);

describe("Switch", () => {
  it("exposes role=switch with aria-checked reflecting checked", () => {
    render(<Switch checked onCheckedChange={() => {}} label="활성" />);
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.getAttribute("aria-label")).toBe("활성");
  });
  it("calls onCheckedChange with negated value on click", () => {
    const fn = vi.fn();
    render(<Switch checked={false} onCheckedChange={fn} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(fn).toHaveBeenCalledWith(true);
  });
  it("does not fire when disabled", () => {
    const fn = vi.fn();
    render(<Switch checked onCheckedChange={fn} disabled />);
    fireEvent.click(screen.getByRole("switch"));
    expect(fn).not.toHaveBeenCalled();
  });
});
