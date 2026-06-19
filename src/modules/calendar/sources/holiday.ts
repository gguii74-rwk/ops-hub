import type { CalendarSourceProvider } from "../types";
import { createExternalProvider, type ExternalProviderOpts } from "./external-shared";

// 얇은 래퍼 — 공휴일도 Google 공휴일 캘린더라 같은 루프를 쓴다. owner 없음(전원 공통).
export function createHolidayProvider(opts: ExternalProviderOpts = {}): CalendarSourceProvider {
  return createExternalProvider(opts, {
    key: "holiday",
    sourceKinds: ["HOLIDAY"],
    eventKind: "HOLIDAY",
    ownerOf: () => null,
  });
}
