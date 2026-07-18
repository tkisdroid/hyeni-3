import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, ChevronLeft, ChevronRight, Link2 } from "lucide-react";
import { asset } from "@/lib/assets";
import { DEFAULT_CHILD_AVATAR } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { deriveAuthState, useAuth } from "@/auth/AuthContext";
import { homePathForRole } from "@/auth/guards";
import {
  beginOnboardingAuthTransition,
  cancelOnboardingAuthTransitions,
  commitOnboardingAuthResult,
  completeOnboardingAuthTransitionsThrough,
  endOnboardingAuthTransition,
  getOnboardingAuthCommitSnapshot,
  getOnboardingAuthTransitionSnapshot,
  isOnboardingAuthTransitionActive,
  subscribeOnboardingAuthTransition,
  type OnboardingAuthTransitionToken,
} from "@/auth/onboardingAuthTransition";
import { adoptNativeLocationSessionTokens } from "@/lib/native/location";
import { readChildDeviceIdentityHint } from "@/lib/native/deviceIdentity";
import { ROLE_ICON_ASSETS } from "@/transform/roleIconAssets";
import {
  signInWithLoginId,
  adoptAuthResult,
  anonymousLogin,
  requestPhoneSignupCode,
  verifyPhoneSignupCode,
  startWorkerOAuth,
  finishOAuthCancellation,
  finishOAuthLogin,
  readOAuthCancellation,
  readOAuthCallback,
  clearOAuthCallbackUrl,
  type PendingSignup,
} from "@/lib/api/endpoints/auth";
import {
  setupFamily,
  joinFamily,
  joinFamilyAsParent,
  getMyFamily,
  parentNameFromUser,
  type JoinFamilyOptions,
} from "@/lib/api/endpoints/family";
import { hasNaverClientId } from "@/config/env";
import { TEACHER_MODE_ENABLED } from "@/config/releaseFeatures";
import type { OAuthProvider } from "@/transform/oauthProvider";
import { normalizePairCodeInput } from "@/transform/pairCode";
import { readPairParam, clearPairParam } from "@/transform/pairLink";
import { resolveAuthenticatedOnboardingRedirect } from "@/transform/onboardingRedirect";
import {
  requestBackgroundLocationPermission,
  requestForegroundLocationPermission,
} from "@/lib/native/permissions";
import { QrScanner } from "@/components/QrScanner";
import { BusyLabel } from "@/components/ui/BusyLabel";
import {
  PRIVACY_POLICY_URL,
  TERMS_OF_SERVICE_URL,
} from "@/lib/api/endpoints/account";
import { validateLoginForm, type LoginFormErrors } from "@/transform/loginForm";
import {
  completeSignupPendingAction,
  isLoginNavigationLocked,
  isSignupActionPending,
  type SignupPendingAction,
} from "@/transform/asyncUiState";
import "./Onboarding.css";

type Step = "role" | "teacherSetup" | "login" | "survey" | "signup" | "connect" | "pairing" | "perms";
type Show = (text: string, emoji?: string) => void;

const CHILD_PERM_ITEMS = [
  { id: "loc", icon: "ui/pin-heart.webp", title: "위치 정보", sub: "현재 위치와 이동 경로를 보호자에게 공유해요" },
  { id: "noti", icon: "ui/bell.webp", title: "알림", sub: "일정·부모 메시지·안전 알림을 바로 받아요" },
  { id: "battery", icon: "ui/battery.webp", title: "백그라운드 실행", sub: "앱을 닫아도 도착·출발을 확인할 수 있게 해요" },
] as const;

const GUARDIAN_PERM_ITEMS = [
  { id: "noti", icon: "ui/bell.webp", title: "알림", sub: "아이의 일정·도착·위험·메시지 알림을 받아요" },
] as const;

const SURVEY_OPTIONS = [
  { id: "schedule", title: "일정 관리", sub: "학교·학원·준비물을 놓치지 않기" },
  { id: "location", title: "실시간 위치", sub: "아이 위치와 이동 경로 확인" },
  { id: "arrival", title: "등하원·학원 도착 알림", sub: "도착·이탈 소식을 바로 받기" },
  { id: "safety", title: "SOS 안전 알림", sub: "급할 때 부모님에게 빠르게 알리기" },
  { id: "ai", title: "AI 하루 요약", sub: "일정과 안전 기록을 쉽게 정리하기" },
] as const;

function errMsg(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
}

