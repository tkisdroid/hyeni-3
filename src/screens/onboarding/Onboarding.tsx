import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useNavigate } from "react-router";
import { Camera, Check, ChevronLeft, ChevronRight, Link2 } from "lucide-react";
import { asset } from "@/lib/assets";
import { DEFAULT_CHILD_AVATAR } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { deriveAuthState, useAuth } from "@/auth/AuthContext";
import { ChildLocationPermissionDialog } from "@/components/ChildLocationPermissionDialog";
import { homePathForRole } from "@/auth/guards";
import {
  beginOnboardingAuthTransition,
  beginOnboardingPermissionTransition,
  cancelOnboardingAuthTransitions,
  commitOnboardingAuthResult,
  completeOnboardingAuthTransitionsThrough,
  endOnboardingAuthTransition,
  getOnboardingAuthCommitSnapshot,
  getOnboardingAuthTransitionSnapshot,
  isOnboardingAuthTransitionActive,
  subscribeOnboardingAuthTransition,
  type OnboardingAuthTransitionToken,
  type OnboardingPermissionTransition,
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
import {
  REFERRAL_CODE_EVENT,
  clearReferralParam,
  extractReferralCodeFromInput,
  persistReferralCode,
  readReferralParam,
} from "@/transform/referralLink";
import { REFERRAL_REWARD_CREDITS_DISPLAY } from "@/transform/referralReward";
import { resolveAuthenticatedOnboardingRedirect } from "@/transform/onboardingRedirect";
import { QrScanner } from "@/components/QrScanner";
import { LanguageSelector } from "@/components/LanguageSelector";
import { BusyLabel } from "@/components/ui/BusyLabel";
import {
  PRIVACY_POLICY_URL,
  TERMS_OF_SERVICE_URL,
} from "@/lib/api/endpoints/account";
import { validateLoginForm, type LoginFormErrors } from "@/transform/loginForm";
import {
  createAsyncActionController,
  isAsyncActionTokenFor,
  isLoginNavigationLocked,
  runOwnedAsyncAction,
  shouldReleaseOAuthBusyOnResume,
  type AsyncActionToken,
  type SignupPendingAction,
} from "@/transform/asyncUiState";
import "./Onboarding.css";
import { localizeApiError } from "@/i18n/apiError";

type Step = "role" | "teacherSetup" | "login" | "survey" | "signup" | "connect" | "pairing" | "perms";
type Show = (text: string, emoji?: string) => void;

const CHILD_PERM_ITEMS = [
  { id: "loc", icon: "ui/pin-heart.webp", titleId: "onboarding.permissions.location.title", subId: "onboarding.permissions.location.childDescription" },
  { id: "noti", icon: "ui/bell.webp", titleId: "onboarding.permissions.notifications.title", subId: "onboarding.permissions.notifications.childDescription" },
  { id: "battery", icon: "ui/battery.webp", titleId: "onboarding.permissions.background.title", subId: "onboarding.permissions.background.childDescription" },
] as const;

const GUARDIAN_PERM_ITEMS = [
  { id: "noti", icon: "ui/bell.webp", titleId: "onboarding.permissions.notifications.title", subId: "onboarding.permissions.notifications.formalDescription" },
] as const;

const SURVEY_OPTIONS = [
  { id: "schedule", titleId: "onboarding.survey.schedule.title", subId: "onboarding.survey.schedule.description" },
  { id: "location", titleId: "onboarding.survey.location.title", subId: "onboarding.survey.location.description" },
  { id: "arrival", titleId: "onboarding.survey.arrival.title", subId: "onboarding.survey.arrival.description" },
  { id: "safety", titleId: "onboarding.survey.safety.title", subId: "onboarding.survey.safety.description" },
  { id: "ai", titleId: "onboarding.survey.ai.title", subId: "onboarding.survey.ai.description" },
] as const;

/** 온보딩: 역할선택→로그인/가입→가족연결→페어링→권한. 실제 Worker 인증 배선. */
export function Onboarding() {
  const navigate = useNavigate();
  const intl = useIntl();
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
  const permissionTransitionRef = useRef<OnboardingPermissionTransition | null>(null);
  // 전화 OTP 가입 시 입력한 이름 — 가입 직후 세션 user_metadata 가 비어 parentNameFromUser 가
  // "부모"로 깨지므로, 이 이름을 setupFamily(새 가족)의 parentName 으로 우선 사용한다.
  const [signupName, setSignupName] = useState<string | null>(null);
  // QR 딥링크(?pair=)로 진입 시 아이 코드 프리필.
  const [pairPrefill, setPairPrefill] = useState<string | null>(null);
  // 친구 초대 ref는 가족 생성 성공 전까지 유지해 로그인·가입 단계를 지나도 귀속한다.
  const [referralPrefill, setReferralPrefill] = useState<string | null>(() => readReferralParam());
  const [referralDraft, setReferralDraft] = useState(() => readReferralParam() ?? "");
  const oauthLoginPromiseRef = useRef<ReturnType<typeof finishOAuthLogin> | null>(null);
  const oauthExternalBusyRef = useRef(false);
  const [oauthExternalBusy, setOAuthExternalBusy] = useState(false);

  const applyReferralDraft = (raw: string) => {
    setReferralDraft(raw);
    const code = extractReferralCodeFromInput(raw);
    if (code) {
      persistReferralCode(code);
      setReferralPrefill(code);
      return;
    }
    clearReferralParam();
    setReferralPrefill(null);
  };

  useEffect(() => {
    const syncStored = () => {
      const code = readReferralParam();
      if (!code) return;
      setReferralPrefill(code);
      setReferralDraft((current) => current || code);
    };
    const onStored = (event: Event) => {
      const code = extractReferralCodeFromInput(
        (event as CustomEvent<{ code?: string }>).detail?.code,
      );
      if (!code) return;
      setReferralPrefill(code);
      setReferralDraft(code);
    };
    syncStored();
    window.addEventListener(REFERRAL_CODE_EVENT, onStored);
    return () => window.removeEventListener(REFERRAL_CODE_EVENT, onStored);
  }, []);

  const markOAuthExternalBusy = () => {
    oauthExternalBusyRef.current = true;
    setOAuthExternalBusy(true);
  };

  const clearOAuthExternalBusy = () => {
    oauthExternalBusyRef.current = false;
    setOAuthExternalBusy(false);
  };

  const beginPermissionTransition = () => {
    permissionTransitionRef.current?.cancel();
    permissionTransitionRef.current = beginOnboardingPermissionTransition();
  };

  const cancelPermissionTransition = () => {
    const transition = permissionTransitionRef.current;
    permissionTransitionRef.current = null;
    transition?.cancel();
  };

  const finishPermissionSetup = () => {
    const destination = homePathForRole(
      role === "parent" ? "parent" : role === "child" ? "child" : "teacher",
    );
    const transition = permissionTransitionRef.current;
    permissionTransitionRef.current = null;
    navigate(destination);
    transition?.complete();
  };

  useEffect(() => () => {
    const transition = permissionTransitionRef.current;
    permissionTransitionRef.current = null;
    transition?.cancel();
  }, []);

  // OAuth 콜백(?code&state) 감지 → 세션 교환 → 라우팅. (guard가 미인증을 여기로 보냄)
  useEffect(() => {
    const cancellation = readOAuthCancellation();
    if (cancellation) {
      try {
        finishOAuthCancellation(cancellation);
        show(intl.formatMessage({ id: "onboarding.toast.socialCancelled" }), "ℹ️");
      } catch (e) {
        show(localizeApiError(e, intl, "formal"), "⚠️");
      } finally {
        cancelOnboardingAuthTransitions();
        clearOAuthExternalBusy();
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
        clearOAuthExternalBusy();
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
        clearOAuthExternalBusy();
        show(localizeApiError(e, intl, "formal"), "⚠️");
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
    if (redirect) {
      if (authFamilyId && readReferralParam()) clearReferralParam();
      navigate(redirect, { replace: true });
    }
  }, [authRole, authFamilyId, authTransitionActive, navigate]);

  // OAuth/외부 브라우저에서 복귀 시 busy 잠금 자동 해제 — stuck 방지.
  // 네이티브: 카카오/구글은 시스템 브라우저를 열고 앱을 백그라운드로 보낸다. 로그인을
  // 완료하지 않고 뒤로 오면 딥링크 콜백이 오지 않아 busy=true 가 영구히 남아 UI 가 잠긴다.
  // 실제 외부 OAuth를 연 뒤 앱이 다시 보이는 순간에만 busy를 풀어 되살린다.
  // ID 로그인·가입 API의 진행 상태는 visibility/pageshow가 대신 해제하지 않는다.
  // 웹: bfcache 뒤로가기(pageshow persisted)도 동일 처리. 초기 로드의 pageshow 는 리스너
  // 등록 전에 이미 발화하므로 OAuth 콜백 처리와 충돌하지 않는다.
  useEffect(() => {
    const unstickOAuth = () => {
      if (!shouldReleaseOAuthBusyOnResume({
        documentVisible: document.visibilityState === "visible",
        oauthExternalPending: oauthExternalBusyRef.current,
      })) return;
      clearOAuthExternalBusy();
      setBusy(false);
    };
    document.addEventListener("visibilitychange", unstickOAuth);
    window.addEventListener("pageshow", unstickOAuth);
    return () => {
      document.removeEventListener("visibilitychange", unstickOAuth);
      window.removeEventListener("pageshow", unstickOAuth);
    };
  }, [oauthExternalBusy]);

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
      .catch((e) => show(localizeApiError(e, intl, "formal"), "⚠️"))
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
      clearReferralParam();
      navigate("/parent/home");
    } catch {
      throw new Error("family_lookup_failed");
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
      show(localizeApiError(e, intl, "formal"), "⚠️");
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
          onOAuthExternalOpen={markOAuthExternalBusy}
          onOAuthExternalEnd={clearOAuthExternalBusy}
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
          referralDraft={referralDraft}
          onReferralDraftChange={applyReferralDraft}
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
          referralCode={referralPrefill}
          referralDraft={referralDraft}
          onReferralDraftChange={applyReferralDraft}
          onBack={() => setStep("role")}
          onNewFamily={async () => {
            if (busy) return;
            setBusy(true);
            beginPermissionTransition();
            try {
              await setupFamily({
                parentName: (signupName ?? "").trim() || parentNameFromUser(user),
                referralCode: referralPrefill ?? undefined,
              });
              clearReferralParam();
              syncFromSession();
              setStep("perms");
            } catch (e) {
              cancelPermissionTransition();
              show(localizeApiError(e, intl, "formal"), "⚠️");
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
          onPermissionTransitionStart={beginPermissionTransition}
          onPermissionTransitionCancel={cancelPermissionTransition}
          show={show}
          setBusy={setBusy}
        />
      )}
      {step === "perms" && (
        <PermsStep
          role={role}
          progressPercent={signupFlowStarted ? 100 : null}
          onDone={finishPermissionSetup}
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
  const intl = useIntl();
  return (
    <button
      type="button"
      className={dark ? "ob-back ob-back--dark hy-press" : "ob-back hy-press"}
      aria-label={intl.formatMessage({ id: "core.action.back" })}
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

function ReferralCodeField({
  value,
  onChange,
  disabled,
  hideLabel = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  const intl = useIntl();
  const applied = extractReferralCodeFromInput(value);
  const invalid = value.trim().length > 0 && !applied;
  const label = intl.formatMessage({ id: "onboarding.field.referralCode" });
  return (
    <div>
      {hideLabel ? null : <div className="ob-label">{label}</div>}
      <input
        className="ob-input"
        aria-label={label}
        aria-invalid={invalid}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={intl.formatMessage({ id: "onboarding.field.referralCodePlaceholder" })}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="ob-referral-hint">
        {invalid
          ? intl.formatMessage({ id: "onboarding.connect.referralInvalid" })
          : intl.formatMessage({ id: "onboarding.field.referralCodeHint" })}
      </p>
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
    <svg width="21" height="21" viewBox="0 0 24 24" fill="#341B1B" aria-hidden="true">
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
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
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
  const intl = useIntl();
  return (
    <div className="ob-step ob-role">
      {/* 장식 배지는 두지 않는다 — 제목·부제와 같은 말을 반복했다(2026-08-14 지시). */}
      <div className="ob-role-head">
        <div className="ob-role-logo">
          <img
            src={asset("mascot/wave.webp")}
            alt={intl.formatMessage({ id: "core.brand.name" })}
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
        </div>
        <div className="ob-role-title">{intl.formatMessage({ id: "core.brand.name" })}</div>
        <div className="ob-role-sub">{intl.formatMessage({ id: "onboarding.role.subtitle" })}</div>
      </div>

      <div className="ob-role-list">
        <LanguageSelector tone="formal" />
        <button
          type="button"
          className="ob-role-card ob-role-card--parent hy-press"
          onClick={onParent}
          disabled={busy}
          data-progress-owner="child-start"
        >
          <span className="ob-role-ic ob-role-ic--parent">
            <img
              className="ob-role-img"
              src={asset(ROLE_ICON_ASSETS.parent)}
              alt=""
              loading="eager"
              decoding="async"
            />
          </span>
          <span className="ob-role-main">
            <span className="ob-role-name">{intl.formatMessage({ id: "onboarding.role.parent.title" })}</span>
            <span className="ob-role-desc">{intl.formatMessage({ id: "onboarding.role.parent.description" })}</span>
          </span>
          <ChevronRight size={22} strokeWidth={2.4} color="#C9BFC4" />
        </button>

        <button
          type="button"
          className="ob-role-card ob-role-card--child hy-press"
          onClick={onChild}
          disabled={busy}
          aria-busy={childStarting}
        >
          <span className="ob-role-ic ob-role-ic--child">
            <img
              className="ob-role-img ob-role-img--child"
              src={asset(ROLE_ICON_ASSETS.child)}
              alt=""
              loading="eager"
              decoding="async"
            />
          </span>
          <span className="ob-role-main">
            <span className="ob-role-name" style={{ color: "#7C4B8E" }}>{intl.formatMessage({ id: "onboarding.role.child.title" })}</span>
            <span className="ob-role-desc" style={{ color: "#A67FB0" }}>
              {intl.formatMessage({ id: childStarting ? "onboarding.role.child.starting" : "onboarding.role.child.description" })}
            </span>
          </span>
          <ChevronRight size={22} strokeWidth={2.4} color="#C6A9CF" />
        </button>

        {TEACHER_MODE_ENABLED && (
          <button
            type="button"
            className="ob-role-card ob-role-card--teacher hy-press"
            onClick={onTeacher}
            disabled={busy}
            data-progress-owner="child-start"
          >
            <span className="ob-role-ic ob-role-ic--teacher">
              <img
                className="ob-role-img"
                src={asset(ROLE_ICON_ASSETS.teacher)}
                alt=""
                loading="eager"
                decoding="async"
              />
            </span>
            <span className="ob-role-main">
              <span className="ob-role-name" style={{ color: "#0F7A57" }}>{intl.formatMessage({ id: "onboarding.role.teacher.title" })}</span>
              <span className="ob-role-desc" style={{ color: "#5FA98A" }}>{intl.formatMessage({ id: "onboarding.role.teacher.description" })}</span>
            </span>
            <ChevronRight size={22} strokeWidth={2.4} color="#9AD3BE" />
          </button>
        )}
      </div>

      <div className="ob-role-terms">
        <FormattedMessage
          id="onboarding.role.legalConsent"
          values={{
            terms: (chunks) => <a href={TERMS_OF_SERVICE_URL} target="_blank" rel="noopener noreferrer">{chunks}</a>,
            privacy: (chunks) => <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer">{chunks}</a>,
          }}
        />
      </div>
    </div>
  );
}

/* ── STEP: TEACHER SETUP (백엔드 배선은 Slice 9) ────────────────────────── */

function TeacherStep({ onBack, onSave, show }: { onBack: () => void; onSave: () => void; show: Show }) {
  const intl = useIntl();
  const [school, setSchool] = useState("");
  const [klass, setKlass] = useState("");

  const save = () => {
    if (!school.trim() || !klass.trim()) {
      show(intl.formatMessage({ id: "onboarding.teacher.missingFields" }), "✏️");
      return;
    }
    show(intl.formatMessage({ id: "onboarding.teacher.savedPending" }, { school, className: klass }), "🎓");
    onSave();
  };

  return (
    <div className="ob-step ob-teacher">
      <BackButton onBack={onBack} />
      <div className="ob-teacher-head">
        <div className="ob-teacher-logo">
          <img src={asset("cat/study.webp")} alt="" />
        </div>
        <div className="ob-h1">{intl.formatMessage({ id: "onboarding.teacher.title" })}</div>
        <div className="ob-teacher-sub">
          <FormattedMessage id="onboarding.teacher.subtitle" values={{ br: () => <br /> }} />
        </div>
      </div>

      <div className="ob-teacher-form">
        <Field label={intl.formatMessage({ id: "onboarding.teacher.schoolLabel" })}>
          <input
            className="ob-input ob-input--tall"
            aria-label={intl.formatMessage({ id: "onboarding.teacher.schoolLabel" })}
            placeholder={intl.formatMessage({ id: "onboarding.teacher.schoolPlaceholder" })}
            value={school}
            onChange={(e) => setSchool(e.target.value)}
          />
        </Field>
        <Field label={intl.formatMessage({ id: "onboarding.teacher.classLabel" })}>
          <input
            className="ob-input ob-input--tall"
            aria-label={intl.formatMessage({ id: "onboarding.teacher.classLabel" })}
            placeholder={intl.formatMessage({ id: "onboarding.teacher.classPlaceholder" })}
            value={klass}
            onChange={(e) => setKlass(e.target.value)}
          />
        </Field>
      </div>

      <div className="ob-teacher-note hy-explain">
        <span className="ob-teacher-note__ic"><Link2 size={18} strokeWidth={2.2} /></span>
        <span className="ob-teacher-note__tx hy-explain__lines">
          <span className="hy-explain__line"><FormattedMessage id="onboarding.teacher.noteInvite" values={{ strong: (chunks) => <strong>{chunks}</strong> }} /></span>
          <span className="hy-explain__line">{intl.formatMessage({ id: "onboarding.teacher.noteApproval" })}</span>
          <span className="hy-explain__line">{intl.formatMessage({ id: "onboarding.teacher.notePrivacy" })}</span>
        </span>
      </div>

      <button type="button" className="ob-cta ob-cta--green hy-press" onClick={save}>
        {intl.formatMessage({ id: "onboarding.teacher.submit" })}
      </button>
    </div>
  );
}

/* ── STEP: LOGIN ───────────────────────────────────────────────────────── */

function LoginStep({
  busy,
  setBusy,
  commitBoundaryActive,
  onOAuthExternalOpen,
  onOAuthExternalEnd,
  onBack,
  onLoggedIn,
  onSignup,
  show,
}: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  commitBoundaryActive: boolean;
  onOAuthExternalOpen: () => void;
  onOAuthExternalEnd: () => void;
  onBack: () => void;
  onLoggedIn: (transitionToken: OnboardingAuthTransitionToken) => Promise<void>;
  onSignup: () => void;
  show: Show;
}) {
  const intl = useIntl();
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
      await startWorkerOAuth(provider, "login", { onExternalOpen: onOAuthExternalOpen });
    } catch (e) {
      if (!isOnboardingAuthTransitionActive(transitionToken)) return;
      onOAuthExternalEnd();
      show(localizeApiError(e, intl, "formal"), "⚠️");
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
      show(localizeApiError(e, intl, "formal"), "⚠️");
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
        <div className="ob-h1">{intl.formatMessage({ id: "onboarding.login.title" })}</div>
        <div className="ob-sub">{intl.formatMessage({ id: "onboarding.login.subtitle" })}</div>
      </div>

      <div className="ob-login-social">
        <button type="button" className="ob-social ob-social--kakao hy-press hy-busy-quiet" onClick={() => social("kakao")} disabled={busy} aria-busy={busy && pendingAction === "kakao"}>
          <KakaoIcon />
          <BusyLabel busy={busy && pendingAction === "kakao"} idle={intl.formatMessage({ id: "onboarding.login.kakao" })} pending={intl.formatMessage({ id: "onboarding.login.kakaoPending" })} />
        </button>
        <button type="button" className="ob-social ob-social--google hy-press hy-busy-quiet" onClick={() => social("google")} disabled={busy} aria-busy={busy && pendingAction === "google"}>
          <GoogleIcon />
          <BusyLabel busy={busy && pendingAction === "google"} idle={intl.formatMessage({ id: "onboarding.login.google" })} pending={intl.formatMessage({ id: "onboarding.login.googlePending" })} />
        </button>
        {/* 네이버 키가 없으면 버튼 자체를 숨긴다 — 누르면 실패하는 버튼을 보여주지 않는다. */}
        {hasNaverClientId && (
          <button type="button" className="ob-social ob-social--naver hy-press hy-busy-quiet" onClick={() => social("naver")} disabled={busy} aria-busy={busy && pendingAction === "naver"}>
            <NaverIcon />
            <BusyLabel busy={busy && pendingAction === "naver"} idle={intl.formatMessage({ id: "onboarding.login.naver" })} pending={intl.formatMessage({ id: "onboarding.login.naverPending" })} />
          </button>
        )}
      </div>

      <div className="ob-divider">
        <span />
        <em>{intl.formatMessage({ id: "onboarding.login.orId" })}</em>
        <span />
      </div>

      <div className="ob-login-form">
        <div className="ob-login-field">
          <input
            ref={loginIdInputRef}
            className="ob-input"
            placeholder={intl.formatMessage({ id: "onboarding.field.loginId" })}
            aria-label={intl.formatMessage({ id: "onboarding.field.loginId" })}
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
              {intl.formatMessage({ id: "onboarding.validation.loginIdRequired" })}
            </p>
          )}
        </div>
        <div className="ob-login-field">
          <input
            ref={passwordInputRef}
            className="ob-input"
            type="password"
            placeholder={intl.formatMessage({ id: "onboarding.field.password" })}
            aria-label={intl.formatMessage({ id: "onboarding.field.password" })}
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
              {intl.formatMessage({ id: "onboarding.validation.passwordRequired" })}
            </p>
          )}
        </div>
        <button type="button" className="ob-loginbtn hy-press hy-busy-quiet" onClick={loginIdPw} disabled={busy} aria-busy={busy && pendingAction === "id"}>
          <BusyLabel busy={busy && pendingAction === "id"} idle={intl.formatMessage({ id: "onboarding.login.submit" })} pending={intl.formatMessage({ id: "onboarding.login.pending" })} />
        </button>
      </div>

      <div className="ob-login-foot">
        {intl.formatMessage({ id: "onboarding.login.noAccount" })}{" "}
        <button
          type="button"
          className="ob-link"
          onClick={onSignup}
          disabled={busy || commitBoundaryActive}
          data-progress-owner="login-action"
        >
          {intl.formatMessage({ id: "onboarding.login.signup" })}
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
  const intl = useIntl();
  return (
    <div className="ob-step ob-survey">
      <BackButton onBack={onBack} />
      <SignupProgress percent={20} label={intl.formatMessage({ id: "onboarding.progress.survey" })} />
      <div className="ob-survey-head">
        <div className="ob-signup-title">{intl.formatMessage({ id: "onboarding.survey.title" })}</div>
        <div className="ob-sub">
          <FormattedMessage id="onboarding.survey.subtitle" values={{ br: () => <br /> }} />
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
              <span className="ob-survey-check" aria-hidden="true">
                {on && <Check size={16} strokeWidth={2.4} />}
              </span>
              <span className="ob-survey-main">
                <span className="ob-survey-title">{intl.formatMessage({ id: option.titleId })}</span>
                <span className="ob-survey-sub">{intl.formatMessage({ id: option.subId })}</span>
              </span>
            </button>
          );
        })}
      </div>

      <button type="button" className="ob-cta ob-cta--accent hy-press" onClick={onNext}>
        {selected.length > 0
          ? intl.formatMessage({ id: "onboarding.action.next" })
          : intl.formatMessage({ id: "onboarding.action.continueWithoutSelecting" })}
      </button>
    </div>
  );
}

const GENDERS = [
  { value: "mom", labelId: "onboarding.guardian.mom" },
  { value: "dad", labelId: "onboarding.guardian.dad" },
  { value: "guardian", labelId: "onboarding.guardian.other" },
] as const;

function SignupStep({
  busy,
  setBusy,
  referralDraft,
  onReferralDraftChange,
  onBack,
  onDone,
  show,
}: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  referralDraft: string;
  onReferralDraftChange: (value: string) => void;
  onBack: () => void;
  onDone: (name: string) => void;
  show: Show;
}) {
  const intl = useIntl();
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
  const signupActionControllerRef = useRef(createAsyncActionController<SignupPendingAction>());
  const [pendingSignupAction, setPendingSignupAction] = useState<AsyncActionToken<SignupPendingAction> | null>(null);

  const beginSignupAction = (action: SignupPendingAction): AsyncActionToken<SignupPendingAction> => {
    const token = signupActionControllerRef.current.begin(action);
    setPendingSignupAction(token);
    setBusy(true);
    return token;
  };

  const finishSignupAction = (requestToken: AsyncActionToken<SignupPendingAction>) => {
    setPendingSignupAction((current) => current === requestToken ? null : current);
    setBusy(false);
  };

  const requestCode = async () => {
    if (busy) return;
    const requestToken = beginSignupAction("request-code");
    await runOwnedAsyncAction({
      controller: signupActionControllerRef.current,
      token: requestToken,
      request: () => requestPhoneSignupCode({ name, loginId, password, passwordConfirm, gender, birthdate, phone }),
      onSuccess: (result) => {
        setPending(result);
        setPhase("otp");
        show(intl.formatMessage({ id: "onboarding.toast.otpSent" }), "📩");
      },
      onError: (error) => show(localizeApiError(error, intl, "formal"), "⚠️"),
      onFinally: () => finishSignupAction(requestToken),
    });
  };

  const verify = async () => {
    if (busy || !pending) return;
    const requestToken = beginSignupAction("verify");
    await runOwnedAsyncAction({
      controller: signupActionControllerRef.current,
      token: requestToken,
      request: () => verifyPhoneSignupCode(
        { phone: pending.phone, token: otp, profile: pending.profile, password: pending.password },
        { sessionAdoption: "deferred" },
      ),
      onSuccess: (result) => {
        adoptAuthResult(result);
        show(intl.formatMessage({ id: "onboarding.toast.signupComplete" }), "🎉");
        onDone(name);
      },
      onError: (error) => show(localizeApiError(error, intl, "formal"), "⚠️"),
      onFinally: () => finishSignupAction(requestToken),
    });
  };

  if (phase === "otp") {
    return (
      <div className="ob-step ob-signup">
        <BackButton onBack={() => setPhase("form")} disabled={busy} />
        <SignupProgress percent={60} label={intl.formatMessage({ id: "onboarding.progress.phone" })} />
        <div className="ob-signup-head">
          <div className="ob-signup-title">{intl.formatMessage({ id: "onboarding.signup.otpTitle" })}</div>
          <div className="ob-sub">{intl.formatMessage({ id: "onboarding.signup.otpDescription" }, { phone: pending?.phoneStorage ?? "" })}</div>
        </div>
        <div className="ob-signup-form">
          <Field label={intl.formatMessage({ id: "onboarding.field.otp" })}>
            <input
              className="ob-input"
              aria-label={intl.formatMessage({ id: "onboarding.field.otp" })}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </Field>
        </div>
        <button
          type="button"
          className="ob-cta ob-cta--accent hy-press hy-busy-quiet"
          onClick={verify}
          disabled={busy}
          aria-busy={busy && isAsyncActionTokenFor(pendingSignupAction, "verify")}
        >
          <BusyLabel
            busy={busy && isAsyncActionTokenFor(pendingSignupAction, "verify")}
            idle={intl.formatMessage({ id: "onboarding.signup.verify" })}
            pending={intl.formatMessage({ id: "onboarding.signup.verifying" })}
          />
        </button>
        {/* 재전송은 requestPhoneSignupCode 를 다시 호출(실 전송) */}
        <div className="ob-login-foot">
          {intl.formatMessage({ id: "onboarding.signup.otpMissing" })}{" "}
          <button
            type="button"
            className="ob-link hy-busy-quiet"
            onClick={requestCode}
            disabled={busy}
            aria-busy={busy && isAsyncActionTokenFor(pendingSignupAction, "request-code")}
          >
            <BusyLabel
              busy={busy && isAsyncActionTokenFor(pendingSignupAction, "request-code")}
              idle={intl.formatMessage({ id: "onboarding.signup.resend" })}
              pending={intl.formatMessage({ id: "onboarding.signup.resending" })}
            />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ob-step ob-signup">
      <BackButton onBack={onBack} disabled={busy} />
      <SignupProgress percent={40} label={intl.formatMessage({ id: "onboarding.progress.account" })} />
      <div className="ob-signup-head">
        <div className="ob-signup-title">{intl.formatMessage({ id: "onboarding.signup.title" })}</div>
        <div className="ob-sub">{intl.formatMessage({ id: "onboarding.signup.subtitle" })}</div>
      </div>

      <div className="ob-signup-form">
        <Field label={intl.formatMessage({ id: "onboarding.field.name" })}>
          <input className="ob-input" aria-label={intl.formatMessage({ id: "onboarding.field.name" })} placeholder={intl.formatMessage({ id: "onboarding.field.namePlaceholder" })} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={intl.formatMessage({ id: "onboarding.field.loginId" })}>
          <input className="ob-input" aria-label={intl.formatMessage({ id: "onboarding.field.loginId" })} placeholder={intl.formatMessage({ id: "onboarding.field.loginIdPlaceholder" })} autoCapitalize="none" value={loginId} onChange={(e) => setLoginId(e.target.value)} />
        </Field>
        <Field label={intl.formatMessage({ id: "onboarding.field.password" })}>
          <input className="ob-input" type="password" aria-label={intl.formatMessage({ id: "onboarding.field.password" })} placeholder={intl.formatMessage({ id: "onboarding.field.passwordPlaceholder" })} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label={intl.formatMessage({ id: "onboarding.field.passwordConfirm" })}>
          <input className="ob-input" type="password" aria-label={intl.formatMessage({ id: "onboarding.field.passwordConfirm" })} placeholder={intl.formatMessage({ id: "onboarding.field.passwordConfirmPlaceholder" })} value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />
        </Field>
        <Field label={intl.formatMessage({ id: "onboarding.field.guardianType" })}>
          <div style={{ display: "flex", gap: 8 }}>
            {GENDERS.map((g) => (
              <button
                key={g.value}
                type="button"
                className="hy-press"
                onClick={() => setGender(g.value)}
                style={{
                  flex: 1,
                  height: 48,
                  borderRadius: 12,
                  fontWeight: 700,
                  fontSize: "var(--type-body-sm)",
                  border: gender === g.value ? "none" : "1.5px solid var(--line-strong)",
                  background: gender === g.value ? "var(--hy-accent-cta)" : "#fff",
                  color: gender === g.value ? "#fff" : "var(--fg-body)",
                }}
              >
                {intl.formatMessage({ id: g.labelId })}
              </button>
            ))}
          </div>
        </Field>
        <Field label={intl.formatMessage({ id: "onboarding.field.birthdate" })}>
          <input className="ob-input" type="date" aria-label={intl.formatMessage({ id: "onboarding.field.birthdate" })} value={birthdate} onChange={(e) => setBirthdate(e.target.value)} />
        </Field>
        <Field label={intl.formatMessage({ id: "onboarding.field.phone" })}>
          <input className="ob-input" inputMode="tel" aria-label={intl.formatMessage({ id: "onboarding.field.phone" })} placeholder={intl.formatMessage({ id: "onboarding.field.phonePlaceholder" })} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <ReferralCodeField
          value={referralDraft}
          onChange={onReferralDraftChange}
          disabled={busy}
        />
      </div>

      <button
        type="button"
        className="ob-cta ob-cta--accent hy-press hy-busy-quiet"
        onClick={requestCode}
        disabled={busy}
        aria-busy={busy && isAsyncActionTokenFor(pendingSignupAction, "request-code")}
      >
        <BusyLabel
          busy={busy && isAsyncActionTokenFor(pendingSignupAction, "request-code")}
          idle={intl.formatMessage({ id: "onboarding.signup.requestOtp" })}
          pending={intl.formatMessage({ id: "onboarding.signup.requestingOtp" })}
        />
      </button>
    </div>
  );
}

/* ── STEP: CONNECT ─────────────────────────────────────────────────────── */

function ConnectStep({
  busy,
  progressPercent,
  referralCode,
  referralDraft,
  onReferralDraftChange,
  onBack,
  onNewFamily,
  onJoin,
  onChildDevice,
}: {
  busy: boolean;
  progressPercent?: number | null;
  referralCode?: string | null;
  referralDraft: string;
  onReferralDraftChange: (value: string) => void;
  onBack: () => void;
  onNewFamily: () => void | Promise<void>;
  onJoin: () => void | Promise<void>;
  onChildDevice: () => void | Promise<void>;
}) {
  const intl = useIntl();
  const [pendingAction, setPendingAction] = useState<"new-family" | "join" | "child-device" | null>(null);
  const runAction = (
    action: Exclude<typeof pendingAction, null>,
    callback: () => void | Promise<void>,
  ) => {
    if (busy || pendingAction) return;
    setPendingAction(action);
    void Promise.resolve().then(callback).finally(() => setPendingAction(null));
  };

  return (
    <div className="ob-step ob-connect">
      <BackButton onBack={onBack} />
      {progressPercent != null && <SignupProgress percent={progressPercent} label={intl.formatMessage({ id: "onboarding.progress.family" })} />}
      <div className="ob-connect-head">
        <img className="ob-connect-mascot" src={asset("mascot/family.webp")} alt="" />
        <div className="ob-h1">{intl.formatMessage({ id: "onboarding.connect.title" })}</div>
        <div className="ob-sub">{intl.formatMessage({ id: "onboarding.connect.subtitle" })}</div>
      </div>

      <div className="ob-referral-notice" role="status">
        <strong>
          {referralCode
            ? intl.formatMessage({ id: "onboarding.connect.referralTitle" })
            : intl.formatMessage({ id: "onboarding.field.referralCode" })}
        </strong>
        <span>
          {referralCode
            ? intl.formatMessage(
              { id: "onboarding.connect.referralDescription" },
              { count: REFERRAL_REWARD_CREDITS_DISPLAY },
            )
            : intl.formatMessage({ id: "onboarding.field.referralCodeHint" })}
        </span>
        <ReferralCodeField
          value={referralDraft}
          onChange={onReferralDraftChange}
          disabled={busy}
          hideLabel
        />
      </div>

      <div className="ob-connect-list">
        <button
          type="button"
          className="ob-connect-card hy-press"
          onClick={() => runAction("new-family", onNewFamily)}
          disabled={busy}
          aria-busy={pendingAction === "new-family"}
        >
          <img className="ob-connect-ic" src={asset("ui/place-home.webp")} alt="" />
          <span className="ob-connect-main">
            <span className="ob-connect-name">{intl.formatMessage({ id: "onboarding.connect.newFamily" })}</span>
            <span className="ob-connect-desc">{intl.formatMessage({ id: "onboarding.connect.newFamilyDescription" })}</span>
          </span>
          <ChevronRight size={20} strokeWidth={2.4} color="#C9BFC4" />
        </button>

        <button
          type="button"
          className="ob-connect-card hy-press"
          onClick={() => runAction("join", onJoin)}
          disabled={busy}
          aria-busy={pendingAction === "join"}
        >
          <img className="ob-connect-ic" src={asset("ui/friend-pair.webp")} alt="" />
          <span className="ob-connect-main">
            <span className="ob-connect-name">{intl.formatMessage({ id: "onboarding.connect.joinFamily" })}</span>
            <span className="ob-connect-desc">{intl.formatMessage({ id: "onboarding.connect.joinFamilyDescription" })}</span>
          </span>
          <ChevronRight size={20} strokeWidth={2.4} color="#C9BFC4" />
        </button>

        <button
          type="button"
          className="ob-connect-card ob-connect-card--child hy-press"
          onClick={() => runAction("child-device", onChildDevice)}
          disabled={busy}
          aria-busy={pendingAction === "child-device"}
        >
          <img className="ob-connect-ic" src={asset(DEFAULT_CHILD_AVATAR)} alt="" />
          <span className="ob-connect-main">
            <span className="ob-connect-name" style={{ color: "#6D4E9C" }}>{intl.formatMessage({ id: "onboarding.connect.childDevice" })}</span>
            <span className="ob-connect-desc" style={{ color: "#9B7FB8" }}>{intl.formatMessage({ id: "onboarding.connect.childDeviceDescription" })}</span>
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
  onPermissionTransitionStart,
  onPermissionTransitionCancel,
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
  onPermissionTransitionStart: () => void;
  onPermissionTransitionCancel: () => void;
  show: Show;
  setBusy: (v: boolean) => void;
}) {
  const intl = useIntl();
  const [raw, setRaw] = useState(initialCode ?? "");
  const [showScanner, setShowScanner] = useState(false);

  // rawCode: 스캔 rawValue 또는 입력값. 딥링크 URL(#/onboarding?pair=KID-…)도
  // normalizePairCodeInput 의 KID- 직접매치로 코드가 추출된다.
  const submit = async (rawCode?: string) => {
    if (busy) return;
    const code = normalizePairCodeInput(rawCode ?? raw);
    if (!code) {
      show(
        intl.formatMessage({ id: rawCode != null ? "onboarding.pairing.invalidQr" : "onboarding.pairing.invalidCode" }),
        "🔢",
      );
      return;
    }
    setRaw(code);
    setBusy(true);
    let permissionTransitionStarted = false;
    try {
      if (mode === "child") {
        const nextHint = await readChildDeviceIdentityHint();
        onPermissionTransitionStart();
        permissionTransitionStarted = true;
        await joinFamily(code, childJoinHint ?? nextHint);
      } else {
        onPermissionTransitionStart();
        permissionTransitionStarted = true;
        await joinFamilyAsParent(code);
      }
      onPaired();
      show(intl.formatMessage({ id: "onboarding.toast.familyConnected" }), "🔗");
      onDone();
    } catch (e) {
      if (permissionTransitionStarted) onPermissionTransitionCancel();
      show(localizeApiError(e, intl, "formal"), "⚠️");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ob-step ob-pairing">
      <BackButton onBack={onBack} dark />
      <div className="ob-pair-head">
        <div className="ob-pair-title">{intl.formatMessage({ id: "onboarding.pairing.title" })}</div>
        <div className="ob-pair-sub">{intl.formatMessage({ id: "onboarding.pairing.description" })}</div>
        <div className="ob-pair-sub">{intl.formatMessage({ id: "onboarding.pairing.recovery" })}</div>
      </div>

      {/* 탭하면 실제 카메라 스캐너 오버레이(BarcodeDetector)가 열린다. */}
      <button
        type="button"
        className="ob-qr hy-press"
        aria-label={intl.formatMessage({ id: "onboarding.pairing.scanLabel" })}
        onClick={() => setShowScanner(true)}
        disabled={busy}
        data-progress-owner="pair-submit"
      >
        <span className="ob-qr-corner ob-qr-corner--tl" />
        <span className="ob-qr-corner ob-qr-corner--tr" />
        <span className="ob-qr-corner ob-qr-corner--bl" />
        <span className="ob-qr-corner ob-qr-corner--br" />
        <span className="ob-qr-scan" />
        <span className="ob-qr-cta"><Camera size={16} strokeWidth={2.4} /> {intl.formatMessage({ id: "onboarding.pairing.scanAction" })}</span>
      </button>

      <div className="ob-pair-hint">{intl.formatMessage({ id: "onboarding.pairing.manualHint" })}</div>

      <input
        className="ob-input"
        aria-label={intl.formatMessage({ id: "onboarding.pairing.codeLabel" })}
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
        aria-busy={busy}
      >
        {intl.formatMessage({ id: busy ? "onboarding.pairing.connecting" : "onboarding.pairing.submit" })}
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
  const intl = useIntl();
  const permissionItems = role === "child" ? CHILD_PERM_ITEMS : GUARDIAN_PERM_ITEMS;
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);

  const start = () => {
    if (role !== "child") {
      onDone();
      return;
    }
    setLocationDialogOpen(true);
  };

  const finishLocationSetup = () => {
    setLocationDialogOpen(false);
    onDone();
  };

  return (
    <div className="ob-step ob-perms">
      {progressPercent != null && <SignupProgress percent={progressPercent} label={intl.formatMessage({ id: "onboarding.progress.permissions" })} />}
      <div className="ob-perms-head">
        <img className="ob-perms-mascot" src={asset("mascot/wave.webp")} alt="" />
        <div className="ob-h1">{intl.formatMessage({ id: role === "child" ? "onboarding.permissions.title.child" : "onboarding.permissions.title.formal" })}</div>
        <div className="ob-sub">{intl.formatMessage({ id: role === "child" ? "onboarding.permissions.subtitle.child" : "onboarding.permissions.subtitle.formal" })}</div>
      </div>

      <div className="ob-perms-list">
        {permissionItems.map((p) => (
          <div key={p.id} className="ob-perm">
            <img className="ob-perm-ic" src={asset(p.icon)} alt="" />
            <span className="ob-perm-main">
              <span className="ob-perm-title">{intl.formatMessage({ id: p.titleId })}</span>
              <span className="ob-perm-sub">{intl.formatMessage({ id: p.subId })}</span>
            </span>
            {/* 권한은 시작 시 실제로 요청됨 — 아직 '허용됨'이 아니므로 '예정' 배지로 정직 표기 */}
            <span className="ob-perm-check">
              {intl.formatMessage({ id: "onboarding.permissions.planned" })}
            </span>
          </div>
        ))}
      </div>

      <button type="button" className="ob-cta ob-cta--lav hy-press" onClick={start}>
        {intl.formatMessage({ id: role === "child" ? "onboarding.permissions.startChild" : "onboarding.permissions.startFormal" })}
      </button>

      <ChildLocationPermissionDialog
        open={locationDialogOpen}
        copyMode="formal"
        onDismiss={finishLocationSetup}
        onPermissionGranted={finishLocationSetup}
      />
    </div>
  );
}
