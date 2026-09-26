import { useEffect, useMemo, useRef, useState } from "react";
import { DateField } from "@/components/ui/DateField";
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
  // 프리미엄 최대 인원이 이미 연결됐으면 고를 인원이 없다 — 업셀 대신 연결 관리로 안내한다.
  const premiumFull = noSlots && currentAddDecision.status === "limit_reached";
  const gateMessage = intl.formatMessage({ id: "parent.pairingWizard.gateMessage" });
  const childLimitMessage =
    tier === TIERS.PREMIUM
      ? intl.formatMessage({ id: "parent.pairingWizard.premiumLimit" })
      : lockMessageFor(FEATURES.MULTI_CHILD, intl);

  const [step, setStep] = useState<Step>(1);
  const [count, setCount] = useState(1);
  // 이미 아이가 있는 가족이 "아이 추가"로 들어오면 남은 자리는 한 명뿐이라(프리미엄 최대 2명)
  // "몇 명을 연결할까요?"는 고를 것이 없는 단계다. 바로 아이 정보부터 받는다.
  const skipCountStep = existingChildCount >= 1;
  const firstStep: Step = skipCountStep ? 2 : 1;
  const visibleSteps: Step[] = skipCountStep ? [2, 3] : [1, 2, 3];
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

  // 아이 추가 모드: 권한 확인이 끝나고 한 명을 더 연결할 수 있으면 곧바로 정보 단계로 넘어간다.
  // 무료 가족(둘째는 프리미엄)·최대 인원은 1단계에 남아 이유와 다음 행동을 보여 준다.
  useEffect(() => {
    if (!skipCountStep || step !== 1 || !gatesReady) return;
    if (currentAddDecision.status !== "allowed") return;
    setCount(1);
    setChildren((list) => list.slice(0, 1));
    setStep(2);
  }, [skipCountStep, step, gatesReady, currentAddDecision.status]);

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
        show(intl.formatMessage({ id: "parent.pairingWizard.photoError" }), "⚠️");
        return;
      }
      updateChild(index, { photoDataUrl: dataUrl });
    } finally {
      setProcessingIndex(null);
    }
  };

  const childRequirements = useMemo(() => validateChildDraftRequirements(children), [children]);
  const childInfoReady = childRequirements.ok;
  const requirementMessage = (
    result: Exclude<ReturnType<typeof validateChildDraftRequirements>, { ok: true }>,
  ): string => {
    const childNumber = intl.formatNumber(result.index + 1);
    return intl.formatMessage(
      {
        id: children[result.index]?.name.trim()
          ? "parent.pairingWizard.missingBirthdate"
          : "parent.pairingWizard.missingName",
      },
      { childNumber },
    );
  };

  const back = () => {
    if (step <= firstStep) navigate(-1);
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
        show(requirementMessage(childRequirements), "🎂");
        return;
      }
      setStep(3);
    }
  };

  // 실 연결 코드 발급(부모만) → 성공 시 초대코드·QR 화면으로 정보 전달.
  const issueCode = (pendingChildren = children) => {
    regen.mutate(undefined, {
      onSuccess: () => {
        show(intl.formatMessage({ id: "parent.pairingWizard.codeCreated" }), "🔗");
        navigate("/child-invite?role=child", { state: { pendingChildren } });
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
      show(requirementMessage(required), "🎂");
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
        parentName:
          family?.myName ||
          family?.parentName ||
          intl.formatMessage({ id: "parent.pairingWizard.parentFallback" }),
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
        screenTitle={intl.formatMessage({ id: "parent.pairingWizard.screenTitle" })}
        state="loading"
        heading={intl.formatMessage({ id: "parent.pairingWizard.loadingHeading" })}
        description={intl.formatMessage({ id: "parent.pairingWizard.loadingDescription" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (pairingQueryState === "error" || pairingDataMissing) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "parent.pairingWizard.screenTitle" })}
        state="error"
        heading={intl.formatMessage({ id: "parent.pairingWizard.errorHeading" })}
        description={intl.formatMessage({ id: "parent.pairingWizard.errorDescription" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryPairingWizard()}
        retrying={pairingRefetching}
      />
    );
  }

  return (
    <div className="pw-root">
      <header className="pw-header">
        <button
          type="button"
          className="hy-iconbtn hy-press pw-back"
          aria-label={intl.formatMessage({ id: "parent.pairingWizard.back" })}
          onClick={back}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="pw-title">
          {intl.formatMessage({ id: "parent.pairingWizard.screenTitle" })}
        </span>
      </header>

      <div className="pw-content">
        {existingChildCount === 0 && (
          <div className="sqs-inline-empty">
            <span>{intl.formatMessage({ id: "parent.pairingWizard.empty" })}</span>
          </div>
        )}
        {/* 진행 표시 */}
        {/* 고를 단계가 없는 화면(최대 인원·둘째 프리미엄 안내)에는 진행 표시를 두지 않는다. */}
        {!(step === 1 && (premiumFull || skipCountStep)) && (<>
        <div className="pw-progress" aria-hidden="true">
          {visibleSteps.map((n) => (
            <span key={n} className={n <= step ? "pw-progress__seg on" : "pw-progress__seg"} />
          ))}
        </div>
        <div className="pw-steplabel">
          {intl.formatMessage(
            { id: "parent.pairingWizard.stepLabel" },
            {
              step: intl.formatNumber(Math.max(1, visibleSteps.indexOf(step) + 1)),
              total: intl.formatNumber(visibleSteps.length),
              title: intl.formatMessage({
                id:
                  step === 1
                    ? "parent.pairingWizard.stepCount"
                    : step === 2
                      ? "parent.pairingWizard.stepInfo"
                      : "parent.pairingWizard.stepCode",
              }),
            },
          )}
        </div>
        </>)}

        {/* ── STEP 1 : 아이 수 ── */}
        {step === 1 && premiumFull && (
          <p className="pw-note hy-explain" role="status">
            {intl.formatMessage({ id: "parent.pairingWizard.full" }, { count: existingChildCount })}
          </p>
        )}
        {step === 1 && !premiumFull && skipCountStep && (
          <p className="pw-note hy-explain" role="status">
            {!gatesReady ? intl.formatMessage({ id: "parent.pairingWizard.gateNote" }) : childLimitMessage}
          </p>
        )}
        {step === 1 && !premiumFull && !skipCountStep && (
          <>
            <div className="pw-lead">
              {intl.formatMessage({ id: "parent.pairingWizard.countLead" })}
            </div>
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
                    <span className="pw-count__n">{intl.formatNumber(n)}</span>
                    <span className="pw-count__u">
                      {optionDecision.status === "unavailable"
                        ? intl.formatMessage({ id: "parent.pairingWizard.checking" })
                        : optionDecision.status === "premium_required"
                          ? intl.formatMessage({ id: "parent.pairingWizard.statusPremium" })
                          : optionDecision.status === "limit_reached"
                            ? intl.formatMessage({ id: "parent.pairingWizard.statusMax" })
                            : intl.formatMessage({ id: "parent.pairingWizard.unitChild" })}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="pw-note hy-explain">
              {!gatesReady
                ? intl.formatMessage({ id: "parent.pairingWizard.gateNote" })
                : noSlots
                ? childLimitMessage
                : intl.formatMessage({ id: "parent.pairingWizard.firstFree" })}
            </p>
          </>
        )}

        {/* ── STEP 2 : 아이 정보(사진 + 이름 + 생년월일) ── */}
        {step === 2 && (
          <>
            <div className="pw-lead">
              {intl.formatMessage({ id: "parent.pairingWizard.infoLead" })}
            </div>
            {children.map((child, i) => (
              <div key={i} className="pw-childcard">
                {/* 이미 연결된 아이가 있으면 번호를 이어서 센다 — 둘째를 추가하는데 "아이 1"로 보였다(2026-09-26). */}
                <div className="pw-childcard__head">
                  {intl.formatMessage(
                    { id: "parent.pairingWizard.childLabel" },
                    { number: intl.formatNumber(existingChildCount + i + 1) },
                  )}
                </div>

                <div className="pw-photorow">
                  <button
                    type="button"
                    className="pw-photo hy-press"
                    onClick={() => fileRefs.current[i]?.click()}
                    disabled={processingIndex === i}
                    aria-label={intl.formatMessage({ id: "parent.pairingWizard.photoAria" })}
                  >
                    {child.photoDataUrl ? (
                      <img src={child.photoDataUrl} alt="" />
                    ) : (
                      <span className="pw-photo__empty">
                        <Camera size={24} strokeWidth={2} />
                      </span>
                    )}
                    {/* 빈 칸은 가운데 카메라가 이미 '사진 넣기'를 말한다 — 편집 배지는 사진이 있을 때만(카메라 두 개 중복). */}
                    {child.photoDataUrl && (
                      <span className="pw-photo__edit" aria-hidden="true">
                        <Camera size={13} strokeWidth={2.4} color="#fff" />
                      </span>
                    )}
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
                    <span className="pw-flabel">
                      {intl.formatMessage({ id: "parent.pairingWizard.nameLabel" })}
                    </span>
                    <input
                      className="pw-input"
                      value={child.name}
                      onChange={(e) => updateChild(i, { name: e.target.value })}
                      placeholder={intl.formatMessage({ id: "parent.pairingWizard.namePlaceholder" })}
                      maxLength={20}
                    />
                  </label>
                </div>
                <label className="pw-field">
                  <span className="pw-flabel">
                    {intl.formatMessage({ id: "parent.pairingWizard.birthdateLabel" })}
                  </span>
                  <DateField
                    className="pw-input pw-input--date"
                    placeholder={intl.formatMessage({ id: "parent.pairingWizard.birthdatePlaceholder" })}
                    value={child.birthdate}
                    max={todayStr}
                    onChange={(e) => updateChild(i, { birthdate: e.target.value })}
                  />
                </label>
              </div>
            ))}
            <p className="pw-note hy-explain">
              {intl.formatMessage({ id: "parent.pairingWizard.birthdateNote" })}
            </p>
          </>
        )}

        {/* ── STEP 3 : 연결 코드 만들기 ── */}
        {step === 3 && (
          <>
            <div className="pw-lead">
              {intl.formatMessage({ id: "parent.pairingWizard.codeLead" })}
            </div>
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
                    {child.name.trim() || intl.formatMessage(
                      { id: "parent.pairingWizard.childFallback" },
                      { number: intl.formatNumber(i + 1) },
                    )}
                    <small>{child.birthdate}</small>
                  </span>
                </div>
              ))}
            </div>
            <p className="pw-note hy-explain">
              {family?.isPrimaryParent
                ? (
                  <span className="hy-explain__lines">
                    <span className="hy-explain__line">
                      {intl.formatMessage({ id: "parent.pairingWizard.primarySaveLine" })}
                    </span>
                    <span className="hy-explain__line">
                      {intl.formatMessage({ id: "parent.pairingWizard.primaryInheritLine" })}
                    </span>
                  </span>
                )
                : (
                  <span className="hy-explain__lines">
                    <span className="hy-explain__line">
                      {intl.formatMessage({ id: "parent.pairingWizard.secondarySaveLine" })}
                    </span>
                    <span className="hy-explain__line">
                      {intl.formatMessage({ id: "parent.pairingWizard.secondaryPreviewLine" })}
                    </span>
                  </span>
                )}
            </p>
          </>
        )}
      </div>

      {/* 하단 고정 CTA */}
      <div className="pw-footer">
        {step === 1 && premiumFull ? (
          <button type="button" className="pw-cta hy-press" onClick={() => navigate("/family-connection")}>
            {intl.formatMessage({ id: "parent.pairingWizard.manageConnections" })}
          </button>
        ) : step < 3 ? (
          <button type="button" className="pw-cta hy-press" onClick={next} disabled={step === 2 && !childInfoReady}>
            {intl.formatMessage({
              id: step === 1
                ? "parent.pairingWizard.next"
                : "parent.pairingWizard.nextCode",
            })}
          </button>
        ) : (
          <button type="button" className="pw-cta hy-press" onClick={makeCode} disabled={busy} aria-busy={busy}>
            {intl.formatMessage({
              id: busy
                ? "parent.pairingWizard.creating"
                : "parent.pairingWizard.create",
            })}
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
          if (!saved) {
            throw new Error(intl.formatMessage({ id: "parent.family.returnIntentFailed" }));
          }
          setUpsellOpen(false);
          navigate("/subscription");
        }}
      />
    </div>
  );
}
