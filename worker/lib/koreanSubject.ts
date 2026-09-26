/**
 * 부모에게 보이는 아이 이름 + 주격 조사("민준이가"/"혜니가"). 부모가 자기 아이를 부르는 말이라 "님"을 붙이지 않는다.
 * 도착 알림(arrivalDetect)과 SOS 원문(앱 sos.ts)과 같은 조사 규칙이다.
 */
export function childSubjectKo(name: string): string {
  const trimmed = name.trim();
  const last = trimmed.charCodeAt(trimmed.length - 1);
  const hasFinal = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${trimmed}${hasFinal ? "이가" : "가"}`;
}