/** 온보딩: 역할선택→로그인/가입→가족연결→페어링→권한. 실제 Worker 인증 배선. */
export function Onboarding() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { syncFromSession, user, role: authRole, familyId: authFamilyId } = useAuth();
  const authTransitionActive = useSyncExternalStore(
    subscribeOnboardingAuthTransition,
    getOnboardingAuthTransitionSnapshot,
    getOnboardingAuthTransitionSnapshot,
  );
  const authCommitBoundaryActive = useSyncExternalStore(
    subscribeOnboardingAuthTransition,
    getOnboardingAuthCommitSnapshot,
    getOnboardingAuthCommitSnapshot,
  );
  const [step, setStep] = useState<Step>("role");
  const [role, setRole] = useState<"parent" | "child" | "teacher">("parent");
  const [pairMode, setPairMode] = useState<"child" | "parent">("child");
  const [busy, setBusy] = useState(false);
  const [childStarting, setChildStarting] = useState(false);
  const [childJoinHint, setChildJoinHint] = useState<JoinFamilyOptions | null>(null);
  const [signupFlowStarted, setSignupFlowStarted] = useState(false);
  const [surveyChoices, setSurveyChoices] = useState<string[]>([]);
  // 전화 OTP 가입 시 입력한 이름 — 가입 직후 세션 user_metadata 가 비어 parentNameFromUser 가
  // "부모"로 깨지므로, 이 이름을 setupFamily(새 가족)의 parentName 으로 우선 사용한다.
  const [signupName, setSignupName] = useState<string | null>(null);
  // QR 딥링크(?pair=)로 진입 시 아이 코드 프리필.
  const [pairPrefill, setPairPrefill] = useState<string | null>(null);
  const oauthLoginPromiseRef = useRef<ReturnType<typeof finishOAuthLogin> | null>(null);

  // OAuth 콜백(?code&state) 감지 → 세션 교환 → 라우팅. (guard가 미인증을 여기로 보냄)
  useEffect(() => {
    const cancellation = readOAuthCancellation();
    if (cancellation) {
      try {
        finishOAuthCancellation(cancellation);
        show("소셜 로그인을 취소했어요.", "ℹ️");
      } catch (e) {
        show(errMsg(e), "⚠️");
      } finally {
        cancelOnboardingAuthTransitions();
        clearOAuthCallbackUrl();
        setBusy(false);
        setRole("parent");
        setStep("login");
      }
      return;
    }
    const cb = readOAuthCallback();
    if (!cb) return;
    setBusy(true);
    const transitionToken = beginOnboardingAuthTransition();
    const oauthLoginPromise = oauthLoginPromiseRef.current
      ?? finishOAuthLogin(cb, { sessionAdoption: "deferred" });
    oauthLoginPromiseRef.current = oauthLoginPromise;
    oauthLoginPromise
      .then(async (result) => {
        const commitResult = commitOnboardingAuthResult(transitionToken, result, adoptAuthResult);
        if (commitResult === "stale") return;
        clearOAuthCallbackUrl();
        syncFromSession();
        await routeAfterParentLogin(transitionToken);
      })
      .catch((e) => {
        const canApplySideEffects = isOnboardingAuthTransitionActive(transitionToken);
        // 공유 Promise의 OAuth code는 단회용이라 stale continuation도 URL 재교환만 막는다.
        // toast·step·busy 같은 UI 상태는 아래 active token만 변경한다.
        clearOAuthCallbackUrl();
        if (!canApplySideEffects) return;
        show(errMsg(e), "⚠️");
        setRole("parent");
        setStep("login");
        setBusy(false);
        endOnboardingAuthTransition(transitionToken);
      })
      .finally(() => {
        if (isOnboardingAuthTransitionActive(transitionToken)) setBusy(false);
      });
    return () => endOnboardingAuthTransition(transitionToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 앱이 마지막 URL(/onboarding)로 재실행되어도, 기존 유효 세션이 있으면 역할 홈으로 복귀한다.
  useEffect(() => {
    const redirect = resolveAuthenticatedOnboardingRedirect({
      role: authRole,
      familyId: authFamilyId,
      hasOAuthCallback: !!readOAuthCallback(),
      hasPairParam: !!readPairParam(),
      authTransitionActive: authTransitionActive,
    });
    if (redirect) navigate(redirect, { replace: true });
  }, [authRole, authFamilyId, authTransitionActive, navigate]);

  // OAuth/외부 브라우저에서 복귀 시 busy 잠금 자동 해제 — stuck 방지.
  // 네이티브: 카카오/구글은 시스템 브라우저를 열고 앱을 백그라운드로 보낸다. 로그인을
  // 완료하지 않고 뒤로 오면 딥링크 콜백이 오지 않아 busy=true 가 영구히 남아 UI 가 잠긴다.
  // 앱이 다시 보이는 순간 busy 를 풀어 되살린다(성공 복귀는 딥링크가 홈으로 이동하므로 무해).
  // 웹: bfcache 뒤로가기(pageshow persisted)도 동일 처리. 초기 로드의 pageshow 는 리스너
  // 등록 전에 이미 발화하므로 OAuth 콜백 처리와 충돌하지 않는다.
  useEffect(() => {
    const unstick = () => {
      if (document.visibilityState === "visible") setBusy(false);
    };
    document.addEventListener("visibilitychange", unstick);
    window.addEventListener("pageshow", unstick);
    return () => {
      document.removeEventListener("visibilitychange", unstick);
      window.removeEventListener("pageshow", unstick);
    };
  }, []);

  // QR 딥링크(?pair=KID-XXXX)로 진입 → 익명 로그인 후 아이 페어링 단계로(코드 프리필).
  // OAuth 콜백이 동시에 있으면 그쪽을 우선한다.
  useEffect(() => {
    const code = readPairParam();
    if (!code || readOAuthCallback()) return;
    // ★세션 보호: 이미 가족에 연결된 세션이면 익명 로그인으로 덮어쓰지 않는다.
    //   (부모가 아이 초대 QR 을 자기 폰으로 스캔 → 부모 세션이 익명으로 파괴되던 실사고.)
    //   위 리다이렉트 effect 와 같은 커밋에서 실행되므로 여기서도 독립적으로 막아야 한다.
    const current = deriveAuthState();
    if (current.status === "authenticated" && current.familyId) {
      clearPairParam();
      navigate(homePathForRole(current.role), { replace: true });
      return;
    }
    clearPairParam();
    setPairPrefill(code);
    setBusy(true);
    setChildStarting(true);
    readChildDeviceIdentityHint()
      .then(async (hint) => {
        setChildJoinHint(hint);
        if (await adoptNativeLocationSessionTokens()) {
          syncFromSession();
          if (routeAfterChildSession()) return;
        }
        // 복구 Promise를 기다리는 동안 NativeBootstrap 등 다른 경로가 세션을 살렸을 수 있다.
        // 익명 로그인을 만들기 직전에 다시 확인해 정상 child 세션을 덮어쓰지 않는다.
        const recovered = deriveAuthState();
        if (recovered.status === "authenticated" && recovered.familyId) {
          syncFromSession();
          routeAfterChildSession();
          return;
        }
        await anonymousLogin();
        syncFromSession();
        setRole("child");
        setPairMode("child");
        setStep("pairing");
      })
      .catch((e) => show(errMsg(e), "⚠️"))
      .finally(() => {
        setBusy(false);
        setChildStarting(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const back = () =>
    setStep((s) =>
      s === "survey"
        ? "login"
        : s === "signup"
          ? "survey"
          : s === "pairing"
            ? "connect"
            : "role",
    );

  // 부모 로그인/가입 후: 가족 있으면 홈, 없으면 가족연결 단계.
  const routeAfterParentLogin = async (transitionToken: OnboardingAuthTransitionToken) => {
    if (!isOnboardingAuthTransitionActive(transitionToken)) return;
    syncFromSession();
    try {
      const fam = await getMyFamily();
      const completed = completeOnboardingAuthTransitionsThrough(transitionToken);
      if (!completed) return;
      setBusy(false);
      if (fam === null) {
        setStep("connect");
        return;
      }
      navigate("/parent/home");
    } catch {
      throw new Error("가족 정보를 확인하지 못했어요. 다시 시도해 주세요.");
    }
  };

  const routeAfterChildSession = () => {
    const state = deriveAuthState();
    if (state.role === "child" && state.familyId) {
      navigate("/child/home");
      return true;
    }
    if (state.role === "parent" || state.role === "teacher") {
      navigate(homePathForRole(state.role));
      return true;
    }
    setRole("child");
    setPairMode("child");
    setStep("pairing");
    return true;
  };

  const startChildMode = async () => {
    if (busy || childStarting) return;
    setBusy(true);
    setChildStarting(true);
    try {
      // ★세션 보호: 이미 가족에 연결된 세션(부모/아이)이면 새 익명 세션을 만들지 않는다.
      //   역할 선택 화면이 잘못 노출돼도 기존 로그인이 파괴되지 않게 하는 최후 방어.
      const current = deriveAuthState();
      if (current.status === "authenticated" && current.familyId) {
        navigate(homePathForRole(current.role), { replace: true });
        return;
      }
      const hint = await readChildDeviceIdentityHint();
      setChildJoinHint(hint);
      if (await adoptNativeLocationSessionTokens()) {
        syncFromSession();
        routeAfterChildSession();
        return;
      }
      const recovered = deriveAuthState();
      if (recovered.status === "authenticated" && recovered.familyId) {
        syncFromSession();
        routeAfterChildSession();
        return;
      }
      await anonymousLogin();
      syncFromSession();
      routeAfterChildSession();
    } catch (e) {
      show(errMsg(e), "⚠️");
    } finally {
      setBusy(false);
      setChildStarting(false);
    }
  };

  return (
    <div className="ob-root">
      {step === "role" && (
        <RoleStep
          busy={busy || authCommitBoundaryActive}
          childStarting={childStarting}
          onParent={() => {
            if (authCommitBoundaryActive) return;
            cancelOnboardingAuthTransitions();
            setSignupFlowStarted(false);
            setSurveyChoices([]);
            setRole("parent");
            setStep("login");
          }}
          onChild={() => {
            if (authCommitBoundaryActive) return;
            cancelOnboardingAuthTransitions();
            void startChildMode();
          }}
          onTeacher={() => {
            if (authCommitBoundaryActive) return;
            cancelOnboardingAuthTransitions();
            setRole("teacher");
            setStep("teacherSetup");
          }}
        />
      )}
      {step === "teacherSetup" && (
        <TeacherStep onBack={back} onSave={() => setStep("perms")} show={show} />
      )}
      {step === "login" && (
        <LoginStep
          busy={busy}
          setBusy={setBusy}
          commitBoundaryActive={authCommitBoundaryActive}
          onBack={() => {
            if (authCommitBoundaryActive) return;
            cancelOnboardingAuthTransitions();
            back();
          }}
          onLoggedIn={async (transitionToken) => {
            setSignupFlowStarted(false);
            setSurveyChoices([]);
            await routeAfterParentLogin(transitionToken);
          }}
          onSignup={() => {
            if (authCommitBoundaryActive) return;
            cancelOnboardingAuthTransitions();
            setSignupFlowStarted(true);
            setStep("survey");
          }}
          show={show}
        />
      )}
      {step === "survey" && (
        <SurveyStep
          selected={surveyChoices}
          onBack={() => {
            setSignupFlowStarted(false);
            setSurveyChoices([]);
            setStep("login");
          }}
          onToggle={(id) =>
            setSurveyChoices((prev) =>
              prev.includes(id) ? prev.filter((choice) => choice !== id) : [...prev, id],
            )
          }
          onNext={() => setStep("signup")}
        />
      )}
      {step === "signup" && (
        <SignupStep
          busy={busy}
          setBusy={setBusy}
          onBack={back}
          onDone={(name) => {
            setSignupName(name);
            setStep("connect");
          }}
          show={show}
        />
      )}
      {step === "connect" && (
        <ConnectStep
          busy={busy}
          progressPercent={signupFlowStarted ? 80 : null}
          onBack={() => setStep("role")}
          onNewFamily={async () => {
            if (busy) return;
            setBusy(true);
            try {
              await setupFamily({ parentName: (signupName ?? "").trim() || parentNameFromUser(user) });
              syncFromSession();
              setStep("perms");
            } catch (e) {
              show(errMsg(e), "⚠️");
            } finally {
              setBusy(false);
            }
          }}
          onJoin={() => {
            setPairMode("parent");
            setStep("pairing");
          }}
          onChildDevice={startChildMode}
        />
      )}
      {step === "pairing" && (
        <PairingStep
          mode={pairMode}
          busy={busy}
          initialCode={pairPrefill}
          childJoinHint={childJoinHint}
          onBack={() => setStep(role === "child" ? "role" : "connect")}
          onDone={() => setStep("perms")}
          onPaired={syncFromSession}
          show={show}
          setBusy={setBusy}
        />
      )}
      {step === "perms" && (
        <PermsStep
          role={role}
          progressPercent={signupFlowStarted ? 100 : null}
          onDone={() => navigate(homePathForRole(role === "parent" ? "parent" : role === "child" ? "child" : "teacher"))}
        />
      )}
    </div>
  );
}

/* ── 공통 조각 ─────────────────────────────────────────────────────────── */

function BackButton({
  onBack,
  dark,
  disabled = false,
}: {
  onBack: () => void;
  dark?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={dark ? "ob-back ob-back--dark hy-press" : "ob-back hy-press"}
      aria-label="뒤로"
      aria-disabled={disabled}
      onClick={onBack}
      disabled={disabled}
    >
      <ChevronLeft size={22} strokeWidth={2.2} color={dark ? "#fff" : "#4A4145"} />
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="ob-label">{label}</div>
      {children}
    </div>
  );
}

function SignupProgress({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      className="ob-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <span className="ob-progress__meta">
        <span>{label}</span>
        <strong>{percent}%</strong>
      </span>
      <span className="ob-progress__track">
        <span className="ob-progress__fill" style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}

function KakaoIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="#341B1B">
      <path d="M12 3C6.9 3 3 6.3 3 10.3c0 2.6 1.7 4.9 4.3 6.2-.2.7-.7 2.5-.8 2.9 0 .3.2.3.4.2.2-.1 2.6-1.8 3.6-2.5.5.1 1 .1 1.5.1 5.1 0 9-3.3 9-7.3S17.1 3 12 3Z" />
    </svg>
  );
}

/** 네이버 공식 심볼(N) — 브랜드 가이드상 흰색 로고 + 그린 배경. */
function NaverIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="#fff" aria-hidden="true">
      <path d="M13.06 10.7 6.66 1.5H1.5v17h5.44V9.3l6.4 9.2h5.16v-17h-5.44v9.2Z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.5 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.2-4.8 3.2-7.9Z" />
      <path fill="#34A853" d="M12 23c2.9 0 5.4-1 7.2-2.6l-3.6-2.7c-1 .7-2.3 1.1-3.6 1.1-2.8 0-5.1-1.9-6-4.4H2.3v2.8A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M6 14.3a6.6 6.6 0 0 1 0-4.2V7.3H2.3a11 11 0 0 0 0 9.8L6 14.3Z" />
      <path fill="#EA4335" d="M12 5.5c1.6 0 3 .5 4.1 1.6l3.1-3.1A11 11 0 0 0 2.3 7.3L6 10.1c.9-2.6 3.2-4.6 6-4.6Z" />
    </svg>
  );
}

/* ── STEP: ROLE ────────────────────────────────────────────────────────── */

function RoleStep({
  busy,
  childStarting,
  onParent,
  onChild,
  onTeacher,
}: {
  busy: boolean;
  childStarting: boolean;
  onParent: () => void;
  onChild: () => void;
  onTeacher: () => void;
}) {
  return (
    <div className="ob-step ob-role">
      <div className="ob-role-head">
        <span className="ob-role-badge">함께 보는 우리 가족</span>
        <div className="ob-role-logo">
          <img src={asset("mascot/wave.webp")} alt="혜니캘린더" />
        </div>
        <div className="ob-role-title">혜니캘린더</div>
        <div className="ob-role-sub">함께 보는 우리 가족 일정</div>
      </div>

      <div className="ob-role-list">
        <button type="button" className="ob-role-card ob-role-card--parent hy-press" onClick={onParent} disabled={busy}>
          <span className="ob-role-ic ob-role-ic--parent">
            <img className="ob-role-img" src={asset(ROLE_ICON_ASSETS.parent)} alt="" />
          </span>
          <span className="ob-role-main">
            <span className="ob-role-name">학부모</span>
            <span className="ob-role-desc">ID · 카카오로 로그인</span>
          </span>
          <ChevronRight size={22} strokeWidth={2.4} color="#C9BFC4" />
        </button>

        <button type="button" className="ob-role-card ob-role-card--child hy-press" onClick={onChild} disabled={busy}>
          <span className="ob-role-ic ob-role-ic--child">
            <img className="ob-role-img ob-role-img--child" src={asset(ROLE_ICON_ASSETS.child)} alt="" />
          </span>
          <span className="ob-role-main">
            <span className="ob-role-name" style={{ color: "#7C4B8E" }}>아이</span>
            <span className="ob-role-desc" style={{ color: "#A67FB0" }}>
              {childStarting ? "준비 중…" : "부모님 코드로 시작"}
            </span>
          </span>
          <ChevronRight size={22} strokeWidth={2.4} color="#C6A9CF" />
        </button>

        {TEACHER_MODE_ENABLED && (
          <button type="button" className="ob-role-card ob-role-card--teacher hy-press" onClick={onTeacher} disabled={busy}>
            <span className="ob-role-ic ob-role-ic--teacher">
              <img className="ob-role-img" src={asset(ROLE_ICON_ASSETS.teacher)} alt="" />
            </span>
            <span className="ob-role-main">
              <span className="ob-role-name" style={{ color: "#0F7A57" }}>선생님</span>
              <span className="ob-role-desc" style={{ color: "#5FA98A" }}>학교·반 등록하고 시작</span>
            </span>
            <ChevronRight size={22} strokeWidth={2.4} color="#9AD3BE" />
          </button>
        )}
      </div>

      <div className="ob-role-terms">
        계속하면
        {" "}
        <a href={TERMS_OF_SERVICE_URL} target="_blank" rel="noopener noreferrer">이용약관</a>
        과
        {" "}
        <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer">개인정보처리방침</a>
        에 동의합니다.
      </div>
    </div>
  );
}

/* ── STEP: TEACHER SETUP (백엔드 배선은 Slice 9) ────────────────────────── */

function TeacherStep({ onBack, onSave, show }: { onBack: () => void; onSave: () => void; show: Show }) {
  const [school, setSchool] = useState("");
  const [klass, setKlass] = useState("");

  const save = () => {
    if (!school.trim() || !klass.trim()) {
      show("학교와 반 이름을 입력해주세요", "✏️");
      return;
    }
    show(`${school} · ${klass} 등록은 선생님 연동(예정) 후 활성화돼요`, "🎓");
    onSave();
  };

  return (
    <div className="ob-step ob-teacher">
      <BackButton onBack={onBack} />
      <div className="ob-teacher-head">
        <div className="ob-teacher-logo">
          <img src={asset("cat/study.webp")} alt="" />
        </div>
        <div className="ob-h1">우리 반 만들기</div>
        <div className="ob-teacher-sub">
          학교·반을 등록하면 부모님 전화번호로
          <br />
          학생을 초대해 일정을 관리할 수 있어요
        </div>
      </div>

      <div className="ob-teacher-form">
        <Field label="학교 이름">
          <input
            className="ob-input ob-input--tall"
            placeholder="예) 혜니초등학교"
            value={school}
            onChange={(e) => setSchool(e.target.value)}
          />
        </Field>
        <Field label="반 이름">
          <input
            className="ob-input ob-input--tall"
            placeholder="예) 3학년 햇살반"
            value={klass}
            onChange={(e) => setKlass(e.target.value)}
          />
        </Field>
      </div>

      <div className="ob-teacher-note">
        <span className="ob-teacher-note__ic"><Link2 size={18} strokeWidth={2.2} /></span>
        <span className="ob-teacher-note__tx">
          등록 후 <b>부모님 전화번호</b>로 학생을 초대해요. 부모님이 승인하면 반 일정·알림장이 아이 캘린더에
          연결됩니다. 개인정보는 최소한만 안전하게 보관해요.
        </span>
      </div>

      <button type="button" className="ob-cta ob-cta--green hy-press" onClick={save}>
        반 등록하고 시작하기
      </button>
    </div>
  );
}

/* ── STEP: LOGIN ───────────────────────────────────────────────────────── */

function LoginStep({
  busy,
  setBusy,
  commitBoundaryActive,
  onBack,
  onLoggedIn,
  onSignup,
  show,
}: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  commitBoundaryActive: boolean;
  onBack: () => void;
  onLoggedIn: (transitionToken: OnboardingAuthTransitionToken) => Promise<void>;
  onSignup: () => void;
  show: Show;
}) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginFormErrors>({});
  const [pendingAction, setPendingAction] = useState<"id" | OAuthProvider | null>(null);
  const loginIdInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const loginNavigationLocked = isLoginNavigationLocked({ busy, commitBoundaryActive });

  const clearFieldError = (field: keyof LoginFormErrors) => {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const social = async (provider: OAuthProvider) => {
    if (busy) return;
    setPendingAction(provider);
    setBusy(true);
    const transitionToken = beginOnboardingAuthTransition();
    try {
      await startWorkerOAuth(provider); // 서버 발급 일회성 state 저장 후 provider로 이동
    } catch (e) {
      if (!isOnboardingAuthTransitionActive(transitionToken)) return;
      show(errMsg(e), "⚠️");
      // 키 미설정 등 설정 오류 — busy 를 풀고 정직하게 안내(버튼이 영구 잠기지 않게).
      setPendingAction(null);
      setBusy(false);
      endOnboardingAuthTransition(transitionToken);
    }
  };

  const loginIdPw = async () => {
    if (busy) return;
    const validationErrors = validateLoginForm({ loginId, password });
    setErrors(validationErrors);
    if (validationErrors.loginId) {
      loginIdInputRef.current?.focus();
      return;
    }
    if (validationErrors.password) {
      passwordInputRef.current?.focus();
      return;
    }
    setPendingAction("id");
    setBusy(true);
    const transitionToken = beginOnboardingAuthTransition();
    try {
      const result = await signInWithLoginId(
        { loginId, password },
        { sessionAdoption: "deferred" },
      );
      const commitResult = commitOnboardingAuthResult(transitionToken, result, adoptAuthResult);
      if (commitResult === "stale") return;
      await onLoggedIn(transitionToken);
    } catch (e) {
      if (!isOnboardingAuthTransitionActive(transitionToken)) return;
      show(errMsg(e), "⚠️");
    } finally {
      if (isOnboardingAuthTransitionActive(transitionToken)) {
        setPendingAction(null);
        setBusy(false);
        endOnboardingAuthTransition(transitionToken);
      }
    }
  };

  return (
    <div className="ob-step ob-login">
      <BackButton onBack={onBack} disabled={loginNavigationLocked} />
      <div className="ob-login-head">
        <img className="ob-login-mascot" src={asset("mascot/wave.webp")} alt="" />
        <div className="ob-h1">다시 만나 반가워요</div>
        <div className="ob-sub">계정으로 우리 가족과 이어집니다</div>
      </div>

      <div className="ob-login-social">
        <button type="button" className="ob-social ob-social--kakao hy-press" onClick={() => social("kakao")} disabled={busy}>
          <KakaoIcon />
          <BusyLabel busy={busy && pendingAction === "kakao"} idle="카카오로 계속하기" pending="카카오 로그인 중…" />
        </button>
        <button type="button" className="ob-social ob-social--google hy-press" onClick={() => social("google")} disabled={busy}>
          <GoogleIcon />
          <BusyLabel busy={busy && pendingAction === "google"} idle="Google로 계속하기" pending="Google 로그인 중…" />
        </button>
        {/* 네이버 키가 없으면 버튼 자체를 숨긴다 — 누르면 실패하는 버튼을 보여주지 않는다. */}
        {hasNaverClientId && (
          <button type="button" className="ob-social ob-social--naver hy-press" onClick={() => social("naver")} disabled={busy}>
            <NaverIcon />
            <BusyLabel busy={busy && pendingAction === "naver"} idle="네이버로 계속하기" pending="네이버 로그인 중…" />
          </button>
        )}
      </div>

      <div className="ob-divider">
        <span />
        <em>또는 아이디로</em>
        <span />
      </div>

      <div className="ob-login-form">
        <div className="ob-login-field">
          <input
            ref={loginIdInputRef}
            className="ob-input"
            placeholder="아이디"
            aria-label="아이디"
            aria-invalid={Boolean(errors.loginId)}
            aria-describedby={errors.loginId ? "ob-login-id-error" : undefined}
            autoComplete="username"
            value={loginId}
            onChange={(e) => {
              setLoginId(e.target.value);
              clearFieldError("loginId");
            }}
          />
          {errors.loginId && (
            <p id="ob-login-id-error" className="ob-field-error" role="alert">
              {errors.loginId}
            </p>
          )}
        </div>
        <div className="ob-login-field">
          <input
            ref={passwordInputRef}
            className="ob-input"
            type="password"
            placeholder="비밀번호"
            aria-label="비밀번호"
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "ob-login-password-error" : undefined}
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearFieldError("password");
            }}
          />
          {errors.password && (
            <p id="ob-login-password-error" className="ob-field-error" role="alert">
              {errors.password}
            </p>
          )}
        </div>
        <button type="button" className="ob-loginbtn hy-press" onClick={loginIdPw} disabled={busy}>
          <BusyLabel busy={busy && pendingAction === "id"} idle="로그인" pending="로그인 중…" />
        </button>
      </div>

      <div className="ob-login-foot">
        아직 계정이 없나요?{" "}
        <button
          type="button"
          className="ob-link"
          onClick={onSignup}
          disabled={busy || commitBoundaryActive}
        >
          회원가입
        </button>
      </div>
    </div>
  );
}

