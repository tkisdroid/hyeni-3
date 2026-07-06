import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Camera } from "lucide-react";
import { useToast } from "@/app/toast";
import { useMyFamily, useRegeneratePairCode, useCreateChildren } from "@/queries/useFamily";
import { useEntitlement } from "@/queries/useEntitlement";
import { tierFrom, maxChildrenFor } from "@/transform/tierPolicy";
import { resizeImageFileSafe } from "@/lib/imageResize";
import "./PairingWizard.css";

type Step = 1 | 2 | 3;

interface ChildDraft {
  name: string;
  /** 미업로드 data:URL(선택). 코드 생성 시 order 기반 경로로 업로드된다. */
  photoDataUrl: string | null;
}

// 선택 가능한 최대치는 프리미엄 2명 → 후보는 [1, 2]. 티어 상한 초과는 잠금.
const COUNTS = [1, 2] as const;

function emptyChild(): ChildDraft {
  return { name: "", photoDataUrl: null };
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
  const { data: family } = useMyFamily();
  const regen = useRegeneratePairCode();
  const createChildren = useCreateChildren();
  const busy = regen.isPending || createChildren.isPending;

  // 티어 상한(ready=false → unknown → 보수적으로 1명).
  const { ready, isPremium } = useEntitlement();
  const tier = tierFrom({ ready, isPremium });
  const maxChildren = maxChildrenFor(tier);

  const [step, setStep] = useState<Step>(1);
  const [count, setCount] = useState(1);
  const [children, setChildren] = useState<ChildDraft[]>([emptyChild()]);
  const [processingIndex, setProcessingIndex] = useState<number | null>(null);
  const fileRefs = useRef<Array<HTMLInputElement | null>>([]);

  // 티어 상한이 낮아지면(엔타이틀먼트 로드 후) 선택 수를 상한으로 클램프.
  useEffect(() => {
    setCount((c) => Math.min(c, maxChildren));
    setChildren((list) => (list.length > maxChildren ? list.slice(0, maxChildren) : list));
  }, [maxChildren]);

  const selectCount = (n: number) => {
    if (n > maxChildren) {
      show("두 번째 아이는 프리미엄에서 연결할 수 있어요", "⭐");
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

  const allNamed = useMemo(() => children.every((c) => c.name.trim().length > 0), [children]);

  const back = () => {
    if (step === 1) navigate(-1);
    else setStep((step - 1) as Step);
  };

  const next = () => {
    if (step === 1) setStep(2);
    else if (step === 2 && allNamed) setStep(3);
  };

  // 실 연결 코드 발급(부모만) → 성공 시 초대코드·QR 화면으로 정보 전달.
  const issueCode = () => {
    regen.mutate(undefined, {
      onSuccess: () => {
        show("연결 코드를 만들었어요", "🔗");
        navigate("/child-invite", { state: { pendingChildren: children } });
      },
      onError: (e) => show(e instanceof Error ? e.message : "코드 생성에 실패했어요", "⚠️"),
    });
  };

  const makeCode = () => {
    if (busy) return;
    // 주 보호자면 아이 placeholder(사진·이름)를 서버에 먼저 생성한 뒤 코드를 발급한다.
    const canCreate = !!family?.isPrimaryParent && !!family.familyId;
    if (!canCreate) {
      issueCode();
      return;
    }
    const existingChildCount = (family?.members ?? []).filter((m) => m.role === "child").length;
    createChildren.mutate(
      {
        parentName: family?.myName || family?.parentName || "부모",
        plannedChildCount: existingChildCount + children.length,
        startOrder: existingChildCount,
        children: children.map((c) => ({
          name: c.name.trim(),
          photoDataUrl: c.photoDataUrl ?? undefined,
        })),
      },
      {
        onSuccess: issueCode,
        onError: (e) => show(e instanceof Error ? e.message : "아이 정보 저장에 실패했어요", "⚠️"),
      },
    );
  };

  return (
    <div className="pw-root">
      <header className="pw-header">
        <button type="button" className="hy-iconbtn hy-press pw-back" aria-label="뒤로" onClick={back}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="pw-title">아이 연결</span>
      </header>

      <div className="pw-content">
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
                const locked = n > maxChildren;
                return (
                  <button
                    key={n}
                    type="button"
                    className={`${n === count ? "pw-count on" : "pw-count"}${locked ? " locked" : ""} hy-press`}
                    onClick={() => selectCount(n)}
                    aria-disabled={locked}
                  >
                    <span className="pw-count__n">{n}</span>
                    <span className="pw-count__u">{locked ? "프리미엄" : "명"}</span>
                  </button>
                );
              })}
            </div>
            <p className="pw-note">
              아이 1명은 무료예요. 두 번째 아이는 프리미엄(아이별 월 2,900원)에서 연결할 수 있어요.
            </p>
          </>
        )}

        {/* ── STEP 2 : 아이 정보(사진 + 이름) ── */}
        {step === 2 && (
          <>
            <div className="pw-lead">아이 사진과 이름을 알려주세요</div>
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
              </div>
            ))}
            <p className="pw-note">사진은 선택이에요 — 지금 넣지 않아도 연결 후 프로필에서 추가할 수 있어요.</p>
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
                  <span className="pw-summary__name">{child.name.trim() || `아이 ${i + 1}`}</span>
                </div>
              ))}
            </div>
            <p className="pw-note">
              {family?.isPrimaryParent
                ? "연결 코드를 만들면 아이 정보(사진·이름·테마색)가 저장돼요. 아이 기기에서 코드를 입력하면 이 정보를 이어받아 연결돼요."
                : "주 보호자만 아이 정보를 서버에 저장할 수 있어요. 지금 만든 정보는 초대 화면에 미리보기로 전달돼요."}
            </p>
          </>
        )}
      </div>

      {/* 하단 고정 CTA */}
      <div className="pw-footer">
        {step < 3 ? (
          <button type="button" className="pw-cta hy-press" onClick={next} disabled={step === 2 && !allNamed}>
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
