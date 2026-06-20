// 서버 부팅 시 현재+익년 공휴일을 적재 시도한다. 재시작마다 돌므로 연도 경과 시 내후년 자동 적재.
// await하지 않고 fire-and-forget — 외부 API 지연/멈춤이 부팅 readiness를 막지 않게 한다.
// 미적재 연도는 요청 경로 백스톱(ensureYearsSynced)+fail-closed 게이트가 처리한다.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureYearsSynced } = await import("@/kernel/holidays");
  const y = new Date().getFullYear();
  void ensureYearsSynced([y, y + 1]).catch((e) => {
    console.error("[instrumentation] 공휴일 부팅 동기화 실패(무시):", e);
  });
}
