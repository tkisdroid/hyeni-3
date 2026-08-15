import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Copy, Gift, RefreshCw, Share2, X } from "lucide-react";
import { useToast } from "@/app/toast";
import { PUBLIC_WEB_BASE } from "@/config/env";
import { useDialogFocusLifecycle } from "./useDialogFocusLifecycle";
import { useEnsureReferralCode, useReferralStatus } from "@/queries/useReferrals";
import { buildReferralLink } from "@/transform/referralLink";
import "./ReferralRewardPanel.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

export interface ReferralEligibleChild {
  userId: string;
  name: string;
}

export function ReferralRewardPanel({
  open,
  onClose,
  eligibleChildren,
}: {
  open: boolean;
  onClose: () => void;
  eligibleChildren: readonly ReferralEligibleChild[];
}) {
  const { show } = useToast();
  const intl = useIntl();
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const statusQuery = useReferralStatus(open);
  const ensureCode = useEnsureReferralCode();
  const status = statusQuery.data;
  const [selectedChild, setSelectedChild] = useState("");
  const selectionTouchedRef = useRef(false);
  const busy = ensureCode.isPending;
  const dialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open,
    onClose,
    initialFocusRef: closeRef,
    canClose: () => !busy,
  });

  useEffect(() => {
    if (!open) {
      selectionTouchedRef.current = false;
      setSelectedChild("");
      return;
    }
    const preferred = status?.rewardChildUserId;
    const validPreferred = eligibleChildren.some((child) => child.userId === preferred);
    const validSelected = eligibleChildren.some((child) => child.userId === selectedChild);
    if (!selectionTouchedRef.current && validPreferred && selectedChild !== preferred) {
      setSelectedChild(preferred as string);
      return;
    }
    if (!validSelected) {
      selectionTouchedRef.current = false;
      setSelectedChild(validPreferred ? preferred as string : eligibleChildren[0]?.userId ?? "");
    }
  }, [eligibleChildren, open, selectedChild, status?.rewardChildUserId]);

  if (!open) return null;

  const saveCode = () => {
    if (!selectedChild || busy) return;
    ensureCode.mutate(selectedChild, {
      onSuccess: (next) => {
        show(next.code ? "친구 초대 코드를 준비했어요" : "초대 상태를 갱신했어요", "🎁");
      },
      onError: (error) => show(localizeApiError(error, intl, "formal"), "⚠️"),
    });
  };

  const invitationText = status?.code
    ? `혜니캘린더에서 가족 안전을 함께 시작해요.\n새 가족을 만든 뒤 3일이 지나고, 처음 위치 연결 뒤 48시간 동안 최신 위치가 확인되면 두 가족 모두 추가 AI 대화 10회를 받아요.\n${buildReferralLink(PUBLIC_WEB_BASE, status.code)}`
    : "";

  const copyInvitation = async () => {
    if (!invitationText || !status?.code) return;
    if (!navigator.clipboard?.writeText) {
      show(`복사를 지원하지 않아요 · 코드 ${status.code}`, "✏️");
      return;
    }
    try {
      await navigator.clipboard.writeText(invitationText);
      show("친구 초대 링크를 복사했어요", "📋");
    } catch {
      show(`복사하지 못했어요 · 코드 ${status.code}`, "✏️");
    }
  };

  const shareInvitation = async () => {
    if (!invitationText || !status?.code) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "혜니캘린더 친구 초대", text: invitationText });
        return;
      } catch {
        // 공유 시트 취소는 실패로 알리지 않는다.
        return;
      }
    }
    await copyInvitation();
  };

  return (
    <div className="rrp" role="presentation">
      <button
        type="button"
        className="rrp__scrim"
        tabIndex={-1}
        aria-label="친구 초대 닫기"
        onClick={() => !busy && onClose()}
      />
      <div
        ref={dialogRef}
        className="rrp__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="rrp__header">
          <span className="rrp__header-icon" aria-hidden="true"><Gift size={22} /></span>
          <div className="rrp__header-copy">
            <h2 id={titleId}>친구 가족 초대</h2>
            <p id={descriptionId}>함께 시작하면 두 가족 모두 추가 AI 대화 10회를 받아요.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="rrp__close hy-press"
            aria-label="닫기"
            onClick={onClose}
            disabled={busy}
            aria-busy={busy}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="rrp__body">
          <section className="rrp__policy" aria-label="친구 초대 보상 조건">
            <div className="rrp__reward">두 가족 모두 추가 AI 대화 10회</div>
            <p>초대한 가족은 평생 최대 3가족까지 보상을 받을 수 있어요.</p>
            <ol>
              <li>친구가 이 링크로 처음 새 가족을 만들어요.</li>
              <li>아이 위치를 처음 연결하고, 48시간 뒤에도 최신 위치가 확인돼요.</li>
              <li>가족을 만든 뒤 72시간이 지나면 서버가 자동으로 지급해요.</li>
            </ol>
            <small>추천 기록에는 위치 좌표·주소를 저장하지 않아요. Free와 Premium 기능 구분과 월 4,900원·연 39,000원 가격은 바뀌지 않아요.</small>
          </section>

          {statusQuery.isLoading ? (
            <div className="rrp__state" role="status">초대 상태를 불러오고 있어요…</div>
          ) : statusQuery.isError ? (
            <div className="rrp__state" role="alert">
              <span>초대 상태를 불러오지 못했어요.</span>
              <button type="button" className="rrp__retry hy-press" onClick={() => void statusQuery.refetch()}>
                <RefreshCw size={17} aria-hidden="true" /> 다시 시도
              </button>
            </div>
          ) : eligibleChildren.length === 0 ? (
            <div className="rrp__state" role="status">
              아이 기기를 연결한 뒤 친구 초대 코드를 만들 수 있어요.
            </div>
          ) : status ? (
            <>
              <section className="rrp__progress" aria-label="친구 초대 진행 상태">
                <span><CheckCircle2 size={18} aria-hidden="true" /> 성공 {status.successfulCount}/{status.successCap}</span>
                <span>확인 중 {status.pendingCount}가족</span>
              </section>

              <label className="rrp__field" htmlFor="referral-reward-child">
                <span>초대 보상을 받을 아이</span>
                <select
                  id="referral-reward-child"
                  value={selectedChild}
                  onChange={(event) => {
                    selectionTouchedRef.current = true;
                    setSelectedChild(event.target.value);
                  }}
                  disabled={busy}
                >
                  {eligibleChildren.map((child) => (
                    <option key={child.userId} value={child.userId}>{child.name}</option>
                  ))}
                </select>
              </label>

              {status.code ? (
                <div className="rrp__code" aria-label={`친구 초대 코드 ${status.code}`}>
                  {status.code}
                </div>
              ) : (
                <div className="rrp__code rrp__code--empty">코드를 먼저 만들어 주세요</div>
              )}

              {status.rewardChildUserId !== selectedChild || !status.code ? (
                <button
                  type="button"
                  className="rrp__save hy-press"
                  onClick={saveCode}
                  disabled={!selectedChild || busy || !status.canInvite}
                  aria-busy={busy}
                >
                  {busy ? "준비 중…" : status.code ? "받을 아이 변경하기" : "초대 코드 만들기"}
                </button>
              ) : null}

              <div className="rrp__actions">
                <button
                  type="button"
                  className="rrp__action rrp__action--copy hy-press"
                  onClick={() => void copyInvitation()}
                  disabled={!status.code || !status.canInvite}
                >
                  <Copy size={18} aria-hidden="true" /> 링크 복사
                </button>
                <button
                  type="button"
                  className="rrp__action rrp__action--share hy-press"
                  onClick={() => void shareInvitation()}
                  disabled={!status.code || !status.canInvite}
                >
                  <Share2 size={18} aria-hidden="true" /> 친구에게 공유
                </button>
              </div>
              {!status.canInvite && (
                <p className="rrp__complete" role="status">세 가족 초대 보상을 모두 받았어요. 고마워요!</p>
              )}
            </>
          ) : (
            <div className="rrp__state" role="status">표시할 초대 상태가 없어요.</div>
          )}
        </div>
      </div>
    </div>
  );
}
