import { z } from "zod";

// 낙관적 동시성(stale-tab lost-update 차단) — admin 사용자 변경·leave 관리자 수정 공통 계약.
// 클라이언트는 자신이 본 행의 버전(`updatedAt` ISO)을 mutation 요청에 함께 보낸다. repo는 CAS where에
// `updatedAt: expectedUpdatedAt`를 걸고, 그 사이 다른 세션이 행을 바꿔 0행이면 409(Conflict)로 막는다.
// 서버가 mutation 직전 재로드한 값으로 CAS하면 "요청 내" race만 막을 뿐, 모달을 열어둔 사이의
// stale-tab lost-update는 못 막는다 — 그래서 클라이언트가 본 버전을 권위로 받는다.
export const expectedUpdatedAt = z.string().datetime({ offset: true });

// ISO 문자열 → Date(Prisma CAS where 비교용). 라우트가 zod 통과 직후 변환한다.
export function parseExpectedUpdatedAt(iso: string): Date {
  return new Date(iso);
}
