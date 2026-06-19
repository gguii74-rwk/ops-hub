import type { CalendarSourceProvider } from "../types";
import { createExternalProvider, type ExternalProviderOpts } from "./external-shared";

// 얇은 래퍼 — cache-first 루프는 external-shared의 createExternalProvider에 있다(중복 제거).
export function createGoogleProvider(opts: ExternalProviderOpts = {}): CalendarSourceProvider {
  return createExternalProvider(opts, {
    key: "google",
    sourceKinds: ["GOOGLE_CALENDAR"],
    eventKind: "EXTERNAL_EVENT",
    ownerOf: (s) => s.ownerUserId, // 개인 Google 소스의 ownerUserId를 event.userId로 전파(dedup attribution §10)
  });
}
