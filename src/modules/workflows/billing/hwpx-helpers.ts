// 순수 XML/포맷 헬퍼(fs/Prisma 미의존, 1층 단위 테스트 대상). day-sync billing-hwpx-generator.ts 포팅.

export function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

// 치환 *값*에만 적용(D9). & 를 먼저(이중 이스케이프 방지). split/replace 마커 자체엔 적용 안 함.
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatAmount(amount: number): string { return amount.toLocaleString("en-US"); }
export function formatAmountBig(amount: bigint): string { return amount.toLocaleString("en-US"); }

// colAddr/rowAddr로 셀을 찾아 빈 <hp:run charPrIDRef="6"/> 를 텍스트 run으로 치환.
export function fillEmptyCell(xml: string, colAddr: number, rowAddr: number, text: string): string {
  const marker = `colAddr="${colAddr}" rowAddr="${rowAddr}"`;
  const markerIdx = xml.indexOf(marker);
  if (markerIdx === -1) return xml;
  const beforeMarker = xml.substring(0, markerIdx);
  const tcStart = beforeMarker.lastIndexOf("<hp:tc");
  if (tcStart === -1) return xml;
  const cellContent = xml.substring(tcStart, markerIdx);
  const selfClosingRun = '<hp:run charPrIDRef="6"/>';
  const selfClosingRunIdx = cellContent.indexOf(selfClosingRun);
  if (selfClosingRunIdx === -1) return xml;
  const absoluteIdx = tcStart + selfClosingRunIdx;
  const replacement = `<hp:run charPrIDRef="6"><hp:t>${text}</hp:t></hp:run>`;
  return xml.substring(0, absoluteIdx) + replacement + xml.substring(absoluteIdx + selfClosingRun.length);
}

// 특정 셀의 <hp:t> 텍스트를 빈 문자열로 교체.
export function clearCellText(xml: string, colAddr: number, rowAddr: number): string {
  const marker = `colAddr="${colAddr}" rowAddr="${rowAddr}"`;
  const markerIdx = xml.indexOf(marker);
  if (markerIdx === -1) return xml;
  const tcStart = xml.lastIndexOf("<hp:tc", markerIdx);
  if (tcStart === -1) return xml;
  const tcEnd = xml.indexOf("</hp:tc>", markerIdx);
  if (tcEnd === -1) return xml;
  const cellXml = xml.substring(tcStart, tcEnd);
  const newCellXml = cellXml.replace(/<hp:t>[^<]*<\/hp:t>/g, "<hp:t></hp:t>");
  return xml.substring(0, tcStart) + newCellXml + xml.substring(tcEnd);
}

// roundDateMap[round]의 submitDate(instant)에서 KST DD(2자리). 없으면 청구일 fallbackDD(J2).
const KST_OFFSET_MS = 540 * 60_000;
function ddOfRound(round: number, roundDateMap: Record<number, Date>, fallbackDD: string): string {
  const d = roundDateMap[round];
  if (!d) return fallbackDD;
  const s = new Date(new Date(d).getTime() + KST_OFFSET_MS);
  return pad2(s.getUTCDate());
}

// 누계는 monthlyAmount(bigint) * i 로 BigInt 계산(J4). amountStr는 월 청구금액 문자열(이미 포맷됨).
export function fillGisungTable(
  xml: string, billingDD: string, round: number, amountStr: string, monthlyAmount: bigint,
  roundDateMap: Record<number, Date> = {},
): string {
  let result = xml;
  const dd1 = ddOfRound(1, roundDateMap, billingDD);
  result = result.split("02월 10일").join(`02월 ${dd1}일`);

  if (round >= 2) {
    const dd2 = ddOfRound(2, roundDateMap, billingDD);
    result = result.split("03월 10일").join(`03월 ${dd2}일`);
  } else {
    result = clearCellText(result, 1, 6);
    result = clearCellText(result, 2, 6);
    result = clearCellText(result, 4, 6);
    result = clearCellText(result, 6, 6);
  }

  for (let i = 3; i <= round; i++) {
    const rowAddr = i + 4;
    const submitMonth = pad2((i % 12) + 1);
    const ddI = ddOfRound(i, roundDateMap, billingDD);
    const submitDate = `${submitMonth}월 ${ddI}일`;
    const cumulative = formatAmountBig(monthlyAmount * BigInt(i)); // J4: BigInt 곱, 포맷 직전 문자열화
    result = fillEmptyCell(result, 1, rowAddr, submitDate);
    result = fillEmptyCell(result, 2, rowAddr, amountStr);
    result = fillEmptyCell(result, 4, rowAddr, amountStr);
    result = fillEmptyCell(result, 6, rowAddr, cumulative);
  }
  return result;
}
