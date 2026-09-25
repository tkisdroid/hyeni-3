/**
 * 출력 상한(max_completion_tokens)에 걸려 잘린 AI 답을 마지막 완결 문장까지만 남긴다.
 * 문장 끝(. ! ? ~ 와 전각 부호) 뒤가 공백이거나 끝인 마지막 지점까지 자르고, 완결 문장이 없으면 빈 문자열이다
 * (호출부는 빈 응답을 기존 정직한 강등 경로로 보낸다 — 문장 중간에 끊긴 답을 아이에게 보이지 않는다).
 */
export function trimToLastCompleteSentence(text: string): string {
  const match = text.match(/^[\s\S]*[.!?~。！？](?=\s|$)/u);
  return match ? match[0].trim() : "";
}
