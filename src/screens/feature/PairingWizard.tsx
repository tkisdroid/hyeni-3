import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Camera } from "lucide-react";
import { useToast } from "@/app/toast";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { useMyFamily, useRegeneratePairCode, useCreateChildren } from "@/queries/useFamily";
import { useEntitlement } from "@/queries/useEntitlement";
import { FEATURES, TIERS, tierFrom, maxChildrenFor, lockMessageFor } from "@/transform/tierPolicy";
import { validateChildDraftRequirements } from "@/transform/childProfileRequirements";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import { resizeImageFileSafe } from "@/lib/imageResize";
import "./PairingWizard.css";

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
  const navigate = useNavigate();
  const { show } = useToast();
  const familyQuery = useMyFamily();
  const family = familyQuery.data;
  const regen = useRegeneratePairCode();
  const createChildren = useCreateChildren();
  const busy = regen.isPending || createChildren.isPending;

  // 티어 상한(ready=false → unknown → 보수적으로 1명).
  const entitlementQuery = useEntitlement();
  const { ready, isPremium } = entitlementQuery;
  const pairingQueryState = resolveQueryTruthState([
    { isLoading: familyQuery.isLoading, isError: familyQuery.isError },
    { isLoading: entitlementQuery.isLoading, isError: entitlementQuery.isError },
  ]);
  const pairingDataMissing = pairingQueryState === "ready" && (!family || !ready);
  const pairingRefetching = familyQuery.isFetching || entitlementQuery.isFetching;
  const retryPairingWizard = async (): Promise<void> => {
    await Promise.all([familyQuery.refetch(), entitlementQuery.refetch()]);
  };
  const tier = tierFrom({ ready, isPremium });
  const maxChildren = maxChildrenFor(tier);
  const gatesReady = pairingQueryState === "ready" && ready && !!family;
  const existingChildCount = useMemo(
    () => (family?.members ?? []).filter((m) => m.role === "child").length,
    [family],
  );
  const remainingSlots = gatesReady ? Math.max(0, maxChildren - existingChildCount) : maxChildren;
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
  const todayStr = useMemo(() => toDateInputValue(new Date()), []);
  const fileRefs = useRef<Array<HTMLInputElement | null>>([]);

  // 티어/기존 아이 수가 바뀌면 선택 수를 남은 슬롯으로 클램프.
  useEffect(() => {
    const safeMax = Math.max(1, remainingSlots || 1);
    setCount((c) => Math.min(c, safeMax));
    setChildren((list) => (list.length > safeMax ? list.slice(0, safeMax) : list));
  }, [remainingSlots]);

  const selectCount = (n: number) => {
    if (!gatesReady && n > maxChildren) {
      show(gateMessage, "⏳");
      return;
    }
    if (noSlots || n > remainingSlots) {
      show(gatesReady ? childLimitMessage : gateMessage, "🔒");
      return;
    }
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
      if (!gatesReady) {
        show(gateMessage, "⏳");
        return;
      }
      if (noSlots) {
        show(childLimitMessage, "🔒");
        navigate("/subscription");
        return;
      }
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
      onError: (e) => show(e instanceof Error ? e.message : "코드 생성에 실패했어요", "⚠️"),
    });
  };

  const makeCode = () => {
    if (busy) return;
    if (!gatesReady) {
      show(gateMessage, "⏳");
      return;
    }
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
    if (existingChildCount + children.length > maxChildren) {
      show(childLimitMessage, "🔒");
      navigate("/subscription");
      return;
    }
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
        onError: (e) => show(e instanceof Error ? e.message : "아이 정보 저장에 실패했어요", "⚠️"),
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
                const locked = !gatesReady ? n > maxChildren : noSlots || n > remainingSlots;
                return (
                  <button
                    key={n}
                    type="button"
                    className={`${n === count ? "pw-count on" : "pw-count"}${locked ? " locked" : ""} hy-press`}
                    onClick={() => selectCount(n)}
                    aria-disabled={locked}
                  >
                    <span className="pw-count__n">{n}</span>
                    <span className="pw-count__u">{locked ? (!gatesReady ? "확인 중" : "프리미엄") : "명"}</span>
                  </button>
                );
              })}
            </div>
            <p className="pw-note">
              {!gatesReady
                ? "가족과 구독 정보를 확인한 뒤 아이 연결을 진행해 주세요."
                : noSlots
                ? childLimitMessage
                : "아이 1명은 무료예요. 두 번째 아이는 프리미엄에서 연결할 수 있어요."}
            </p>
          </>
        )}

        {/* ── STEP 2 : 아이 정보(사진 + 이름 + 생년월일) ── */}
        {step === 2 && (
          <>
            <div className="pw-lead">아이 사진과 정보를 알려주세요</div>
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
            <p className="pw-note">
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
            <p className="pw-note">
              {family?.isPrimaryParent
                ? "연결 코드를 만들면 아이 정보(사진·이름·생년월일·테마색)가 저장돼요. 아이 기기에서 코드를 입력하면 이 정보를 이어받아 연결돼요."
                : "주 보호자만 아이 정보를 서버에 저장할 수 있어요. 지금 만든 정보는 초대 화면에 미리보기로 전달돼요."}
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
          <button type="button" className="pw-cta hy-press" onClick={makeCode} disabled={busy}>
            {busy ? "코드 만드는 중…" : "연결 코드 만들기"}
          </button>
        )}
      </div>
    </div>
  );
}
