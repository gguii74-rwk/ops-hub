// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PageHeader } from "@/components/ui/page-section";

afterEach(cleanup);

describe("PageHeader eyebrow", () => {
  it("renders eyebrow above title when provided", () => {
    render(<PageHeader eyebrow="구성원" title="사용자 관리" />);
    expect(screen.getByText("구성원")).toBeTruthy();
    expect(screen.getByText("사용자 관리")).toBeTruthy();
  });
  it("omits eyebrow node when not provided", () => {
    const { container } = render(<PageHeader title="제목" />);
    expect(container.querySelector("[data-slot=eyebrow]")).toBeNull();
  });
});
