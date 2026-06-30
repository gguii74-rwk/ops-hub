import { computeBillingPeriod, toKstFields } from "@/modules/workflows/billing/period";

// 전월·회차·연도는 백엔드 순수 함수 재사용(골든 parity — D4). 요일만 KST 보조 계산.
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const KST_OFFSET_MS = 540 * 60_000;
function kstWeekday(d: Date): string {
  return WEEKDAYS[new Date(d.getTime() + KST_OFFSET_MS).getUTCDay()];
}

export interface BillingMailContext {
  scheduledAt: Date;
  projectName: string;
}

export function buildSubject(step: 1 | 2, ctx: BillingMailContext): string {
  const { projectYear, round } = computeBillingPeriod(ctx.scheduledAt);
  return step === 1
    ? `${projectYear}년 ${ctx.projectName} ${round}월 대금 청구의 건`
    : `${projectYear}년 ${ctx.projectName} ${round}월 대금 청구 서류 요청의 건`;
}

export function buildBody(step: 1 | 2, ctx: BillingMailContext): string {
  const { projectYear, round } = computeBillingPeriod(ctx.scheduledAt);
  const { month: billingM, day: billingD } = toKstFields(ctx.scheduledAt);
  const weekday = kstWeekday(ctx.scheduledAt);
  if (step === 1) {
    return [
      "안녕하세요, 유라클 노원국 입니다.",
      "",
      `${projectYear}년 ${ctx.projectName} ${round}월 대금 청구 관련 서류보내드리니`,
      "확인 및 검토 부탁드리겠습니다.",
      `공문 발송일은 ${billingM}월 ${billingD}일로 작성하였습니다.`,
      `검토가 끝나면 직인 날인 후 ${billingM}월 ${billingD}일(${weekday})에 원본 서류 전달 드리겠습니다.`,
      "",
      "감사합니다.",
    ].join("\n");
  }
  return [
    "안녕하세요, 세종개발본부 노원국 입니다.",
    "",
    `${ctx.projectName} 대금 청구 관련하여 서류 요청 드립니다.`,
    `${billingM}월 ${billingD}일(${weekday}) 발행한 국세/지방세 완납증명서, 4대보험 완납증명서 스캔본(PDF)을 메일로 회신 부탁 드리겠습니다.`,
    "",
    "감사합니다.",
  ].join("\n");
}

// HTML escape — 본문·projectName이 escape 없이 msg.html로 외부 발송되면 임의 HTML 주입(F-A1).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// plain text → HTML(줄바꿈 보존, 선두 공백 &nbsp;). deliver가 msg.html로 사용(SC-5). day-sync 변환 포팅 + escape.
export function plainToHtml(plain: string): string {
  return plain
    .split("\n")
    .map((line) => {
      if (!line.trim()) return "<br>";
      // escape 먼저(입력의 &<>"' 무력화) → 선두 공백을 &nbsp;로(이때 삽입되는 &는 재escape 안 함).
      const preserved = escapeHtml(line).replace(/^ +/, (spaces) => "&nbsp;".repeat(spaces.length));
      return `<p>${preserved}</p>`;
    })
    .join("\n");
}
