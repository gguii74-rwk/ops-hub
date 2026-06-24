// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Chip } from "@/components/ui/chip";

afterEach(cleanup);

describe("Chip", () => {
  it("renders children", () => {
    render(<Chip tone="ok">활성</Chip>);
    expect(screen.getByText("활성")).toBeTruthy();
  });
  it("applies tone class (ok → emerald)", () => {
    render(<Chip tone="ok">활성</Chip>);
    expect(screen.getByText("활성").className).toContain("emerald");
  });
  it("defaults to neutral tone when omitted", () => {
    render(<Chip>x</Chip>);
    expect(screen.getByText("x").className).toContain("muted");
  });
  it("merges extra className", () => {
    render(<Chip tone="blue" className="ml-2">b</Chip>);
    expect(screen.getByText("b").className).toContain("ml-2");
  });
});
