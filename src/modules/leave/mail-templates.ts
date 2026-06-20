import { getFullLeaveText } from "./labels";

export interface MailReqLike {
  leaveType: string; leaveSubType: string | null; quarterStartTime: string | null;
  startDate: Date; endDate: Date; reason: string | null;
}

// HTML 본문에 들어가는 모든 동적 텍스트는 이걸로 이스케이프 — 저장형 HTML 인젝션 차단(finding).
// 사용자/관리자 입력(reason·rejectionReason·name)은 임의 HTML을 담을 수 있다.
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function fmtRange(start: Date, end: Date): string {
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return f(start) === f(end) ? f(start) : `${f(start)} ~ ${f(end)}`;
}
function detail(req: MailReqLike): string {
  const type = getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime); // enum→고정 라벨(안전하나 일관성 위해 esc)
  return `<ul><li>유형: ${esc(type)}</li><li>기간: ${fmtRange(req.startDate, req.endDate)}</li>${req.reason ? `<li>사유: ${esc(req.reason)}</li>` : ""}</ul>`;
}

export function buildRequestNotification(applicantName: string, req: MailReqLike) {
  const type = getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime);
  return { subject: `[연차 신청] ${applicantName}님의 ${type} 신청`, html: `<p>${esc(applicantName)}님이 연차를 신청했습니다.</p>${detail(req)}<p>승인 대기 목록에서 처리해 주세요.</p>` };
}
export function buildApprovedNotification(req: MailReqLike) {
  return { subject: `[연차 승인] ${getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime)} 신청이 승인되었습니다`, html: `<p>연차 신청이 승인되었습니다.</p>${detail(req)}` };
}
export function buildRejectedNotification(req: MailReqLike, rejectionReason: string) {
  return { subject: `[연차 반려] ${getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime)} 신청이 반려되었습니다`, html: `<p>연차 신청이 반려되었습니다.</p>${detail(req)}<p>반려 사유: ${esc(rejectionReason)}</p>` };
}
export function buildAdminCreatedNotification(req: MailReqLike) {
  return { subject: `[연차 등록] ${getFullLeaveText(req.leaveType, req.leaveSubType, req.quarterStartTime)}가 등록되었습니다`, html: `<p>관리자가 연차를 등록했습니다.</p>${detail(req)}` };
}
