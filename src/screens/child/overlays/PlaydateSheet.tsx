/**
 * 친구랑 놀기 시트 — 홈 타일에서 열린다.
 *
 * 시안은 "도윤 · 걸어서 4분" 같은 친구를 하드코딩했지만, 실제 서버는 이름과 아이 id 만 준다
 * (거리·사진 없음). 그래서 **거리를 지어내지 않고** "근처에 있어"라고만 쓰고,
 * 아바타는 아이 id 로 동물 캐릭터를 고정 배정한다.
 *
 * 친구놀이가 꺼져 있거나 위치를 모르면 서버가 soft error 를 준다 → 반말 안내로 정직하게 강등.
 */
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { asset } from "@/lib/assets";
import { useCreatePlaydateInvite, usePlaydateCandidates } from "@/queries/usePlaydate";
import type { PlaydateCandidate } from "@/lib/api/endpoints/playdate";
import { friendAvatar, playdateCandidateNotice } from "@/transform/playdateNotice";
import { ChildSheet } from "./ChildSheet";

export interface PlaydateSheetProps {
  open: boolean;
  onClose: () => void;
  onError: (message: string) => void;
}

export function PlaydateSheet({ open, onClose, onError }: PlaydateSheetProps) {
  const candidatesQuery = usePlaydateCandidates(open);
  const createInvite = useCreatePlaydateInvite();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // 시트를 다시 열 때는 항상 처음 상태로.
  useEffect(() => {
    if (open) {
      setSent(false);
      setSelectedId(null);
    }
  }, [open]);

  const candidates: PlaydateCandidate[] = candidatesQuery.data?.candidates ?? [];
  const notice = playdateCandidateNotice(candidatesQuery.data?.error, candidates.length === 0, candidatesQuery.isError);
  const selected = candidates.find((c) => c.child_user_id === selectedId) ?? candidates[0] ?? null;

  const send = () => {
    if (!selected || createInvite.isPending) return;
    createInvite.mutate(selected, {
      onSuccess: () => setSent(true),
      onError: () => onError("놀자고 보내지 못했어. 다시 해볼래?"),
    });
  };

  return (
    <ChildSheet open={open} onClose={onClose} label="친구랑 놀기">
      {sent ? (
        <div className="ks-done">
          <img src={asset("mascot/cheer.webp")} alt="" />
          <div className="ks-done__title">놀자고 보냈어!</div>
          <div className="ks-done__sub">
            부모님이 확인하고 허락하면
            <br />
            바로 알려줄게 😊
          </div>
          <button type="button" className="ks-cta ks-cta--ghost hy-press" onClick={onClose}>
            알겠어!
          </button>
        </div>
      ) : (
        <>
          <div className="ks-head">
            <img src={asset("ui/menu-friend-playdate.webp")} alt="" />
            <span className="ks-head__title">누구랑 놀까?</span>
          </div>
          <div className="ks-sub">근처에 있는 친구에게 놀자고 보낼 수 있어</div>

          {candidatesQuery.isLoading ? (
            <div className="ks-empty">근처 친구를 찾는 중이야… 🔎</div>
          ) : notice ? (
            <div className="ks-empty">
              {notice}
              {candidatesQuery.isError && (
                <button
                  type="button"
                  className="ks-retry hy-press"
                  onClick={() => void candidatesQuery.refetch()}
                >
                  다시 찾기
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="ks-friend-list">
                {candidates.map((c) => {
                  const active = (selected?.child_user_id ?? null) === c.child_user_id;
                  return (
                    <button
                      key={c.child_user_id}
                      type="button"
                      className="ks-friend hy-press"
                      aria-pressed={active}
                      onClick={() => setSelectedId(c.child_user_id)}
                    >
                      <span className="ks-friend__ava">
                        <img src={asset(friendAvatar(c.child_user_id))} alt="" />
                      </span>
                      <span className="ks-friend__main">
                        <span className="ks-friend__name">{c.child_name || "친구"}</span>
                        <span className="ks-friend__sub">근처에 있어</span>
                      </span>
                      <span className="ks-friend__check">
                        <Check
                          size={15}
                          strokeWidth={3.4}
                          color="var(--bg-card)"
                          style={{ opacity: active ? 1 : 0 }}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="ks-cta hy-press"
                onClick={send}
                disabled={!selected || createInvite.isPending}
              >
                {createInvite.isPending ? "보내는 중…" : "같이 놀자고 보내기 💌"}
              </button>
            </>
          )}
        </>
      )}
    </ChildSheet>
  );
}