/* ── STEP: SIGNUP (전화+OTP 인증 포함) ──────────────────────────────────── */

function SurveyStep({
  selected,
  onBack,
  onToggle,
  onNext,
}: {
  selected: string[];
  onBack: () => void;
  onToggle: (id: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="ob-step ob-survey">
      <BackButton onBack={onBack} />
      <SignupProgress percent={20} label="1/5 관심 기능" />
      <div className="ob-survey-head">
        <div className="ob-signup-title">가입 전에 한 가지만 알려주세요</div>
        <div className="ob-sub">
          우리 아이에게 가장 필요한 기능을 골라주세요.
          <br />
          복수 선택할 수 있어요.
        </div>
      </div>

      <div className="ob-survey-list">
        {SURVEY_OPTIONS.map((option) => {
          const on = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              className={`ob-survey-card hy-press${on ? " ob-survey-card--on" : ""}`}
              aria-pressed={on}
              onClick={() => onToggle(option.id)}
            >
              <span className="ob-survey-check">{on ? "✓" : ""}</span>
              <span className="ob-survey-main">
                <span className="ob-survey-title">{option.title}</span>
                <span className="ob-survey-sub">{option.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      <button type="button" className="ob-cta ob-cta--accent hy-press" onClick={onNext}>
        다음
      </button>
    </div>
  );
}

const GENDERS = [
  { value: "mom", label: "엄마" },
  { value: "dad", label: "아빠" },
  { value: "guardian", label: "보호자" },
] as const;

function SignupStep({
  busy,
  setBusy,
  onBack,
  onDone,
  show,
}: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  onBack: () => void;
  onDone: (name: string) => void;
  show: Show;
}) {
  const [phase, setPhase] = useState<"form" | "otp">("form");
  const [name, setName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [gender, setGender] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState<PendingSignup | null>(null);
  const [otp, setOtp] = useState("");
  const [pendingSignupAction, setPendingSignupAction] = useState<SignupPendingAction | null>(null);
  const pendingSignupActionRef = useRef<SignupPendingAction | null>(null);

  const beginSignupAction = (action: SignupPendingAction) => {
    pendingSignupActionRef.current = action;
    setPendingSignupAction(action);
    setBusy(true);
  };

  const finishSignupAction = (action: SignupPendingAction) => {
    const current = pendingSignupActionRef.current;
    const ownsAction = isSignupActionPending(current, action);
    const next = completeSignupPendingAction(current, action);
    pendingSignupActionRef.current = next;
    setPendingSignupAction(next);
    if (ownsAction) setBusy(false);
  };

  const requestCode = async () => {
    if (busy) return;
    beginSignupAction("request-code");
    try {
      const result = await requestPhoneSignupCode({ name, loginId, password, passwordConfirm, gender, birthdate, phone });
      setPending(result);
      setPhase("otp");
      show("인증번호를 보냈어요", "📩");
    } catch (e) {
      show(errMsg(e), "⚠️");
    } finally {
      finishSignupAction("request-code");
    }
  };

  const verify = async () => {
    if (busy || !pending) return;
    beginSignupAction("verify");
    try {
      await verifyPhoneSignupCode({ phone: pending.phone, token: otp, profile: pending.profile, password: pending.password });
      show("가입이 완료됐어요", "🎉");
      onDone(name);
    } catch (e) {
      show(errMsg(e), "⚠️");
    } finally {
      finishSignupAction("verify");
    }
  };

  if (phase === "otp") {
    return (
      <div className="ob-step ob-signup">
        <BackButton onBack={() => setPhase("form")} disabled={busy} />
        <SignupProgress percent={60} label="3/5 휴대폰 인증" />
        <div className="ob-signup-head">
          <div className="ob-signup-title">인증번호 확인</div>
          <div className="ob-sub">{pending?.phoneStorage} 로 보낸 6자리를 입력해주세요</div>
        </div>
        <div className="ob-signup-form">
          <Field label="인증번호">
            <input
              className="ob-input"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </Field>
        </div>
        <button type="button" className="ob-cta ob-cta--accent hy-press" onClick={verify} disabled={busy}>
          <BusyLabel
            busy={busy && isSignupActionPending(pendingSignupAction, "verify")}
            idle="인증하고 가입 완료"
            pending="가입 확인 중…"
          />
        </button>
        {/* 재전송은 requestPhoneSignupCode 를 다시 호출(실 전송) */}
        <div className="ob-login-foot">
          인증번호를 못 받으셨나요?{" "}
          <button type="button" className="ob-link" onClick={requestCode} disabled={busy}>
            <BusyLabel
              busy={busy && isSignupActionPending(pendingSignupAction, "request-code")}
              idle="재전송"
              pending="재전송 중…"
            />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ob-step ob-signup">
      <BackButton onBack={onBack} disabled={busy} />
      <SignupProgress percent={40} label="2/5 계정 만들기" />
      <div className="ob-signup-head">
        <div className="ob-signup-title">혜니 가족 시작하기</div>
        <div className="ob-sub">부모님 계정을 만들어요</div>
      </div>

      <div className="ob-signup-form">
        <Field label="이름">
          <input className="ob-input" placeholder="이름을 입력해주세요" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="아이디">
          <input className="ob-input" placeholder="영문 소문자·숫자 4자 이상" autoCapitalize="none" value={loginId} onChange={(e) => setLoginId(e.target.value)} />
        </Field>
        <Field label="비밀번호">
          <input className="ob-input" type="password" placeholder="6자 이상" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="비밀번호 확인">
          <input className="ob-input" type="password" placeholder="비밀번호 재입력" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />
        </Field>
        <Field label="보호자 구분">
          <div style={{ display: "flex", gap: 8 }}>
            {GENDERS.map((g) => (
              <button
                key={g.value}
                type="button"
                className="hy-press"
                onClick={() => setGender(g.value)}
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 12,
                  fontWeight: 700,
                  fontSize: 14,
                  border: gender === g.value ? "none" : "1.5px solid var(--line-strong)",
                  background: gender === g.value ? "var(--hy-accent)" : "#fff",
                  color: gender === g.value ? "#fff" : "var(--fg-body)",
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="생년월일">
          <input className="ob-input" type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
        </Field>
        <Field label="휴대폰 번호">
          <input className="ob-input" inputMode="tel" placeholder="010-0000-0000" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>

      <button type="button" className="ob-cta ob-cta--accent hy-press" onClick={requestCode} disabled={busy}>
        <BusyLabel
          busy={busy && isSignupActionPending(pendingSignupAction, "request-code")}
          idle="인증번호 받기"
          pending="인증번호 전송 중…"
        />
      </button>
    </div>
  );
}

/* ── STEP: CONNECT ─────────────────────────────────────────────────────── */

function ConnectStep({
  busy,
  progressPercent,
  onBack,
  onNewFamily,
  onJoin,
  onChildDevice,
}: {
  busy: boolean;
  progressPercent?: number | null;
  onBack: () => void;
  onNewFamily: () => void;
  onJoin: () => void;
  onChildDevice: () => void;
}) {
  return (
    <div className="ob-step ob-connect">
      <BackButton onBack={onBack} />
      {progressPercent != null && <SignupProgress percent={progressPercent} label="4/5 가족 연결" />}
      <div className="ob-connect-head">
        <img className="ob-connect-mascot" src={asset("mascot/family.webp")} alt="" />
        <div className="ob-h1">가족을 연결해요</div>
        <div className="ob-sub">엄마·아빠·아이가 함께 쓰는 가족 앱</div>
      </div>

      <div className="ob-connect-list">
        <button type="button" className="ob-connect-card hy-press" onClick={onNewFamily} disabled={busy}>
          <img className="ob-connect-ic" src={asset("ui/place-home.webp")} alt="" />
          <span className="ob-connect-main">
            <span className="ob-connect-name">새 가족 만들기</span>
            <span className="ob-connect-desc">연결 코드 생성 · 배우자 &amp; 아이 초대</span>
          </span>
          <ChevronRight size={20} strokeWidth={2.4} color="#C9BFC4" />
        </button>

        <button type="button" className="ob-connect-card hy-press" onClick={onJoin} disabled={busy}>
          <img className="ob-connect-ic" src={asset("ui/friend-pair.webp")} alt="" />
          <span className="ob-connect-main">
            <span className="ob-connect-name">기존 가족에 합류</span>
            <span className="ob-connect-desc">배우자가 준 코드로 참여</span>
          </span>
          <ChevronRight size={20} strokeWidth={2.4} color="#C9BFC4" />
        </button>

        <button type="button" className="ob-connect-card ob-connect-card--child hy-press" onClick={onChildDevice} disabled={busy}>
          <img className="ob-connect-ic" src={asset(DEFAULT_CHILD_AVATAR)} alt="" />
          <span className="ob-connect-main">
            <span className="ob-connect-name" style={{ color: "#6D4E9C" }}>아이 기기인가요?</span>
            <span className="ob-connect-desc" style={{ color: "#9B7FB8" }}>QR 스캔 또는 코드 입력</span>
          </span>
          <ChevronRight size={20} strokeWidth={2.4} color="#B79DE0" />
        </button>
      </div>
    </div>
  );
}

/* ── STEP: PAIRING (KID-XXXXXXXX 형식) ─────────────────────────────────── */

function PairingStep({
  mode,
  busy,
  initialCode,
  childJoinHint,
  onBack,
  onDone,
  onPaired,
  show,
  setBusy,
}: {
  mode: "child" | "parent";
  busy: boolean;
  initialCode?: string | null;
  childJoinHint?: JoinFamilyOptions | null;
  onBack: () => void;
  onDone: () => void;
  onPaired: () => void;
  show: Show;
  setBusy: (v: boolean) => void;
}) {
  const [raw, setRaw] = useState(initialCode ?? "");
  const [showScanner, setShowScanner] = useState(false);

  // rawCode: 스캔 rawValue 또는 입력값. 딥링크 URL(#/onboarding?pair=KID-…)도
  // normalizePairCodeInput 의 KID- 직접매치로 코드가 추출된다.
  const submit = async (rawCode?: string) => {
    if (busy) return;
    const code = normalizePairCodeInput(rawCode ?? raw);
    if (!code) {
      show(
        rawCode != null ? "유효한 QR 코드를 찾지 못했어요" : "연결 코드를 확인해주세요 (KID-XXXXXXXX)",
        "🔢",
      );
      return;
    }
    setRaw(code);
    setBusy(true);
    try {
      if (mode === "child") {
        const nextHint = await readChildDeviceIdentityHint();
        await joinFamily(code, childJoinHint ?? nextHint);
      } else {
        await joinFamilyAsParent(code);
      }
      onPaired();
      show("가족과 연결됐어요", "🔗");
      onDone();
    } catch (e) {
      show(errMsg(e), "⚠️");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ob-step ob-pairing">
      <BackButton onBack={onBack} dark />
      <div className="ob-pair-head">
        <div className="ob-pair-title">부모님 연결 코드를 입력하세요</div>
        <div className="ob-pair-sub">부모 앱 · 가족 · 연결 코드에서 QR·코드를 볼 수 있어요</div>
      </div>

      {/* 탭하면 실제 카메라 스캐너 오버레이(BarcodeDetector)가 열린다. */}
      <button
        type="button"
        className="ob-qr hy-press"
        aria-label="카메라로 QR 스캔"
        onClick={() => setShowScanner(true)}
        disabled={busy}
      >
        <span className="ob-qr-corner ob-qr-corner--tl" />
        <span className="ob-qr-corner ob-qr-corner--tr" />
        <span className="ob-qr-corner ob-qr-corner--bl" />
        <span className="ob-qr-corner ob-qr-corner--br" />
        <span className="ob-qr-scan" />
        <span className="ob-qr-cta"><Camera size={15} strokeWidth={2.4} /> 탭해서 QR 스캔</span>
      </button>

      <div className="ob-pair-hint">QR이 없다면 코드를 직접 입력</div>

      <input
        className="ob-input"
        placeholder="KID-XXXXXXXX"
        autoCapitalize="characters"
        autoComplete="off"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        style={{ textAlign: "center", letterSpacing: 1, fontWeight: 700, textTransform: "uppercase" }}
      />

      <button
        type="button"
        className="ob-cta ob-cta--accent hy-press"
        onClick={() => void submit()}
        disabled={busy}
      >
        {busy ? "연결 중…" : "코드로 연결하기"}
      </button>

      {showScanner && (
        <QrScanner
          onClose={() => setShowScanner(false)}
          onDetected={async (rawValue) => {
            setShowScanner(false);
            await submit(rawValue);
          }}
        />
      )}
    </div>
  );
}

/* ── STEP: PERMS ───────────────────────────────────────────────────────── */

function PermsStep({
  role,
  progressPercent,
  onDone,
}: {
  role: "parent" | "child" | "teacher";
  progressPercent?: number | null;
  onDone: () => void;
}) {
  const permissionItems = role === "child" ? CHILD_PERM_ITEMS : GUARDIAN_PERM_ITEMS;
  const [locationStage, setLocationStage] = useState<
    "idle" | "disclosure" | "backgroundEducation" | "foregroundDenied" | "backgroundDenied"
  >("idle");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [locationUnsupported, setLocationUnsupported] = useState(false);

  const start = () => {
    if (role !== "child") {
      onDone();
      return;
    }
    setLocationStage("disclosure");
  };

  const requestForeground = async () => {
    if (permissionBusy) return;
    setPermissionBusy(true);
    const result = await requestForegroundLocationPermission();
    setPermissionBusy(false);
    if (result.granted) {
      setLocationUnsupported(false);
      setLocationStage("backgroundEducation");
      return;
    }
    setLocationUnsupported(!result.supported);
    setLocationStage("foregroundDenied");
  };

  const requestBackground = async () => {
    if (permissionBusy) return;
    setPermissionBusy(true);
    const result = await requestBackgroundLocationPermission();
    setPermissionBusy(false);
    if (result.granted) {
      onDone();
      return;
    }
    setLocationUnsupported(!result.supported);
    setLocationStage("backgroundDenied");
  };

  return (
    <div className="ob-step ob-perms">
      {progressPercent != null && <SignupProgress percent={progressPercent} label="5/5 시작 준비" />}
      <div className="ob-perms-head">
        <img className="ob-perms-mascot" src={asset("mascot/wave.webp")} alt="" />
        <div className="ob-h1">몇 가지만 허용해 주세요</div>
        <div className="ob-sub">안전하게 지켜주기 위해 필요해요</div>
      </div>

      <div className="ob-perms-list">
        {permissionItems.map((p) => (
          <div key={p.id} className="ob-perm">
            <img className="ob-perm-ic" src={asset(p.icon)} alt="" />
            <span className="ob-perm-main">
              <span className="ob-perm-title">{p.title}</span>
              <span className="ob-perm-sub">{p.sub}</span>
            </span>
            {/* 권한은 시작 시 실제로 요청됨 — 아직 '허용됨'이 아니므로 '예정' 배지로 정직 표기 */}
            <span
              className="ob-perm-check"
              style={{
                width: "auto",
                padding: "0 11px",
                height: 24,
                fontSize: 11.5,
                fontWeight: 800,
                color: "#8FA093",
                background: "#EEF3F0",
              }}
            >
              예정
            </span>
          </div>
        ))}
      </div>

      <button type="button" className="ob-cta ob-cta--lav hy-press" onClick={start}>
        {role === "child" ? "위치 권한 설정하고 시작하기" : "알림 설정하고 시작하기"}
      </button>

      {locationStage !== "idle" && (
        <div className="ob-consent-overlay">
          <section
            className="ob-consent-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ob-location-consent-title"
            aria-describedby="ob-location-consent-description"
          >
            {locationStage === "disclosure" && (
              <>
                <span className="ob-consent-dialog__eyebrow">아이 위치 공유 안내</span>
                <h2 id="ob-location-consent-title">백그라운드 위치를 사용해요</h2>
                <div id="ob-location-consent-description" className="ob-consent-dialog__copy">
                  <p>
                    혜니캘린더는 아이가 앱을 닫거나 사용하지 않을 때도 위치를 수집해 연결된 보호자에게 공유합니다.
                  </p>
                  <p>
                    위치는 실시간 위치·오늘 경로와 집·학교·학원 도착·출발, 일정 미도착, 위험장소 알림에 사용됩니다.
                  </p>
                  <p>
                    위치 수집 중에는 Android의 지속 알림이 표시되며, 아이 기기의 위치 설정에서 언제든지 권한을 끌 수 있습니다.
                  </p>
                </div>
                <div className="ob-consent-dialog__actions">
                  <button type="button" className="ob-consent-secondary hy-press" onClick={onDone} disabled={permissionBusy}>
                    나중에
                  </button>
                  <button type="button" className="ob-consent-primary hy-press" onClick={() => void requestForeground()} disabled={permissionBusy} autoFocus>
                    {permissionBusy ? "권한 확인 중…" : "동의하고 계속"}
                  </button>
                </div>
              </>
            )}

            {locationStage === "backgroundEducation" && (
              <>
                <span className="ob-consent-dialog__eyebrow">마지막 위치 설정</span>
                <h2 id="ob-location-consent-title">위치를 ‘항상 허용’으로 선택해 주세요</h2>
                <div id="ob-location-consent-description" className="ob-consent-dialog__copy">
                  <p>
                    다음 Android 위치 권한 화면에서 ‘항상 허용’을 선택해야 앱을 닫은 뒤에도 도착·출발과 위험장소 알림이 이어집니다.
                  </p>
                  <p>허용하지 않아도 앱은 사용할 수 있으며, 아이 설정에서 나중에 다시 켤 수 있습니다.</p>
                </div>
                <div className="ob-consent-dialog__actions">
                  <button type="button" className="ob-consent-secondary hy-press" onClick={onDone} disabled={permissionBusy}>
                    나중에
                  </button>
                  <button type="button" className="ob-consent-primary hy-press" onClick={() => void requestBackground()} disabled={permissionBusy} autoFocus>
                    {permissionBusy ? "설정 확인 중…" : "‘항상 허용’ 설정 열기"}
                  </button>
                </div>
              </>
            )}

            {(locationStage === "foregroundDenied" || locationStage === "backgroundDenied") && (
              <>
                <span className="ob-consent-dialog__eyebrow">위치 권한이 필요해요</span>
                <h2 id="ob-location-consent-title">
                  {locationUnsupported ? "이 기기에서는 지원하지 않아요" : "아직 위치 권한이 꺼져 있어요"}
                </h2>
                <div id="ob-location-consent-description" className="ob-consent-dialog__copy">
                  <p>
                    {locationUnsupported
                      ? "아이의 백그라운드 위치 공유는 Android 앱에서 사용할 수 있습니다."
                      : "권한 없이 시작하면 보호자에게 현재 위치와 도착·출발 알림이 전달되지 않습니다."}
                  </p>
                  <p>앱은 계속 사용할 수 있고, 아이 설정에서 언제든지 다시 설정할 수 있습니다.</p>
                </div>
                <div className="ob-consent-dialog__actions">
                  <button type="button" className="ob-consent-secondary hy-press" onClick={onDone} disabled={permissionBusy}>
                    권한 없이 시작
                  </button>
                  {!locationUnsupported && (
                    <button
                      type="button"
                      className="ob-consent-primary hy-press"
                      onClick={() => void (locationStage === "foregroundDenied" ? requestForeground() : requestBackground())}
                      disabled={permissionBusy}
                      autoFocus
                    >
                      {permissionBusy ? "권한 확인 중…" : "다시 설정"}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
