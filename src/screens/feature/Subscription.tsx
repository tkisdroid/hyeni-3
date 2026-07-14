import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Check } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useEntitlement } from "@/queries/useEntitlement";
import { qk } from "@/queries/keys";
import {
  isBillingAvailable,
  fetchSubscriptionProductDetails,
  launchSubscriptionPurchase,
  ANNUAL_BASE_PLAN_ID,
  MONTHLY_BASE_PLAN_ID,
  GOOGLE_PLAY_PACKAGE_NAME,
  SUBSCRIPTION_PRODUCT_ID,
} from "@/lib/native/billing";
import {
  selectSubscriptionOffer,
  type BillingProductDetails,
} from "@/transform/subscriptionOffer";
import { openExternal } from "@/lib/native/browser";
import {
  TIERS,
  FEATURES,
  maxChildrenFor,
  scheduleLimitFor,
  placeLimitFor,
  locationModeFor,
  canUse,
  getTierLabel,
  type Tier,
} from "@/transform/tierPolicy";
import "./Subscription.css";

/** 프리미엄 혜택 목록 (표현 데이터 — 화면 고정). */
const BENEFITS = [
  { icon: "ui/pin-heart.webp", t: "실시간 위치 확인", s: "아이의 현재 위치와 이동 흐름을 더 빠르게 확인해요" },
  { icon: "ui/menu-child-tracker.webp", t: "다자녀 안심 관리", s: "두 아이까지 일정과 위치를 함께 관리해요" },
  { icon: "ui/ai-robot.webp", t: "AI 하루 요약", s: "일정·위치·안전 기록을 AI가 정리해 드려요" },
  { icon: "ui/menu-remote-audio.webp", t: "주변 소리 듣기", s: "위급할 때 1분 동안 아이 주변 상황을 확인해요" },
  { icon: "ui/shield-heart.webp", t: "일정·장소 무제한", s: "학원, 학교, 준비물, 장소를 넉넉하게 등록해요" },
] as const;

// ── 플랜 비교표(S-02) — 값은 전부 tierPolicy 단일 소스에서 파생 ──
const COMPARE_COLS: readonly Tier[] = [TIERS.FREE, TIERS.REVIEWED, TIERS.PREMIUM];
const YES = "✓";
const NO = "—";

function limitLabel(n: number): string {
  return n === Infinity ? "무제한" : `${n}개`;
}
function locationLabel(t: Tier): string {
  const mode = locationModeFor(t);
  if (mode === "realtime") return "실시간";
  if (mode === "delayed") return "지연";
  return "잠금";
}

interface CompareRow {
  label: string;
  cell: (t: Tier) => string;
  /** 안전 기능(티어 무관 항상 제공) — 초록 강조. */
  safe?: boolean;
}
const COMPARE_ROWS: readonly CompareRow[] = [
  { label: "아이 등록", cell: (t) => `${maxChildrenFor(t)}명` },
  { label: "일정 저장", cell: (t) => limitLabel(scheduleLimitFor(t)) },
  { label: "장소 저장", cell: (t) => limitLabel(placeLimitFor(t)) },
  { label: "위치 보기", cell: (t) => locationLabel(t) },
  { label: "위치 이력", cell: (t) => (canUse(t, FEATURES.EXTENDED_HISTORY) ? YES : NO) },
  { label: "주변 소리 듣기", cell: (t) => (canUse(t, FEATURES.REMOTE_AUDIO) ? YES : NO) },
  { label: "AI 하루 요약", cell: (t) => (canUse(t, FEATURES.AI_ANALYSIS) ? YES : NO) },
  { label: "주간 리포트", cell: (t) => (canUse(t, FEATURES.WEEKLY_REPORT) ? YES : NO) },
  { label: "다중 위험구역", cell: (t) => (canUse(t, FEATURES.MULTI_GEOFENCE) ? YES : NO) },
  { label: "SOS · 긴급 알림", cell: () => YES, safe: true },
];

type Plan = "year" | "month";

