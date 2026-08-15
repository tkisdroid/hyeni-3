import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, Camera } from "lucide-react";
import { useToast } from "@/app/toast";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { useMyFamily, useRegeneratePairCode, useCreateChildren } from "@/queries/useFamily";
import { useEntitlement } from "@/queries/useEntitlement";
import { FEATURES, TIERS, lockMessageFor } from "@/transform/tierPolicy";
import { resolveChildAddGate, type ChildAddGateDecision } from "@/transform/secondChildGate";
import {
  browserPremiumReturnIntentStorage,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import { validateChildDraftRequirements } from "@/transform/childProfileRequirements";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import { resizeImageFileSafe } from "@/lib/imageResize";
import "./PairingWizard.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

type Step = 1 | 2 | 3;

interface ChildDraft {
  name: string;
  birthdate: string;
  /** 미업로드 data:URL(선택). 코드 생성 시 서버 발급 경로로 업로드된다. */
  photoDataUrl: string | null;
}

// 선택 가능한 최대치는 프리미엄 2명 → 후보는 [1, 2]. 티어 상한 초과는 잠금.
const COUNTS = [1, 2] as const;

function emptyChild(): ChildDraft {
  return { name: "", birthdate: "", photoDataUrl: null };
}

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/**
 * 페어링 위저드 (와이어프레임 P-04).
 * 3단계: (1) 아이 수 → (2) 아이 사진·이름 → (3) 연결 코드 만들기.
 * - 아이 수는 maxChildrenFor(tier) 로 상한(무료 1명 / 프리미엄 2명). 초과 선택 잠금.
 * - 색상·캐릭터 선택 UI 제거 — 테마색은 서버 저장 시 자동 배정(defaultChildColor).
 * 주 보호자면 아이(placeholder) 사진·이름을 서버에 생성한 뒤 코드를 발급한다.
 * 아이 기기가 코드로 연결하면 이 placeholder 를 자동으로 이어받는다.
 */
export function PairingWizard() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { show } = useToast();
  const familyQuery = useMyFamily();
  const family = familyQuery.data;
  const regen = useRegeneratePairCode();
  const createChildren = useCreateChildren();
  const busy = regen.isPending || createChildren.isPending;

  // 티어 상한(ready=false → unknown → 보수적으로 1명).
  const entitlementQuery = useEntitlement();
  const { ready, tier } = entitlementQuery;
  const pairingQueryState = resolveQueryTruthState([
    { isLoading: familyQuery.isLoading, isError: familyQuery.isError },
    { isLoading: entitlementQuery.isLoading, isError: entitlementQuery.isError },
  ]);
  const pairingDataMissing = pairingQueryState === "ready" && (!family || !ready);
  const pairingRefetching = familyQuery.isFetching || entitlementQuery.isFetching;
  const retryPairingWizard = async (): Promise<void> => {
    await Promise.all([familyQuery.refetch(), entitlementQuery.refetch()]);
  };
  const gatesReady = pairingQueryState === "ready" && ready && !entitlementQuery.isError && !!family;
  // /family/mine은 비활성 자녀를 제외하므로 여기서 센 child 행은 모두 활성 자녀다.
  const existingChildCount = useMemo(
    () => (family?.members ?? []).filter((m) => m.role === "child").length,
    [family],
  );
  const resolveAddition = (requestedChildCount: number) => resolveChildAddGate({
    ready: gatesReady,
    isError: entitlementQuery.isError || familyQuery.isError,
    tier,
    activeChildCount: existingChildCount,
    requestedChildCount,
  });
  const currentAddDecision = resolveAddition(1);
  const remainingSlots = currentAddDecision.remainingSlots;
  const noSlots = gatesReady && remainingSlots <= 0;
  const gateMessage = "가족·구독 정보를 확인 중이에요. 잠시 후 다시 시도해 주세요";
  const childLimitMessage =
    tier === TIERS.PREMIUM
      ? "프리미엄은 아이 2명까지 연결할 수 있어요"
      : lockMessageFor(FEATURES.MULTI_CHILD);

  const [step, setStep] = useState<Step>(1);
  const [count, setCount] = useState(1);
  const [children, setChildren] = useState<ChildDraft[]>([emptyChild()]);
  const [processingIndex, setProcessingIndex] = useState<number | null>(null);
  const [upsellOpen, setUpsellOpen] = useState(false);
  const todayStr = useMemo(() => toDateInputValue(new Date()), []);
  const fileRefs = useRef<Array<HTMLInputElement | null>>([]);

  // 티어/기존 아이 수가 바뀌면 선택 수를 남은 슬롯으로 클램프.
  useEffect(() => {
    const safeMax = Math.max(1, remainingSlots || 1);
    setCount((c) => Math.min(c, safeMax));
    setChildren((list) => (list.length > safeMax ? list.slice(0, safeMax) : list));
  }, [remainingSlots]);

  const handleBlockedAddition = (decision: ChildAddGateDecision): boolean => {
    if (decision.status === "allowed") return true;
    if (decision.status === "premium_required") {
      setUpsellOpen(true);
      return false;
    }
    show(
      decision.status === "limit_reached" ? childLimitMessage : gateMessage,
      decision.status === "unavailable" ? "⏳" : "🔒",
    );
    return false;
  };

  const selectCount = (n: number) => {
    const addDecision = resolveAddition(n);
    if (!handleBlockedAddition(addDecision)) return;
    setCount(n);
    setChildren((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? emptyChild()));
  };

  const updateChild = (index: number, patch: Partial<ChildDraft>) =>
    setChildren((list) => list.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const onPick = async (index: number, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
    setProcessingIndex(index);
    try {
      const dataUrl = await resizeImageFileSafe(file, { maxEdge: 1280, quality: 0.8 });
      if (!dataUrl) {
        show("사진을 불러오지 못했어요", "⚠️");
        return;
      }
      updateChild(index, { photoDataUrl: dataUrl });
    } finally {
      setProcessingIndex(null);
    }
  };

  const childRequirements = useMemo(() => validateChildDraftRequirements(children), [children]);
  const childInfoReady = childRequirements.ok;

  const back = () => {
    if (step === 1) navigate(-1);
    else setStep((step - 1) as Step);
  };

  const next = () => {
    if (step === 1) {
      const addDecision = resolveAddition(count);
      if (!handleBlockedAddition(addDecision)) return;
      setStep(2);
    }
    else if (step === 2) {
      if (!childRequirements.ok) {
        show(childRequirements.message, "🎂");
        return;
      }
      setStep(3);
    }
  };

  // 실 연결 코드 발급(부모만) → 성공 시 초대코드·QR 화면으로 정보 전달.
  const issueCode = (pendingChildren = children) => {
    regen.mutate(undefined, {
      onSuccess: () => {
        show("연결 코드를 만들었어요", "🔗");
        navigate("/child-invite", { state: { pendingChildren } });
      },
      onError: (e) => show(localizeApiError(e, intl, "formal"), "⚠️"),
    });
  };

  const makeCode = () => {
    if (busy) return;
    const addDecision = resolveAddition(children.length);
    if (!handleBlockedAddition(addDecision)) return;
    const required = validateChildDraftRequirements(children);
    if (!required.ok) {
      show(required.message, "🎂");
      setStep(2);
      return;
    }
    const validChildren = required.children.map((child, i) => ({
      ...children[i],
      name: child.name,
      birthdate: child.birthdate,
    }));
    // 주 보호자면 아이 placeholder(사진·이름)를 서버에 먼저 생성한 뒤 코드를 발급한다.
    const canCreate = !!family?.isPrimaryParent && !!family.familyId;
    if (!canCreate) {
      issueCode(validChildren);
      return;
    }
    createChildren.mutate(
      {
        parentName: family?.myName || family?.parentName || "부모",
        plannedChildCount: existingChildCount + validChildren.length,
        startOrder: existingChildCount,
        children: validChildren.map((c) => ({
          name: c.name.trim(),
          birthdate: c.birthdate,
          photoDataUrl: c.photoDataUrl ?? undefined,
        })),
      },
      {
        onSuccess: () => issueCode(validChildren),
        onError: (e) => show(localizeApiError(e, intl, "formal"), "⚠️"),
      },
    );
  };

  if (pairingQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle="아이 연결"
        state="loading"
        heading="연결 가능 인원을 확인하고 있어요"
        description="현재 가족과 구독 한도를 불러오는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (pairingQueryState === "error" || pairingDataMissing) {
    return (
      <ScreenQueryState
        screenTitle="아이 연결"
        state="error"
        heading="아이 연결 정보를 확인하지 못했어요"
        description="기존 아이가 밀리지 않도록 연결 한도가 확인될 때까지 진행하지 않아요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryPairingWizard()}
        retrying={pairingRefetching}
      />
    );
  }

  return (
    <div className="pw-root">
      <header className="pw-header">
        <button type="button" className="hy-iconbtn hy-press pw-back" aria-label="뒤로" onClick={back}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="pw-title">아이 연결</span>
      </header>

      <div className="pw-content">
        {existingChildCount === 0 && (
          <div className="sqs-inline-empty">
            <span>아직 연결된 아이가 없어요. 첫 아이 정보를 차례로 입력해 주세요.</span>
          </div>
        )}
        {/* 진행 표시 */}
        <div className="pw-progress" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= step ? "pw-progress__seg on" : "pw-progress__seg"} />
          ))}
        </div>
        <div className="pw-steplabel">
          {step} / 3 · {step === 1 ? "아이 수" : step === 2 ? "아이 정보" : "연결 코드"}
        </div>

        {/* ── STEP 1 : 아이 수 ── */}
        {step === 1 && (
          <>
            <div className="pw-lead">몇 명을 연결할까요?</div>
            <div className="pw-count-grid">
              {COUNTS.map((n) => {
                const optionDecision = resolveAddition(n);
                const locked = optionDecision.status !== "allowed";
                return (
                  <button
                    key={n}
                    type="button"
                    className={`${n === count ? "pw-count on" : "pw-count"}${locked ? " locked" : ""} hy-press`}
                    onClick={() => selectCount(n)}
                    aria-disabled={locked}
                  >
                    <span className="pw-count__n">{n}</span>
                    <span className="pw-count__u">
                      {optionDecision.status === "unavailable"
                        ? "확인 중"
                        : optionDecision.status === "premium_required"
                          ? "프리미엄"
                          : optionDecision.status === "limit_reached"
                            ? "최대"
                            : "명"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="pw-note hy-explain">
              {!gatesReady
                ? "가족과 구독 정보를 확인한 뒤 아이 연결을 진행해 주세요."
                : noSlots
                ? childLimitMessage
                : "첫째 아이는 무료, 둘째부터는 프리미엄이에요."}
            </p>
          </>
        )}

        {/* ── STEP 2 : 아이 정보(사진 + 이름 + 생년월일) ── */}
        {step === 2 && (
          <>
            <div className="pw-lead">아이 사진과 정보를 알려 주세요</div>
            {children.map((child, i) => (
              <div key={i} className="pw-childcard">
                <div className="pw-childcard__head">아이 {i + 1}</div>

                <div className="pw-photorow">
                  <button
                    type="button"
                    className="pw-photo hy-press"
                    onClick={() => fileRefs.current[i]?.click()}
                    disabled={processingIndex === i}
                    aria-label="사진 선택"
                  >
                    {child.photoDataUrl ? (
                      <img src={child.photoDataUrl} alt="" />
                    ) : (
                      <span className="pw-photo__empty">
                        <Camera size={24} strokeWidth={2} />
                      </span>
                    )}
                    <span className="pw-photo__edit" aria-hidden="true">
                      <Camera size={13} strokeWidth={2.4} color="#fff" />
                    </span>
                  </button>
                  <input
                    ref={(el) => {
                      fileRefs.current[i] = el;
                    }}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => onPick(i, e)}
                  />
                  <label className="pw-field pw-photorow__field">
                    <span className="pw-flabel">이름 *</span>
                    <input
                      className="pw-input"
                      value={child.name}
                      onChange={(e) => updateChild(i, { name: e.target.value })}
                      placeholder="이름"
                      maxLength={20}
                    />
                  </label>
                </div>
                <label className="pw-field">
                  <span className="pw-flabel">생년월일 *</span>
                  <input
                    className="pw-input pw-input--date"
                    type="date"
                    value={child.birthdate}
                    max={todayStr}
                    onChange={(e) => updateChild(i, { birthdate: e.target.value })}
                  />
                </label>
              </div>
            ))}
            <p className="pw-note hy-explain">
              생년월일은 AI 친구가 아이 나이에 맞게 말하도록 꼭 필요해요. 사진은 연결 후에도 추가할 수 있어요.
            </p>
          </>
        )}

        {/* ── STEP 3 : 연결 코드 만들기 ── */}
        {step === 3 && (
          <>
            <div className="pw-lead">연결 코드를 만들어요</div>
            <div className="pw-summary">
              {children.map((child, i) => (
                <div key={i} className="pw-summary__row">
                  {child.photoDataUrl ? (
                    <img className="pw-summary__photo" src={child.photoDataUrl} alt="" />
                  ) : (
                    <span className="pw-summary__photo pw-summary__photo--empty">
                      <Camera size={16} strokeWidth={2.2} />
                    </span>
                  )}
                  <span className="pw-summary__name">
                    {child.name.trim() || `아이 ${i + 1}`}
                    <small>{child.birthdate}</small>
                  </span>
                </div>
              ))}
            </div>
            <p className="pw-note hy-explain">
              {family?.isPrimaryParent
                ? (
                  <span className="hy-explain__lines">
                    <span className="hy-explain__line">연결 코드를 만들면 아이 정보(사진·이름·생년월일·테마색)가 저장돼요.</span>
                    <span className="hy-explain__line">아이 기기에서 코드를 입력하면 이 정보를 이어받아 연결돼요.</span>
                  </span>
                )
                : (
                  <span className="hy-explain__lines">
                    <span className="hy-explain__line">주 보호자만 아이 정보를 서버에 저장할 수 있어요.</span>
                    <span className="hy-explain__line">지금 만든 정보는 초대 화면에 미리보기로 전달돼요.</span>
                  </span>
                )}
            </p>
          </>
        )}
      </div>

      {/* 하단 고정 CTA */}
      <div className="pw-footer">
        {step < 3 ? (
          <button type="button" className="pw-cta hy-press" onClick={next} disabled={step === 2 && !childInfoReady}>
            {step === 1 ? "다음" : "다음 · 연결 코드 만들기"}
          </button>
        ) : (
          <button type="button" className="pw-cta hy-press" onClick={makeCode} disabled={busy} aria-busy={busy}>
            {busy ? "코드 만드는 중…" : "연결 코드 만들기"}
          </button>
        )}
      </div>
      <PremiumUpsell
        open={upsellOpen}
        source="second_child"
        tier={tier}
        returnTo="/pairing-wizard"
        onClose={() => setUpsellOpen(false)}
        onUpgrade={({ source, feature, returnTo }) => {
          const storage = browserPremiumReturnIntentStorage();
          const saved = storage && returnTo
            ? savePremiumReturnIntent(storage, { source, feature, returnTo })
            : false;
          if (!saved) throw new Error("아이 연결 복귀 경로를 안전하게 보관하지 못했어요. 잠시 후 다시 시도해 주세요.");
          setUpsellOpen(false);
          navigate("/subscription");
        }}
      />
    </div>
  );
}
