/**
 * 부모님 전화 시트 — 엄마/아빠 중 누구에게 걸지 고른다.
 *
 * 시안에는 "전화 거는 중…" 인앱 오버레이가 있지만, 실제로는 안드로이드 다이얼러가 화면을 덮으므로
 * 그 오버레이는 사용자에게 보이지 않는다. 그래서 만들지 않고, 토스트로만 알리고 바로 발신한다.
 * 번호가 없는 보호자는 버튼을 비활성화하고 이유를 적는다(누르면 아무 일 없는 버튼 금지).
 */
import { asset } from "@/lib/assets";
import { ChildSheet } from "./ChildSheet";

export interface CallTarget {
  gender: "mom" | "dad";
  label: string;
  phone: string | null;
}

export interface CallSheetProps {
  open: boolean;
  onClose: () => void;
  targets: readonly CallTarget[];
  onCall: (target: CallTarget) => void;
}

const AVATAR: Record<CallTarget["gender"], string> = {
  mom: "family/mom.webp",
  dad: "family/dad.webp",
};

export function CallSheet({ open, onClose, targets, onCall }: CallSheetProps) {
  const missing = targets.filter((t) => !t.phone);
  return (
    <ChildSheet open={open} onClose={onClose} label="부모님 전화">
      <div className="ks-call__title">누구한테 전화할까? 📞</div>

      {targets.length === 0 ? (
        <div className="ks-empty">아직 보호자 전화번호가 없어. 부모님한테 등록해 달라고 하자!</div>
      ) : (
        <div className="ks-call__grid">
          {targets.map((t) => (
            <button
              key={t.gender}
              type="button"
              className={`ks-call__btn ks-call__btn--${t.gender} hy-press`}
              onClick={() => onCall(t)}
              disabled={!t.phone}
            >
              <img src={asset(AVATAR[t.gender])} alt="" />
              <span className="ks-call__name">{t.label}</span>
            </button>
          ))}
        </div>
      )}

      {missing.length > 0 && targets.length > 0 && (
        <div className="ks-call__note">
          {missing.map((m) => m.label).join(" · ")} 전화번호가 아직 없어
        </div>
      )}
    </ChildSheet>
  );
}