/** 결제 주기 종료일 → "2026년 7월 4일" 형식. */
function formatPeriodEnd(d: Date): string {
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

/** 구독 · 페이월: 프리미엄 혜택 · 플랜 선택 · 결제 CTA. 실 티어로 활성 상태 표시. */
export function Subscription() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId } = useAuth();
  const qc = useQueryClient();
  const [plan, setPlan] = useState<Plan>("year");
  const [busy, setBusy] = useState(false);
  const { ready, isPremium, view, tier } = useEntitlement();
  const premiumActive = ready && isPremium;
  const [productDetails, setProductDetails] = useState<BillingProductDetails | null>(null);

  useEffect(() => {
    if (premiumActive || !isBillingAvailable()) return;
    let cancelled = false;
    void fetchSubscriptionProductDetails()
      .then((details) => {
        if (!cancelled) setProductDetails(details);
      })
      .catch((error) => {
        // 상품 조회 실패 시 가격·체험을 추측하지 않는다. 결제창에서 실제 조건을 확인한다.
        console.warn("Google Play 구독 상품 조회 실패:", error);
        if (!cancelled) setProductDetails(null);
      });
    return () => {
      cancelled = true;
    };
  }, [premiumActive]);

  const annualOffer = selectSubscriptionOffer(productDetails, ANNUAL_BASE_PLAN_ID);
  const monthlyOffer = selectSubscriptionOffer(productDetails, MONTHLY_BASE_PLAN_ID);
  const selectedOffer = plan === "year" ? annualOffer : monthlyOffer;

  // 결제 CTA — 네이티브(Android)면 Google Play Billing, 웹(PWA)이면 안내 토스트만.
  // 자동 실행 금지: 버튼 onClick 에서만 호출된다.
  const purchase = async () => {
    if (!isBillingAvailable()) {
      show("결제는 안드로이드 앱에서 진행할 수 있어요", "🤖");
      return;
    }
    if (!familyId) {
      show("가족 연결 후 다시 시도해 주세요", "👑");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const basePlanId = plan === "year" ? ANNUAL_BASE_PLAN_ID : MONTHLY_BASE_PLAN_ID;
      const freshProductDetails = await fetchSubscriptionProductDetails();
      const freshSelectedOffer = selectSubscriptionOffer(freshProductDetails, basePlanId);
      if (!freshSelectedOffer) {
        throw new Error("Google Play 구독 조건을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
      setProductDetails(freshProductDetails);
      const result = await launchSubscriptionPurchase({
        familyId,
        basePlanId,
        selectedOffer: freshSelectedOffer,
      });
      // 구독 성공 → 엔타이틀먼트 캐시 무효화로 활성 배너를 갱신한다.
      await qc.invalidateQueries({ queryKey: qk.entitlement(familyId) });
      show(result.isTrial ? "7일 무료 체험을 시작했어요" : "프리미엄 구독을 시작했어요", "👑");
    } catch (error) {
      show(error instanceof Error ? error.message : "구독을 시작하지 못했어요", "👑");
    } finally {
      setBusy(false);
    }
  };
  const manage = async () => {
    try {
      const url =
        `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(SUBSCRIPTION_PRODUCT_ID)}` +
        `&package=${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}`;
      await openExternal(url);
    } catch (error) {
      console.error("구독 관리 열기 실패:", error);
      show("구독 관리 화면을 열지 못했어요", "⚠️");
    }
  };

  // ready && isPremium 일 때만 활성 배너 노출. 조회 실패/미확정(ready=false)에서는
  // 무료로 강등하지 않고 기본 페이월(중립)만 보여준다(R9).
  const purchaseLabel = selectedOffer?.hasSevenDayTrial
    ? "결제 정보 등록하고 7일 무료 체험"
    : `${selectedOffer?.displayPrice ?? "Google Play에서 확인"} · 시작하기`;

  // 활성 배너 보조 문구(체험 남은 일수 → 결제 주기 종료 → 기본).
  const activeSub = (() => {
    if (!view) return "";
    if (view.isTrial && view.trialDaysLeft != null) {
      return `무료 체험 ${view.trialDaysLeft}일 남았어요`;
    }
    if (view.periodEnd) return `${formatPeriodEnd(view.periodEnd)}까지 이용할 수 있어요`;
    return "프리미엄 혜택을 모두 이용 중이에요";
  })();

  return (
    <div className="sub-screen">
      <div className="sub-header">
        <button
          type="button"
          className="hy-iconbtn hy-press sub-back"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="sub-header__title">프리미엄 구독</span>
      </div>

      <div className="sub-body">
        {/* 히어로 */}
        <div className="sub-hero">
          <img className="sub-hero__crown" src={asset("ui/crown.webp")} alt="" />
          <div className="sub-hero__title">혜니 프리미엄</div>
          <div className="sub-hero__sub">
            실시간 위치와 AI 요약으로
            <br />
            아이의 하루를 더 안심하게 확인하세요
          </div>
        </div>

        {/* 프리미엄 활성 배너 (실 티어) */}
        {premiumActive && view && (
          <div className="sub-active">
            <div className="sub-active__badge">
              <img src={asset("ui/crown.webp")} alt="" />
            </div>
            <div className="sub-active__text">
              <div className="sub-active__title">{view.planLabel} 이용 중</div>
              <div className="sub-active__sub">{activeSub}</div>
            </div>
            <Check className="sub-active__check" size={22} strokeWidth={3} />
          </div>
        )}

        {/* 플랜 선택 (미구독 시에만) */}
        {!premiumActive && (
          <div className="sub-plans">
            <button
              type="button"
              className="sub-plan hy-press"
              data-selected={plan === "year"}
              onClick={() => setPlan("year")}
            >
              <span className="sub-plan__ribbon">연간 플랜</span>
              <div className="sub-plan__info">
                <div className="sub-plan__name">프리미엄 연간 구독</div>
                <div className="sub-plan__meta">
                  {annualOffer?.hasSevenDayTrial ? "7일 무료 체험 후 자동 갱신" : "Google Play 구독 · 언제든 해지 가능"}
                </div>
              </div>
              <div className="sub-plan__price">{annualOffer?.displayPrice ?? "Google Play에서 확인"}</div>
            </button>

            <button
              type="button"
              className="sub-plan hy-press"
              data-selected={plan === "month"}
              onClick={() => setPlan("month")}
            >
              <div className="sub-plan__info">
                <div className="sub-plan__name">프리미엄 월구독</div>
                <div className="sub-plan__meta">
                  {monthlyOffer?.hasSevenDayTrial ? "7일 무료 체험 후 자동 갱신" : "Google Play 구독 · 언제든 해지 가능"}
                </div>
              </div>
              <div className="sub-plan__price">{monthlyOffer?.displayPrice ?? "Google Play에서 확인"}</div>
            </button>
          </div>
        )}

        {!premiumActive && selectedOffer?.hasSevenDayTrial && (
          <div className="sub-note">
            Google Play 결제 정보 등록 후 7일 동안 무료로 이용할 수 있어요. 7일 무료 체험 종료 후 Google Play에 표시된 구독 금액으로 자동 갱신돼요. 원하지 않으면 Google Play에서 체험 종료 전에 취소해 주세요.
          </div>
        )}

        {/* 혜택 */}
        <div className="sub-benefits">
          {BENEFITS.map((b) => (
            <div key={b.t} className="sub-benefit">
              <div className="sub-benefit__icon">
                <img src={asset(b.icon)} alt="" />
              </div>
              <div className="sub-benefit__text">
                <div className="sub-benefit__t">{b.t}</div>
                <div className="sub-benefit__s">{b.s}</div>
              </div>
              <Check className="sub-benefit__check" size={20} strokeWidth={3} />
            </div>
          ))}
        </div>

        {/* 플랜 비교표 (S-02) — 현재 티어 열 하이라이트 */}
        <div className="sub-compare">
          <div className="sub-compare__title">플랜 비교</div>
          <div className="sub-compare__scroll">
            <table className="sub-table">
              <thead>
                <tr>
                  <th scope="col" className="sub-table__rowhead sub-table__corner">
                    구분
                  </th>
                  {COMPARE_COLS.map((t) => (
                    <th
                      key={t}
                      scope="col"
                      className="sub-table__col"
                      data-current={t === tier}
                    >
                      <span className="sub-table__col-name">{getTierLabel(t)}</span>
                      {t === TIERS.PREMIUM && (
                        <span className="sub-table__col-price">{monthlyOffer?.displayPrice ?? "Play 가격 확인"}</span>
                      )}
                      {t === tier && <span className="sub-table__col-badge">현재</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="sub-table__rowhead">
                      {row.label}
                    </th>
                    {COMPARE_COLS.map((t) => (
                      <td
                        key={t}
                        className="sub-table__cell"
                        data-current={t === tier}
                        data-safe={row.safe ? "true" : undefined}
                      >
                        {row.cell(t)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 안내 (미구독 시에만) */}
        {!premiumActive && (
          <div className="sub-note">
            {
              "SOS와 긴급 안전 알림은 무료로 계속 제공돼요. 프리미엄은 실시간 위치와 AI 요약처럼 더 자세한 안심 기능을 열어드려요. 실제 가격과 결제 조건은 Google Play 확인 화면 기준입니다."
            }
          </div>
        )}

        {/* CTA — 구독 중이면 관리, 아니면 결제 시작(둘 다 토스트: 결제는 4단계 defer) */}
        {premiumActive ? (
          <button type="button" className="sub-cta hy-press" onClick={() => void manage()}>
            <img src={asset("ui/crown.webp")} alt="" />
            구독 관리
          </button>
        ) : (
          <button
            type="button"
            className="sub-cta hy-press"
            onClick={purchase}
            disabled={busy}
          >
            <img src={asset("ui/crown.webp")} alt="" />
            {busy ? "결제 진행 중…" : purchaseLabel}
          </button>
        )}

        <div className="sub-fine">
          {premiumActive ? (
            <>
              {view?.isTrial
                ? "무료 체험은 종료 전 Google Play에서 취소하지 않으면 Google Play에 표시된 구독 금액으로 자동 갱신돼요."
                : "구독은 설정 > 구독 관리에서 언제든 해지할 수 있어요."}
            </>
          ) : (
            <>
              구독은 선택한 기간마다 자동 갱신되며,
              <br />
              설정 &gt; 구독 관리에서 언제든 해지할 수 있어요.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
