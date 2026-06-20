// 서버 부팅 시 현재+익년 공휴일을 보장한다. 재시작마다 도므로 연도 경과 시 내후년 자동 적재.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureYearsSynced } = await import("@/kernel/holidays");
    const y = new Date().getFullYear();
    await ensureYearsSynced([y, y + 1]);
  } catch (e) {
    console.error("[instrumentation] 공휴일 부팅 동기화 실패(무시):", e);
  }
}
