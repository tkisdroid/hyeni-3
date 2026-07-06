/**
 * memo_replies → 대화 화면(MemoChat) 뷰모델 매핑(순수).
 * 도메인 데이터(content/시각/보낸이)는 실값, "내 메모 여부"는 currentUserId 로 판별.
 * 표현(아바타/색)은 화면 CSS 가 mine/peer 로 처리하므로 여기서는 다루지 않는다.
 */
import type { MemoReply } from "@/lib/api/endpoints/memo";

export interface ThreadMsg {
  id: string;
  mine: boolean; // true = 내가 보낸 메시지(우측 정렬)
  showMeta: boolean; // 좌측 아바타 노출(peer 메시지)
  senderUserId: string | null; // 발신자 auth user_id — 그룹 대화에서 실제 보낸 사람(아이1/아이2/부모) 표시용
  text: string;
  time: string; // "오전/오후 h:mm"
}

/** UTC ISO created_at → "오전/오후 h:mm"(로컬 시각). 무효 시 빈 문자열. */
export function formatMemoClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? "오전" : "오후";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${hh}:${String(m).padStart(2, "0")}`;
}

// 대화는 시간순이 자연스러우므로 created_at 오름차순, 동시각은 id 로 안정 정렬.
function compareReplies(a: MemoReply, b: MemoReply): number {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * replies → ThreadMsg[]. currentUserId 와 user_id 비교로 mine 판별,
 * peer(상대) 메시지에만 아바타(showMeta)를 노출한다. 원본은 뮤테이션하지 않는다.
 */
export function mapRepliesToThread(
  replies: MemoReply[],
  currentUserId: string | null,
): ThreadMsg[] {
  return [...replies].sort(compareReplies).map((r) => {
    const mine = !!currentUserId && r.user_id === currentUserId;
    return {
      id: r.id,
      mine,
      showMeta: !mine,
      senderUserId: r.user_id ?? null,
      text: r.content ?? "",
      time: formatMemoClock(r.created_at),
    };
  });
}
