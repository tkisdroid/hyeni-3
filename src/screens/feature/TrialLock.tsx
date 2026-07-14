import { useNavigate } from "react-router-dom";
import { ChevronLeft, Crown } from "lucide-react";
import { asset } from "@/lib/assets";
import { useEntitlement } from "@/queries/useEntitlement";
import "./TrialLock.css";

// 페이월 혜택 아이콘 — 3D 에셋(구독 화면과 동일 시각 언어).
const PREMIUM_PERKS = [
  { icon: "ui/pin-heart.webp", label: "실시간 위치 · 이동 경로 확인" },
  { icon: "ui/ai-robot.webp", label: "AI 하루 요약 · 주간 가족 리포트" },
  { icon: "ui/menu-child-tracker.webp", label: "두 아이 · 일정과 장소 넉넉하게" },
] as const;

function formatDate(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

/** S-03 체험 종료 · 잠금 — useEntitlement 기준 잠금/체험 상태 안내 + 구독 유도. */
export function TrialLock() {
  const navigate = useNavigate();
  const { ready, isPremium, reviewed, view, isLoading } = useEntitlement();

  const goSubscribe = () => navigate("/subscription");

  return (
    <div className="tl-root">
      <header className="tl-head">
        <button
          type="button"
          className="tl-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="tl-head-title">프리미엄</span>
      </header>

      {/* 티어 미확정: 잠금/무료 단정 금지(R9) — 중립 로딩만. */}
      {!ready && (
        <div className="tl-content">
          <div className="tl-loading">
            {isLoading ? "구독 상태를 확인하고 있어요…" : "구독 상태를 불러오지 못했어요."}
          </div>
        </div>
      )}

      {/* 무료 체험 중: 부드러운 안내(잠금 아님) + 유지 유도. */}
      {ready && view?.isTrial && (
        <div className="tl-content">
          <div className="tl-hero tl-hero--trial">
            <div className="tl-hero__badge">
              <Crown size={30} strokeWidth={2} color="#fff" />
            </div>
            <div className="tl-hero__dday">
              {view.trialDaysLeft != null ? `무료 체험 D-${view.trialDaysLeft}` : "무료 체험 중"}
            </div>
            <div className="tl-hero__title">지금 모든 프리미엄 기능을 쓰고 있어요</div>
            {view.trialEndsAt && (
              <div className="tl-hero__sub">{formatDate(view.trialEndsAt)}에 체험이 끝나요</div>
            )}
          </div>
          <PerkList />
          <button type="button" className="tl-cta hy-press" onClick={goSubscribe}>
            체험 끝나기 전에 계속 이용하기
          </button>
          <button type="button" className="tl-ghost hy-press" onClick={() => navigate(-1)}>
            나중에 할게요
          </button>
        </div>
      )}

      {/* 이미 프리미엄(체험 아님): 상태만 안내. */}
      {ready && isPremium && !view?.isTrial && (
        <div className="tl-content">
          <div className="tl-hero tl-hero--active">
            <div className="tl-hero__badge">
              <Crown size={30} strokeWidth={2} color="#fff" />
            </div>
            <div className="tl-hero__title">{view?.planLabel ?? "프리미엄 이용 중"}</div>
            {view?.periodEnd && (
              <div className="tl-hero__sub">{formatDate(view.periodEnd)}까지 이용할 수 있어요</div>
            )}
          </div>
          <PerkList />
          <button type="button" className="tl-ghost hy-press" onClick={() => navigate(-1)}>
            돌아가기
          </button>
        </div>
      )}

      {/* 무료/만료: 잠금 화면 + 구독 유도. */}
      {ready && !isPremium && (
        <div className="tl-content">
          <div className="tl-lock">
            <div className="tl-lock__ring">
              <img src={asset("ui/crown.webp")} alt="" style={{ width: 44, height: 44, objectFit: "contain" }} />
            </div>
            <div className="tl-lock__title">
              {view?.status === "expired" ? "체험이 종료되었어요" : "프리미엄 기능이에요"}
            </div>
            <div className="tl-lock__sub">
              프리미엄을 시작하면 실시간 위치·이동 경로·AI 상세 기능을 쓸 수 있어요.
              <br />
              SOS와 긴급 안전 알림은 무료로 계속 제공돼요.
            </div>
            {reviewed && (
              <div className="tl-lock__reviewed">
                🎁 스토어 방문 혜택 적용 중 · 일정·장소를 3개까지 쓰고 있어요
              </div>
            )}
          </div>
          <PerkList />
          <button type="button" className="tl-cta hy-press" onClick={goSubscribe}>
            프리미엄 시작하기
          </button>
          <button type="button" className="tl-ghost hy-press" onClick={() => navigate(-1)}>
            무료로 계속 쓰기
          </button>
        </div>
      )}
    </div>
  );
}

function PerkList() {
  return (
    <div className="tl-perks">
      {PREMIUM_PERKS.map((p) => (
        <div key={p.label} className="tl-perk">
          <span className="tl-perk__ic">
            <img src={asset(p.icon)} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />
          </span>
          <span className="tl-perk__label">{p.label}</span>
        </div>
      ))}
    </div>
  );
}
