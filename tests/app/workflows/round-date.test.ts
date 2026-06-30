import { describe, it, expect } from "vitest";
import { dateInputToSubmitDateIso, submitDateIsoToDateInput } from "@/app/(app)/workflows/billing/settings/round-date";

describe("dateInputToSubmitDateIso (D11)", () => {
  it("KST 자정 → UTC 전일 15:00Z", () => {
    expect(dateInputToSubmitDateIso("2026-02-10")).toBe("2026-02-09T15:00:00.000Z");
  });
  it("연 경계: 2026-01-01 → 2025-12-31T15:00Z", () => {
    expect(dateInputToSubmitDateIso("2026-01-01")).toBe("2025-12-31T15:00:00.000Z");
  });
});

describe("submitDateIsoToDateInput", () => {
  it("UTC ISO → KST date(YYYY-MM-DD)", () => {
    expect(submitDateIsoToDateInput("2026-02-09T15:00:00.000Z")).toBe("2026-02-10");
  });
  it("round-trip 보존", () => {
    expect(submitDateIsoToDateInput(dateInputToSubmitDateIso("2026-12-31"))).toBe("2026-12-31");
  });
});
