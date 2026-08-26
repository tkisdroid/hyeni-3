import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useNavigate } from "react-router";
import { Camera, Check, ChevronLeft, ChevronRight, Link2, LogOut } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { deriveAuthState, useAuth } from "@/auth/AuthContext";
import { ChildLocationPermissionDialog } from "@/components/ChildLocationPermissionDialog";
import { usageAccessPromptStorageKey } from "@/transform/usageAccessPrompt";
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
  checkLoginIdAvailability,
  requestPhoneSignupCode,
  verifyPhoneSignupCode,
  startWorkerOAuth,
  finishOAuthCancellation,
  finishOAuthLogin,
  readOAuthCancellation,
  readOAuthCallback,
  clearOAuthCallbackUrl,
  hasLocalOAuthContext,
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
import { isPairingMembershipConfirmed } from "@/transform/pairingConfirmation";
import { consumeSessionEndReason } from "@/auth/sessionEndReason";
import { isNativePlatform } from "@/lib/native/plugins";

// QrScanner(+jsQR 폴백 디코더)는 스캔 버튼을 누른 시점에만 내려받는다.
const QrScanner = lazy(() =>
  import("@/components/QrScanner").then((module_) => ({ default: module_.QrScanner })),
);
import { readPairInvite, readPairParam, clearPairParam } from "@/transform/pairLink";
import {
  REFERRAL_CODE_EVENT,
  clearReferralParam,
  extractReferralCodeFromInput,
  persistReferralCode,
  readReferralParam,
} from "@/transform/referralLink";
import { REFERRAL_REWARD_CREDITS_DISPLAY } from "@/transform/referralReward";
import { resolveAuthenticatedOnboardingRedirect } from "@/transform/onboardingRedirect";

import { LanguageSelector } from "@/components/LanguageSelector";
import { BusyLabel } from "@/components/ui/BusyLabel";
import {
  PRIVACY_POLICY_URL,
  TERMS_OF_SERVICE_URL,
} from "@/lib/api/endpoints/account";
import {
  validateLoginForm,
  type LoginFormErrors,
  type LoginFormInput,
} from "@/transform/loginForm";
import {
  createLoginActionGate,
  isAutofilledLoginInput,
  LOGIN_AUTOFILL_ANIMATION_NAME,
  resolveLoginAutofillSubmission,
} from "@/transform/loginAutofill";
import {
  isValidLoginId,
  normalizeLoginId,
  validateParentSignupForm,
  type ParentSignupErrors,
} from "@/transform/phone";
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
import { useLocale } from "@/i18n/useLocale";
import { ApiError, isApiError } from "@/lib/api/errors";
import { socialProvidersForAccessCountry } from "@/transform/accessCountry";
import {
  resolvePairInviteAction,
  resolvePostAuthAction,
  resolveSignupContinuation,
  type SignupMethod,
} from "@/transform/onboardingFlow";
import {
  clearOnboardingDraft,
  persistOnboardingDraft,
  readOnboardingDraft,
  type PendingPairInvite,
} from "@/transform/onboardingDraft";
import type { OnboardingInterest } from "@/transform/onboardingPreferences";

type Step = "role" | "teacherSetup" | "login" | "survey" | "signup" | "connect" | "pairing" | "perms";
type AuthIntent = "login" | "signup";
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
] as const satisfies readonly {
  id: OnboardingInterest;
  titleId: string;
  subId: string;
}[];

/** 온보딩: 역할선택→로그인/가입→가족연결→페어링→권한. 실제 Worker 인증 배선. */
export function Onboarding() {
  const navigate = useNavigate();
  const intl = useIntl();
  const { accessCountry } = useLocale();
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
  const [initialDraft] = useState(() => readOnboardingDraft());
  const [initialAuthState] = useState(() => deriveAuthState());
  const [sessionEndedOnAnotherDevice] = useState(
    () => consumeSessionEndReason() === "device_session_inactive",
  );
  const [step, setStep] = useState<Step>(() =>
    initialDraft?.signupMethod
      ? "survey"
      : initialDraft?.pairInvite?.role === "parent"
        ? initialAuthState.status === "authenticated" && initialAuthState.role === "parent" && !initialAuthState.familyId
          ? "pairing"
          : "login"
        : "role",
  );
  const [authIntent, setAuthIntent] = useState<AuthIntent>(() => initialDraft?.signupMethod ? "signup" : "login");
  const [authEntryError, setAuthEntryError] = useState<string | null>(null);
  const [role, setRole] = useState<"parent" | "child" | "teacher">("parent");
  const [pairMode, setPairMode] = useState<"child" | "parent">(() =>
    initialDraft?.pairInvite?.role === "parent" ? "parent" : "child",
  );
  const [busy, setBusy] = useState(false);
  const [childStarting, setChildStarting] = useState(false);
  const [childJoinHint, setChildJoinHint] = useState<JoinFamilyOptions | null>(null);
  const [signupFlowStarted, setSignupFlowStarted] = useState(() => Boolean(initialDraft?.signupMethod));
  const [signupMethod, setSignupMethod] = useState<SignupMethod>(() => initialDraft?.signupMethod ?? { kind: "phone" });
  const [surveyChoices, setSurveyChoices] = useState<OnboardingInterest[]>(() => initialDraft?.surveyChoices ?? []);
  const [pendingPairInvite, setPendingPairInvite] = useState<PendingPairInvite | null>(() => initialDraft?.pairInvite ?? null);
  const permissionTransitionRef = useRef<OnboardingPermissionTransition | null>(null);
  // 전화 OTP 가입 시 입력한 이름 — 가입 직후 세션 user_metadata 가 비어 parentNameFromUser 가
  // "부모"로 깨지므로, 이 이름을 setupFamily(새 가족)의 parentName 으로 우선 사용한다.
  const [signupName, setSignupName] = useState<string | null>(null);
  // QR 딥링크(?pair=)로 진입 시 아이 코드 프리필.
  const [pairPrefill, setPairPrefill] = useState<string | null>(() => initialDraft?.pairInvite?.code ?? null);
  // 친구 초대 ref는 가족 생성 성공 전까지 유지해 로그인·가입 단계를 지나도 귀속한다.
  const [referralPrefill, setReferralPrefill] = useState<string | null>(() => readReferralParam());
  const [referralDraft, setReferralDraft] = useState(() => readReferralParam() ?? "");
  const oauthLoginPromiseRef = useRef<ReturnType<typeof finishOAuthLogin> | null>(null);
  const oauthExternalBusyRef = useRef(false);
  const [oauthExternalBusy, setOAuthExternalBusy] = useState(false);

  const preservePendingInviteOnly = () => {
    if (pendingPairInvite) {
      persistOnboardingDraft({ pairInvite: pendingPairInvite, signupMethod: null, surveyChoices: [] });
      return;
    }
    clearOnboardingDraft();
  };

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
    const currentRole = deriveAuthState().role;
    const destination = homePathForRole(
      currentRole ?? (role === "parent" ? "parent" : role === "child" ? "child" : "teacher"),
    );
    const transition = permissionTransitionRef.current;
    permissionTransitionRef.current = null;
    clearOnboardingDraft();
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
      const restored = readOnboardingDraft() ?? initialDraft;
      try {
        finishOAuthCancellation(cancellation);
        show(intl.formatMessage({ id: "onboarding.toast.socialCancelled" }), "ℹ️");
      } catch (e) {
        const message = localizeApiError(e, intl, "formal");
        setAuthEntryError(message);
        show(message, "⚠️");
      } finally {
        cancelOnboardingAuthTransitions();
        clearOAuthExternalBusy();
        clearOAuthCallbackUrl();
        setBusy(false);
        setRole("parent");
        if (restored?.signupMethod) {
          setSignupMethod(restored.signupMethod);
          setSurveyChoices(restored.surveyChoices);
          setSignupFlowStarted(true);
          setAuthIntent("signup");
          setStep("survey");
        } else {
          setAuthIntent("login");
          setStep("login");
        }
      }
      return;
    }
    const cb = readOAuthCallback();
    if (!cb) return;
    // 네이티브 OAuth transaction의 콜백이 App Link 검증 실패 등으로 브라우저에 떨어진 경우다.
    // 이 브라우저에는 state·transactionSecret이 없어 교환이 불가능하므로, 죽은 코드로
    // 네트워크를 때리는 대신 앱에서 다시 시도하라고 정직하게 안내한다(코드는 서버가 소비 안 함).
    if (!isNativePlatform() && !hasLocalOAuthContext()) {
      clearOAuthCallbackUrl();
      setAuthEntryError(intl.formatMessage({ id: "onboarding.oauth.returnToApp" }));
      show(intl.formatMessage({ id: "onboarding.oauth.returnToApp" }), "⚠️");
      return;
    }
    const callbackDraft = readOnboardingDraft() ?? initialDraft;
    setBusy(true);
    const transitionToken = beginOnboardingAuthTransition();
    const oauthLoginPromise = oauthLoginPromiseRef.current
      ?? finishOAuthLogin(cb, {
        sessionAdoption: "deferred",
        onboardingInterests: callbackDraft?.signupMethod?.kind === "oauth"
          ? callbackDraft.surveyChoices
          : undefined,
      });
    oauthLoginPromiseRef.current = oauthLoginPromise;
    oauthLoginPromise
      .then(async (result) => {
        const commitResult = commitOnboardingAuthResult(transitionToken, result, adoptAuthResult);
        if (commitResult === "stale") return;
        clearOAuthExternalBusy();
        clearOAuthCallbackUrl();
        syncFromSession();
        if (
          callbackDraft?.signupMethod?.kind === "oauth"
          && (result.account_status === "existing" || result.account_status === "linked")
        ) {
          show(intl.formatMessage({ id: "onboarding.toast.existingSocialAccount" }), "ℹ️");
        }
        await routeAfterParentLogin(transitionToken, callbackDraft?.pairInvite ?? null);
      })
      .catch((e) => {
        const canApplySideEffects = isOnboardingAuthTransitionActive(transitionToken);
        // 공유 Promise의 OAuth code는 단회용이라 stale continuation도 URL 재교환만 막는다.
        // toast·step·busy 같은 UI 상태는 아래 active token만 변경한다.
        clearOAuthCallbackUrl();
        if (!canApplySideEffects) return;
        clearOAuthExternalBusy();
        const message = localizeApiError(e, intl, "formal");
        setAuthEntryError(message);
        show(message, "⚠️");
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
      cancelOnboardingAuthTransitions();
      setBusy(false);
    };
    document.addEventListener("visibilitychange", unstickOAuth);
    window.addEventListener("pageshow", unstickOAuth);
    return () => {
      document.removeEventListener("visibilitychange", unstickOAuth);
      window.removeEventListener("pageshow", unstickOAuth);
    };
  }, [oauthExternalBusy]);

  // QR 딥링크는 as 역할을 먼저 판정한다. 공동 보호자는 인증을 거치고,
  // 아이 링크만 익명 아이 세션으로 진입한다. OAuth 콜백이 동시에 있으면 그쪽이 우선이다.
  useEffect(() => {
    const invite = readPairInvite()
      ?? (initialDraft?.signupMethod ? null : initialDraft?.pairInvite)
      ?? null;
    if (!invite || readOAuthCallback()) return;
    clearPairParam();
    const current = deriveAuthState();
    const action = resolvePairInviteAction({
      inviteRole: invite.role,
      roleExplicit: invite.roleExplicit,
      authStatus: current.status,
      authRole: current.role,
      familyId: current.familyId,
    });

    if (action === "role-home") {
      clearOnboardingDraft();
      navigate(homePathForRole(current.role), { replace: true });
      return;
    }

    if (action === "choose-role") {
      setPendingPairInvite(invite);
      setPairPrefill(invite.code);
      setPairMode("child");
      persistOnboardingDraft({ pairInvite: invite, signupMethod: null, surveyChoices: [] });
      setStep("role");
      return;
    }

    if (action === "parent-auth") {
      setPendingPairInvite(invite);
      setPairPrefill(invite.code);
      setRole("parent");
      setPairMode("parent");
      setAuthIntent("login");
      setAuthEntryError(null);
      persistOnboardingDraft({ pairInvite: invite, signupMethod: null, surveyChoices: [] });
      setStep("login");
      return;
    }

    if (action === "parent-pair") {
      const parentInvite = { ...invite, role: "parent" as const };
      setPendingPairInvite(parentInvite);
      setPairPrefill(parentInvite.code);
      setRole("parent");
      setPairMode("parent");
      persistOnboardingDraft({ pairInvite: parentInvite, signupMethod: null, surveyChoices: [] });
      setStep("pairing");
      return;
    }

    if (action === "role-mismatch") {
      clearOnboardingDraft();
      setPendingPairInvite(null);
      setPairPrefill(null);
      show(intl.formatMessage({
        id: current.role === "child"
          ? "onboarding.invite.roleMismatchChild"
          : "onboarding.invite.roleMismatch",
      }), "⚠️");
      if (current.role === "parent") {
        setRole("parent");
        setStep("connect");
      } else if (current.role === "child") {
        setRole("child");
        setPairMode("child");
        setStep("pairing");
      } else if (current.role === "teacher") {
        navigate(homePathForRole("teacher"), { replace: true });
      } else {
        setStep("role");
      }
      return;
    }

    setPendingPairInvite(invite);
    setPairPrefill(invite.code);
    persistOnboardingDraft({ pairInvite: invite, signupMethod: null, surveyChoices: [] });
    if (current.status === "authenticated") {
      routeAfterChildSession();
      return;
    }
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
        if (recovered.status === "authenticated") {
          syncFromSession();
          if (routeAfterChildSession()) return;
        }
        await anonymousLogin();
        syncFromSession();
        setRole("child");
        setPairMode("child");
        setStep("pairing");
      })
      .catch((e) => show(localizeApiError(e, intl, "child"), "⚠️"))
      .finally(() => {
        setBusy(false);
        setChildStarting(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const back = () =>
    setStep((s) => {
      if (s === "pairing") setPairMode("child");
      return s === "survey"
        ? "login"
        : s === "signup"
          ? "survey"
          : s === "pairing"
            ? "connect"
            : "role";
    });

  // 부모 로그인/가입 후: 가족 있으면 홈, 없으면 가족연결 단계.
  const routeAfterParentLogin = async (
    transitionToken: OnboardingAuthTransitionToken,
    inviteOverride: PendingPairInvite | null = pendingPairInvite,
  ) => {
    if (!isOnboardingAuthTransitionActive(transitionToken)) return;
    syncFromSession();
    try {
      const current = deriveAuthState();
      if (current.status !== "authenticated" || !current.role) throw new Error("auth_state_invalid");
      if (current.role !== "parent") {
        const action = resolvePostAuthAction({
          authRole: current.role,
          familyExists: Boolean(current.familyId),
          pendingParentInvite: inviteOverride?.role === "parent",
        });
        const completed = completeOnboardingAuthTransitionsThrough(transitionToken);
        if (!completed) return;
        if (inviteOverride?.role === "parent") {
          show(intl.formatMessage({
            id: current.role === "child"
              ? "onboarding.invite.roleMismatchChild"
              : "onboarding.invite.roleMismatch",
          }), "⚠️");
        }
        clearOnboardingDraft();
        setPendingPairInvite(null);
        setBusy(false);
        if (action === "child-pair") {
          setRole("child");
          setPairMode("child");
          setStep("pairing");
          return;
        }
        if (action === "teacher-setup") {
          setRole("teacher");
          setStep("teacherSetup");
          return;
        }
        navigate(homePathForRole(current.role));
        return;
      }
      const fam = await getMyFamily();
      const completed = completeOnboardingAuthTransitionsThrough(transitionToken);
      if (!completed) return;
      setBusy(false);
      const action = resolvePostAuthAction({
        authRole: current.role,
        familyExists: fam !== null,
        pendingParentInvite: inviteOverride?.role === "parent",
      });
      if (action === "parent-pair" && inviteOverride) {
        const parentInvite = { ...inviteOverride, role: "parent" as const };
        setPendingPairInvite(parentInvite);
        setPairPrefill(parentInvite.code);
        setRole("parent");
        setPairMode("parent");
        persistOnboardingDraft({ pairInvite: parentInvite, signupMethod: null, surveyChoices: [] });
        setStep("pairing");
        return;
      }
      clearOnboardingDraft();
      setPendingPairInvite(null);
      if (action === "parent-connect") {
        setStep("connect");
        return;
      }
      clearReferralParam();
      navigate(homePathForRole(current.role));
    } catch {
      throw new Error("family_lookup_failed");
    }
  };

  const startSignupOAuth = async (provider: OAuthProvider) => {
    if (busy) return;
    setAuthEntryError(null);
    persistOnboardingDraft({
      pairInvite: pendingPairInvite,
      signupMethod: { kind: "oauth", provider },
      surveyChoices,
    });
    setBusy(true);
    const transitionToken = beginOnboardingAuthTransition();
    try {
      await startWorkerOAuth(provider, "login", { onExternalOpen: markOAuthExternalBusy });
    } catch (error) {
      if (!isOnboardingAuthTransitionActive(transitionToken)) return;
      clearOAuthExternalBusy();
      const message = localizeApiError(error, intl, "formal");
      setAuthEntryError(message);
      show(message, "⚠️");
      setBusy(false);
      endOnboardingAuthTransition(transitionToken);
    }
  };

  const routeAfterChildSession = () => {
    const state = deriveAuthState();
    if (state.status !== "authenticated") return false;
    if (state.role === "child") {
      setRole("child");
      setPairMode("child");
      if (state.familyId) navigate("/child/home");
      else setStep("pairing");
      return true;
    }
    if (state.role === "parent") {
      setRole("parent");
      if (state.familyId) navigate(homePathForRole("parent"));
      else setStep("connect");
      return true;
    }
    if (state.role === "teacher") {
      setRole("teacher");
      if (state.familyId) navigate(homePathForRole("teacher"));
      else setStep("teacherSetup");
      return true;
    }
    // 역할이 손상된 인증 세션도 익명 세션으로 덮어쓰지 않는다.
    setStep("role");
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
      if (current.status === "authenticated" && routeAfterChildSession()) return;
      // 기기 컨텍스트·네이티브 세션 복구·익명 로그인은 네트워크/브리지 상태에 따라
      // 지연될 수 있다. 카드 탭은 그 준비를 기다리지 않고 아이 연결 화면에 즉시 반영한다.
      // busy는 유지해 익명 세션이 확정되기 전 코드 제출만 막는다.
      setRole("child");
      setPairMode("child");
      setStep("pairing");
      const hint = await readChildDeviceIdentityHint();
      setChildJoinHint(hint);
      if (await adoptNativeLocationSessionTokens()) {
        syncFromSession();
        if (routeAfterChildSession()) return;
      }
      const recovered = deriveAuthState();
      if (recovered.status === "authenticated") {
        syncFromSession();
        if (routeAfterChildSession()) return;
      }
      await anonymousLogin();
      syncFromSession();
      routeAfterChildSession();
    } catch (e) {
      const failedState = deriveAuthState();
      if (failedState.status !== "authenticated") setStep("role");
      show(localizeApiError(e, intl, "child"), "⚠️");
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
          legacyInvite={Boolean(pendingPairInvite && !pendingPairInvite.roleExplicit)}
          sessionEndedOnAnotherDevice={sessionEndedOnAnotherDevice}
          onParent={() => {
            if (authCommitBoundaryActive) return;
            cancelOnboardingAuthTransitions();
            const legacyInvite = pendingPairInvite && !pendingPairInvite.roleExplicit
              ? { ...pendingPairInvite, role: "parent" as const, roleExplicit: true }
              : null;
            if (legacyInvite) {
              setPendingPairInvite(legacyInvite);
              setPairPrefill(legacyInvite.code);
              persistOnboardingDraft({ pairInvite: legacyInvite, signupMethod: null, surveyChoices: [] });
            } else {
              clearOnboardingDraft();
              setPendingPairInvite(null);
              setPairPrefill(null);
            }
            setSignupFlowStarted(false);
            setSurveyChoices([]);
            setSignupMethod({ kind: "phone" });
            setAuthIntent("login");
            setAuthEntryError(null);
            setRole("parent");
            setStep("login");
          }}
          onChild={() => {
            if (authCommitBoundaryActive) return;
            cancelOnboardingAuthTransitions();
            const legacyInvite = pendingPairInvite && !pendingPairInvite.roleExplicit
              ? { ...pendingPairInvite, role: "child" as const, roleExplicit: true }
              : null;
            if (legacyInvite) {
              setPendingPairInvite(legacyInvite);
              setPairPrefill(legacyInvite.code);
              persistOnboardingDraft({ pairInvite: legacyInvite, signupMethod: null, surveyChoices: [] });
            } else {
              clearOnboardingDraft();
              setPendingPairInvite(null);
              setPairPrefill(null);
            }
            void startChildMode();
          }}
          onTeacher={() => {
            if (authCommitBoundaryActive) return;
            cancelOnboardingAuthTransitions();
            clearOnboardingDraft();
            setPendingPairInvite(null);
            setPairPrefill(null);
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
          accessCountry={accessCountry}
          intent={authIntent}
          parentInvite={pendingPairInvite?.role === "parent"}
          sessionEndedOnAnotherDevice={sessionEndedOnAnotherDevice}
          onIntentChange={(nextIntent) => {
            setAuthIntent(nextIntent);
            setAuthEntryError(null);
          }}
          authError={authEntryError}
          onAuthError={setAuthEntryError}
          busy={busy}
          setBusy={setBusy}
          commitBoundaryActive={authCommitBoundaryActive}
          onOAuthExternalOpen={markOAuthExternalBusy}
          onOAuthExternalEnd={clearOAuthExternalBusy}
          onBack={() => {
            if (authCommitBoundaryActive) return;
            cancelOnboardingAuthTransitions();
            if (pendingPairInvite) {
              clearOnboardingDraft();
              setPendingPairInvite(null);
              setPairPrefill(null);
            }
            back();
          }}
          onLoggedIn={async (transitionToken) => {
            setAuthEntryError(null);
            setSignupFlowStarted(false);
            setSurveyChoices([]);
            await routeAfterParentLogin(transitionToken);
          }}
          onSignup={(method) => {
            if (authCommitBoundaryActive) return;
            cancelOnboardingAuthTransitions();
            setSignupMethod(method);
            setAuthIntent("signup");
            setAuthEntryError(null);
            setSignupFlowStarted(true);
            persistOnboardingDraft({ pairInvite: pendingPairInvite, signupMethod: method, surveyChoices });
            setStep("survey");
          }}
          show={show}
        />
      )}
      {step === "survey" && (
        <SurveyStep
          selected={surveyChoices}
          busy={busy}
          socialProvider={signupMethod.kind === "oauth" ? signupMethod.provider : null}
          onBack={() => {
            setSignupFlowStarted(false);
            setAuthIntent("signup");
            preservePendingInviteOnly();
            setStep("login");
          }}
          onToggle={(id) => {
            const next = surveyChoices.includes(id)
              ? surveyChoices.filter((choice) => choice !== id)
              : [...surveyChoices, id];
            setSurveyChoices(next);
            persistOnboardingDraft({ pairInvite: pendingPairInvite, signupMethod, surveyChoices: next });
          }}
          onNext={() => {
            const continuation = resolveSignupContinuation(signupMethod);
            persistOnboardingDraft({ pairInvite: pendingPairInvite, signupMethod, surveyChoices });
            if (continuation.kind === "phone-form") {
              setStep("signup");
              return;
            }
            void startSignupOAuth(continuation.provider);
          }}
        />
      )}
      {step === "signup" && (
        <SignupStep
          busy={busy}
          setBusy={setBusy}
          referralDraft={referralDraft}
          surveyChoices={surveyChoices}
          onReferralDraftChange={applyReferralDraft}
          onBack={back}
          onExistingAccountLogin={() => {
            setSignupFlowStarted(false);
            setSignupMethod({ kind: "phone" });
            setAuthIntent("login");
            setAuthEntryError(null);
            preservePendingInviteOnly();
            setStep("login");
          }}
          onUseSocialSignup={() => {
            setSignupFlowStarted(true);
            setAuthIntent("signup");
            setAuthEntryError(null);
            preservePendingInviteOnly();
            setStep("login");
          }}
          onDone={(name) => {
            setSignupName(name);
            if (pendingPairInvite?.role === "parent") {
              setRole("parent");
              setPairMode("parent");
              persistOnboardingDraft({ pairInvite: pendingPairInvite, signupMethod: null, surveyChoices: [] });
              setStep("pairing");
            } else {
              clearOnboardingDraft();
              setStep("connect");
            }
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
          onBack={() => {
            clearOnboardingDraft();
            setPendingPairInvite(null);
            setPairPrefill(null);
            setStep("role");
          }}
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
        />
      )}
      {step === "pairing" && (
        <PairingStep
          mode={pairMode}
          busy={busy}
          initialCode={pairPrefill}
          childJoinHint={childJoinHint}
          onBack={() => {
            if (pendingPairInvite) {
              clearOnboardingDraft();
              setPendingPairInvite(null);
              setPairPrefill(null);
            }
            setPairMode("child");
            setStep(role === "child" ? "role" : "connect");
          }}
          onDone={() => setStep("perms")}
          onPaired={() => {
            syncFromSession();
            const current = deriveAuthState();
            if (current.role) setRole(current.role);
            clearOnboardingDraft();
            setPendingPairInvite(null);
            setPairPrefill(null);
          }}
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

function Field({
  label,
  children,
  validationMessage,
  errorId,
}: {
  label: string;
  children: ReactNode;
  validationMessage?: string | null;
  errorId?: string;
}) {
  // 오류가 새로 생긴 프레임에만 흔들림을 준다 — 재렌더 때마다 반복하지 않는다.
  const [shakeKey, setShakeKey] = useState(0);
  const hadErrorRef = useRef(false);
  useEffect(() => {
    if (validationMessage && !hadErrorRef.current) setShakeKey((key) => key + 1);
    hadErrorRef.current = Boolean(validationMessage);
  }, [validationMessage]);
  return (
    <div className="ob-field" data-error={validationMessage ? "true" : undefined}>
      <div className="ob-label">{label}</div>
      <div className="ob-field__control" data-shake={shakeKey}>
        {children}
      </div>
      {validationMessage && (
        <p id={errorId} className="ob-field-error" role="alert">
          {validationMessage}
        </p>
      )}
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
  legacyInvite,
  sessionEndedOnAnotherDevice,
  onParent,
  onChild,
  onTeacher,
}: {
  busy: boolean;
  childStarting: boolean;
  legacyInvite: boolean;
  sessionEndedOnAnotherDevice: boolean;
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

      <SessionEndNotice visible={sessionEndedOnAnotherDevice} />

      {legacyInvite && (
        <div className="ob-invite-context" role="status">
          <Link2 size={18} strokeWidth={2.3} aria-hidden="true" />
          <span>{intl.formatMessage({ id: "onboarding.invite.legacyChoice" })}</span>
        </div>
      )}

      <div className="ob-role-list">
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
          <ChevronRight size={22} strokeWidth={2.4} />
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
            <span className="ob-role-name">{intl.formatMessage({ id: "onboarding.role.child.title" })}</span>
            <span className="ob-role-desc">
              {intl.formatMessage({ id: childStarting ? "onboarding.role.child.starting" : "onboarding.role.child.description" })}
            </span>
          </span>
          <ChevronRight size={22} strokeWidth={2.4} />
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
              <span className="ob-role-name">{intl.formatMessage({ id: "onboarding.role.teacher.title" })}</span>
              <span className="ob-role-desc">{intl.formatMessage({ id: "onboarding.role.teacher.description" })}</span>
            </span>
            <ChevronRight size={22} strokeWidth={2.4} />
          </button>
        )}
      </div>

      <div className="ob-role-language">
        <LanguageSelector tone="formal" collapseOthers />
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
      <div className="ob-teacher-head ob-step-head">
        <div className="ob-step-visual ob-teacher-logo">
          <img src={asset("cat/study.webp")} alt="" />
        </div>
        <div className="ob-step-copy">
          <div className="ob-h1">{intl.formatMessage({ id: "onboarding.teacher.title" })}</div>
          <div className="ob-teacher-sub">
            <FormattedMessage id="onboarding.teacher.subtitle" values={{ br: () => <br /> }} />
          </div>
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
  accessCountry,
  intent,
  parentInvite,
  sessionEndedOnAnotherDevice,
  onIntentChange,
  authError,
  onAuthError,
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
  accessCountry: string;
  intent: AuthIntent;
  parentInvite: boolean;
  sessionEndedOnAnotherDevice: boolean;
  onIntentChange: (intent: AuthIntent) => void;
  authError: string | null;
  onAuthError: (message: string | null) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
  commitBoundaryActive: boolean;
  onOAuthExternalOpen: () => void;
  onOAuthExternalEnd: () => void;
  onBack: () => void;
  onLoggedIn: (transitionToken: OnboardingAuthTransitionToken) => Promise<void>;
  onSignup: (method: SignupMethod) => void;
  show: Show;
}) {
  const intl = useIntl();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginFormErrors>({});
  const [pendingAction, setPendingAction] = useState<"id" | OAuthProvider | null>(null);
  const loginIdInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const autofillAttemptedRef = useRef(false);
  const loginActionGateRef = useRef(createLoginActionGate());
  const autofillFrameRef = useRef<number | null>(null);
  const loginNavigationLocked = isLoginNavigationLocked({ busy, commitBoundaryActive });
  const signingUp = intent === "signup";
  const socialProviders = socialProvidersForAccessCountry(accessCountry, {
    naverAvailable: hasNaverClientId,
  });

  const clearFieldError = (field: keyof LoginFormErrors) => {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  // 소셜 버튼은 intent 를 따른다 — 로그인 탭이면 바로 OAuth, 회원가입 탭이면
  // 설문(20%)을 거친 뒤 같은 provider 로 가입 흐름을 이어간다. 설문 답은
  // surveyChoices 가 유지되므로 휴대폰 가입과 같은 귀속 경로를 쓴다.
  const social = async (provider: OAuthProvider) => {
    if (loginNavigationLocked) return;
    onAuthError(null);
    if (signingUp) {
      onSignup({ kind: "oauth", provider });
      return;
    }
    if (!loginActionGateRef.current.tryBegin()) return;
    setPendingAction(provider);
    setBusy(true);
    const transitionToken = beginOnboardingAuthTransition();
    try {
      await startWorkerOAuth(provider, "login", { onExternalOpen: onOAuthExternalOpen });
    } catch (e) {
      loginActionGateRef.current.end();
      if (!isOnboardingAuthTransitionActive(transitionToken)) return;
      onOAuthExternalEnd();
      const message = localizeApiError(e, intl, "formal");
      onAuthError(message);
      show(message, "⚠️");
      // 키 미설정 등 설정 오류 — busy 를 풀고 정직하게 안내(버튼이 영구 잠기지 않게).
      setPendingAction(null);
      setBusy(false);
      endOnboardingAuthTransition(transitionToken);
    }
  };

  const loginIdPw = async (credentials: LoginFormInput = { loginId, password }) => {
    if (busy || !loginActionGateRef.current.tryBegin()) return;
    onAuthError(null);
    const validationErrors = validateLoginForm(credentials);
    setErrors(validationErrors);
    if (validationErrors.loginId) {
      loginActionGateRef.current.end();
      loginIdInputRef.current?.focus();
      return;
    }
    if (validationErrors.password) {
      loginActionGateRef.current.end();
      passwordInputRef.current?.focus();
      return;
    }
    setPendingAction("id");
    setBusy(true);
    const transitionToken = beginOnboardingAuthTransition();
    try {
      const result = await signInWithLoginId(
        credentials,
        { sessionAdoption: "deferred" },
      );
      const commitResult = commitOnboardingAuthResult(transitionToken, result, adoptAuthResult);
      if (commitResult === "stale") return;
      await onLoggedIn(transitionToken);
    } catch (e) {
      if (!isOnboardingAuthTransitionActive(transitionToken)) return;
      const message = localizeApiError(e, intl, "formal");
      onAuthError(message);
      show(message, "⚠️");
      if (isApiError(e) && e.code === "invalid_credentials") {
        passwordInputRef.current?.focus();
      }
    } finally {
      loginActionGateRef.current.end();
      if (isOnboardingAuthTransitionActive(transitionToken)) {
        setPendingAction(null);
        setBusy(false);
        endOnboardingAuthTransition(transitionToken);
      }
    }
  };

  const scheduleAutofillLogin = (animationName: string) => {
    if (animationName !== LOGIN_AUTOFILL_ANIMATION_NAME) return;
    if (autofillFrameRef.current !== null) cancelAnimationFrame(autofillFrameRef.current);
    autofillFrameRef.current = requestAnimationFrame(() => {
      autofillFrameRef.current = null;
      const loginIdInput = loginIdInputRef.current;
      const passwordInput = passwordInputRef.current;
      if (!loginIdInput || !passwordInput) return;
      if (loginActionGateRef.current.active()) return;

      const candidate = resolveLoginAutofillSubmission({
        loginId: loginIdInput.value,
        password: passwordInput.value,
        loginIdAutofilled: isAutofilledLoginInput(loginIdInput),
        passwordAutofilled: isAutofilledLoginInput(passwordInput),
        busy: busy || loginActionGateRef.current.active(),
        autofillAttempted: autofillAttemptedRef.current,
      });
      if (!candidate) return;

      autofillAttemptedRef.current = true;
      setLoginId(candidate.loginId);
      setPassword(candidate.password);
      void loginIdPw(candidate);
    });
  };

  useEffect(() => {
    if (!busy) loginActionGateRef.current.end();
    return () => {
      if (autofillFrameRef.current !== null) cancelAnimationFrame(autofillFrameRef.current);
    };
  }, [busy]);

  return (
    <div className="ob-step ob-login">
      <BackButton onBack={onBack} disabled={loginNavigationLocked} />
      <SessionEndNotice visible={sessionEndedOnAnotherDevice} />
      {parentInvite && (
        <div className="ob-invite-context" role="status">
          <Link2 size={18} strokeWidth={2.3} aria-hidden="true" />
          <span>
            <strong>{intl.formatMessage({ id: "onboarding.invite.parent.title" })}</strong>
            {intl.formatMessage({ id: "onboarding.invite.parent.authDescription" })}
          </span>
        </div>
      )}
      <div className="ob-login-head ob-step-head">
        <div className="ob-step-visual">
          <img className="ob-login-mascot" src={asset("mascot/wave.webp")} alt="" loading="eager" decoding="async" />
        </div>
        <div className="ob-step-copy">
          <div className="ob-h1">
            {intl.formatMessage({ id: signingUp ? "onboarding.signup.title" : "onboarding.login.title" })}
          </div>
          <div className="ob-sub">
            {intl.formatMessage({ id: signingUp ? "onboarding.signup.subtitle" : "onboarding.login.subtitle" })}
          </div>
        </div>
      </div>

      <div className="ob-auth-intent" role="tablist" aria-label={intl.formatMessage({ id: "onboarding.auth.intentLabel" })}>
        <button
          type="button"
          role="tab"
          aria-selected={!signingUp}
          className={!signingUp ? "ob-auth-intent__tab ob-auth-intent__tab--active" : "ob-auth-intent__tab"}
          onClick={() => onIntentChange("login")}
          disabled={loginNavigationLocked}
        >
          {intl.formatMessage({ id: "onboarding.login.submit" })}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={signingUp}
          className={signingUp ? "ob-auth-intent__tab ob-auth-intent__tab--active" : "ob-auth-intent__tab"}
          onClick={() => onIntentChange("signup")}
          disabled={loginNavigationLocked}
        >
          {intl.formatMessage({ id: "onboarding.login.signup" })}
        </button>
      </div>

      <div className="ob-login-social">
        {socialProviders.includes("kakao") && (
          <button type="button" className="ob-social ob-social--kakao hy-press hy-busy-quiet" onClick={() => social("kakao")} disabled={loginNavigationLocked} aria-busy={busy && pendingAction === "kakao"}>
            <KakaoIcon />
            <BusyLabel busy={busy && pendingAction === "kakao"} idle={intl.formatMessage({ id: signingUp ? "onboarding.signup.kakao" : "onboarding.login.kakao" })} pending={intl.formatMessage({ id: "onboarding.login.kakaoPending" })} />
          </button>
        )}
        {socialProviders.includes("google") && (
          <button type="button" className="ob-social ob-social--google hy-press hy-busy-quiet" onClick={() => social("google")} disabled={loginNavigationLocked} aria-busy={busy && pendingAction === "google"}>
            <GoogleIcon />
            <BusyLabel busy={busy && pendingAction === "google"} idle={intl.formatMessage({ id: signingUp ? "onboarding.signup.google" : "onboarding.login.google" })} pending={intl.formatMessage({ id: "onboarding.login.googlePending" })} />
          </button>
        )}
        {/* 한국 접속이면서 키가 있을 때만 네이버를 보여준다 — 키가 없어도 실패하는 버튼은 숨긴다. */}
        {socialProviders.includes("naver") && (
          <button type="button" className="ob-social ob-social--naver hy-press hy-busy-quiet" onClick={() => social("naver")} disabled={loginNavigationLocked} aria-busy={busy && pendingAction === "naver"}>
            <NaverIcon />
            <BusyLabel busy={busy && pendingAction === "naver"} idle={intl.formatMessage({ id: signingUp ? "onboarding.signup.naver" : "onboarding.login.naver" })} pending={intl.formatMessage({ id: "onboarding.login.naverPending" })} />
          </button>
        )}
      </div>

      {authError && (
        <div className="ob-auth-alert" role="alert">
          {authError}
        </div>
      )}

      <div className="ob-divider">
        <span />
        <em>{intl.formatMessage({ id: signingUp ? "onboarding.signup.orPhone" : "onboarding.login.orId" })}</em>
        <span />
      </div>

      {signingUp ? (
        <>
          <button
            type="button"
            className="ob-phone-signup hy-press hy-busy-quiet"
            onClick={() => onSignup({ kind: "phone" })}
            disabled={loginNavigationLocked}
            data-progress-owner="login-action"
          >
            {intl.formatMessage({ id: "onboarding.signup.withPhone" })}
          </button>
          <div className="ob-login-foot">
            {intl.formatMessage({ id: "onboarding.login.haveAccount" })}{" "}
            <button type="button" className="ob-link" onClick={() => onIntentChange("login")} disabled={loginNavigationLocked}>
              {intl.formatMessage({ id: "onboarding.login.submit" })}
            </button>
          </div>
        </>
      ) : (
        <>
          <form
            className="ob-login-form"
            autoComplete="on"
            onSubmit={(event) => {
              event.preventDefault();
              void loginIdPw();
            }}
          >
            <div className="ob-login-field">
              <input
                ref={loginIdInputRef}
                id="hyeni-login-username"
                name="username"
                className="ob-input"
                type="text"
                inputMode="text"
                placeholder={intl.formatMessage({ id: "onboarding.field.loginId" })}
                aria-label={intl.formatMessage({ id: "onboarding.field.loginId" })}
                aria-invalid={Boolean(errors.loginId)}
                aria-describedby={errors.loginId ? "ob-login-id-error" : undefined}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                value={loginId}
                onAnimationStart={(event) => scheduleAutofillLogin(event.animationName)}
                onChange={(e) => {
                  setLoginId(e.target.value);
                  clearFieldError("loginId");
                  onAuthError(null);
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
                id="hyeni-login-password"
                name="password"
                className="ob-input"
                type="password"
                placeholder={intl.formatMessage({ id: "onboarding.field.password" })}
                aria-label={intl.formatMessage({ id: "onboarding.field.password" })}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "ob-login-password-error" : undefined}
                autoComplete="current-password"
                enterKeyHint="go"
                value={password}
                onAnimationStart={(event) => scheduleAutofillLogin(event.animationName)}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearFieldError("password");
                  onAuthError(null);
                }}
              />
              {errors.password && (
                <p id="ob-login-password-error" className="ob-field-error" role="alert">
                  {intl.formatMessage({ id: "onboarding.validation.passwordRequired" })}
                </p>
              )}
            </div>
            <button type="submit" className="ob-loginbtn hy-press hy-busy-quiet" disabled={busy} aria-busy={busy && pendingAction === "id"}>
              <BusyLabel busy={busy && pendingAction === "id"} idle={intl.formatMessage({ id: "onboarding.login.submit" })} pending={intl.formatMessage({ id: "onboarding.login.pending" })} />
            </button>
            <p className="ob-login-device-note">
              {intl.formatMessage({ id: "onboarding.login.deviceTransferNote" })}
            </p>
          </form>

          <div className="ob-login-foot">
            {intl.formatMessage({ id: "onboarding.login.noAccount" })}{" "}
            <button
              type="button"
              className="ob-link"
              onClick={() => onIntentChange("signup")}
              disabled={loginNavigationLocked}
              data-progress-owner="login-action"
            >
              {intl.formatMessage({ id: "onboarding.login.signup" })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SessionEndNotice({ visible }: { visible: boolean }) {
  const intl = useIntl();
  if (!visible) return null;
  return (
    <div className="ob-session-end" role="alert">
      <LogOut size={18} strokeWidth={2.3} aria-hidden="true" />
      <span>{intl.formatMessage({ id: "onboarding.session.deviceInactive" })}</span>
    </div>
  );
}

/* ── STEP: SIGNUP (전화+OTP 인증 포함) ──────────────────────────────────── */

function SurveyStep({
  selected,
  busy,
  socialProvider,
  onBack,
  onToggle,
  onNext,
}: {
  selected: OnboardingInterest[];
  busy: boolean;
  socialProvider: OAuthProvider | null;
  onBack: () => void;
  onToggle: (id: OnboardingInterest) => void;
  onNext: () => void;
}) {
  const intl = useIntl();
  return (
    <div className="ob-step ob-survey">
      <BackButton onBack={onBack} disabled={busy} />
      <SignupProgress percent={20} label={intl.formatMessage({ id: "onboarding.progress.survey" })} />
      <div className="ob-survey-head ob-step-head">
        <div className="ob-step-visual">
          <img src={asset("ui/calendar-heart.webp")} alt="" loading="eager" decoding="async" />
        </div>
        <div className="ob-step-copy">
          <div className="ob-signup-title">{intl.formatMessage({ id: "onboarding.survey.title" })}</div>
          <div className="ob-sub">
            <FormattedMessage id="onboarding.survey.subtitle" values={{ br: () => <br /> }} />
          </div>
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
              disabled={busy}
              aria-busy={busy}
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

      <button
        type="button"
        className="ob-cta ob-cta--accent hy-press hy-busy-quiet"
        onClick={onNext}
        disabled={busy}
        aria-busy={busy && socialProvider !== null}
      >
        <BusyLabel
          busy={busy && socialProvider !== null}
          idle={selected.length > 0
            ? intl.formatMessage({ id: "onboarding.action.next" })
            : intl.formatMessage({ id: "onboarding.action.continueWithoutSelecting" })}
          pending={intl.formatMessage({ id: "onboarding.signup.socialPending" })}
        />
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
  surveyChoices,
  onReferralDraftChange,
  onBack,
  onExistingAccountLogin,
  onUseSocialSignup,
  onDone,
  show,
}: {
  busy: boolean;
  setBusy: (v: boolean) => void;
  referralDraft: string;
  surveyChoices: OnboardingInterest[];
  onReferralDraftChange: (value: string) => void;
  onBack: () => void;
  onExistingAccountLogin: () => void;
  onUseSocialSignup: () => void;
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
  const [formErrors, setFormErrors] = useState<ParentSignupErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpNeedsResend, setOtpNeedsResend] = useState(false);
  const [existingAccountDetected, setExistingAccountDetected] = useState(false);
  const [loginIdAvailability, setLoginIdAvailability] = useState<"idle" | "checking" | "available" | "taken" | "error">("idle");
  const [checkedLoginId, setCheckedLoginId] = useState<string | null>(null);
  const loginIdCheckGenerationRef = useRef(0);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const loginIdInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const passwordConfirmInputRef = useRef<HTMLInputElement>(null);
  const guardianFirstButtonRef = useRef<HTMLButtonElement>(null);
  const birthdateInputRef = useRef<HTMLInputElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);
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

  const fieldErrorMessage = (field: keyof ParentSignupErrors): string => {
    const value = formErrors[field];
    if (!value) return "";
    if (value === "login_id_taken") {
      return intl.formatMessage({ id: "core.error.api.loginIdTaken.formal" });
    }
    if (value === "phone_exists") {
      return intl.formatMessage({ id: "core.error.api.phoneExists.formal" });
    }
    switch (field) {
      case "name": return intl.formatMessage({ id: "onboarding.validation.nameRequired" });
      case "loginId": return intl.formatMessage({ id: "onboarding.validation.loginIdInvalid" });
      case "password": return intl.formatMessage({ id: "onboarding.validation.passwordWeak" });
      case "passwordConfirm": return intl.formatMessage({ id: "onboarding.validation.passwordMismatch" });
      case "gender": return intl.formatMessage({ id: "onboarding.validation.guardianRequired" });
      case "birthdate": return intl.formatMessage({ id: "onboarding.validation.birthdateInvalid" });
      case "phone": return intl.formatMessage({ id: "onboarding.validation.phoneInvalid" });
    }
    return intl.formatMessage({ id: "core.error.api.client.formal" });
  };

  const clearFormFieldError = (field: keyof ParentSignupErrors) => {
    setFormErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError(null);
  };

  const focusFirstFormError = (errors: ParentSignupErrors) => {
    const target = errors.name
      ? nameInputRef
      : errors.loginId
        ? loginIdInputRef
        : errors.password
          ? passwordInputRef
          : errors.passwordConfirm
            ? passwordConfirmInputRef
            : errors.gender
              ? guardianFirstButtonRef
              : errors.birthdate
                ? birthdateInputRef
                : errors.phone
                  ? phoneInputRef
                  : null;
    target?.current?.focus();
  };

  const checkLoginId = async () => {
    if (busy || loginIdAvailability === "checking") return;
    const normalized = normalizeLoginId(loginId);
    if (!isValidLoginId(normalized)) {
      const nextErrors = { ...formErrors, loginId: "invalid_login_id" };
      setFormErrors(nextErrors);
      setLoginIdAvailability("idle");
      setCheckedLoginId(null);
      loginIdInputRef.current?.focus();
      return;
    }
    setLoginId(normalized);
    clearFormFieldError("loginId");
    setLoginIdAvailability("checking");
    const generation = ++loginIdCheckGenerationRef.current;
    try {
      const available = await checkLoginIdAvailability(normalized);
      if (loginIdCheckGenerationRef.current !== generation) return;
      setCheckedLoginId(normalized);
      setLoginIdAvailability(available ? "available" : "taken");
      if (!available) {
        setFormErrors((current) => ({ ...current, loginId: "login_id_taken" }));
        loginIdInputRef.current?.focus();
      }
    } catch (error) {
      if (loginIdCheckGenerationRef.current !== generation) return;
      const message = localizeApiError(error, intl, "formal");
      setLoginIdAvailability("error");
      setCheckedLoginId(null);
      setFormError(message);
      show(message, "⚠️");
    }
  };

  const handleRequestCodeError = (error: unknown) => {
    const message = localizeApiError(error, intl, "formal");
    if (isApiError(error) && error.code === "login_id_taken") {
      setFormErrors((current) => ({ ...current, loginId: "login_id_taken" }));
      setLoginIdAvailability("taken");
      setCheckedLoginId(normalizeLoginId(loginId));
      loginIdInputRef.current?.focus();
    } else if (isApiError(error) && error.code === "phone_exists") {
      setFormErrors((current) => ({ ...current, phone: "phone_exists" }));
      setExistingAccountDetected(true);
      phoneInputRef.current?.focus();
    }
    if (phase === "otp") setOtpError(message);
    else setFormError(message);
    show(message, "⚠️");
  };

  const requestCode = async () => {
    if (busy) return;
    const validation = validateParentSignupForm({ name, loginId, password, passwordConfirm, gender, birthdate, phone });
    setFormErrors(validation.errors);
    setFormError(null);
    setExistingAccountDetected(false);
    if (!validation.ok || !validation.values) {
      focusFirstFormError(validation.errors);
      return;
    }
    setLoginId(validation.values.loginId);
    const requestToken = beginSignupAction("request-code");
    await runOwnedAsyncAction({
      controller: signupActionControllerRef.current,
      token: requestToken,
      request: () => requestPhoneSignupCode({ name, loginId, password, passwordConfirm, gender, birthdate, phone }),
      onSuccess: (result) => {
        setPending(result);
        setLoginId(result.profile.login_id);
        setCheckedLoginId(result.profile.login_id);
        setLoginIdAvailability("available");
        setFormErrors({});
        setFormError(null);
        setOtp("");
        setOtpError(null);
        setOtpNeedsResend(false);
        setPhase("otp");
        show(intl.formatMessage({ id: "onboarding.toast.otpSent" }), "📩");
      },
      onError: handleRequestCodeError,
      onFinally: () => finishSignupAction(requestToken),
    });
  };

  const verify = async () => {
    if (busy || !pending) return;
    if (!/^\d{6}$/.test(otp)) {
      setOtpError(intl.formatMessage({ id: "onboarding.validation.otpInvalid" }));
      otpInputRef.current?.focus();
      return;
    }
    setOtpError(null);
    const requestToken = beginSignupAction("verify");
    await runOwnedAsyncAction({
      controller: signupActionControllerRef.current,
      token: requestToken,
      request: () => verifyPhoneSignupCode(
        {
          phone: pending.phone,
          token: otp,
          profile: pending.profile,
          password: pending.password,
          onboardingInterests: surveyChoices,
        },
        { sessionAdoption: "deferred" },
      ),
      onSuccess: (result) => {
        adoptAuthResult(result);
        show(intl.formatMessage({ id: "onboarding.toast.signupComplete" }), "🎉");
        onDone(name);
      },
      onError: (error) => {
        const code = isApiError(error) ? error.code : null;
        const mustResend = code === "otp_expired" || code === "otp_not_found" || code === "too_many_attempts";
        const message = code === "too_many_attempts"
          ? intl.formatMessage({ id: "onboarding.validation.otpResendRequired" })
          : localizeApiError(error, intl, "formal");
        setOtpError(message);
        setOtpNeedsResend(mustResend);
        if (code === "phone_exists") {
          setFormErrors((current) => ({ ...current, phone: "phone_exists" }));
          setExistingAccountDetected(true);
          setPhase("form");
          queueMicrotask(() => phoneInputRef.current?.focus());
        } else if (code === "login_id_taken") {
          setFormErrors((current) => ({ ...current, loginId: "login_id_taken" }));
          setLoginIdAvailability("taken");
          setPhase("form");
          queueMicrotask(() => loginIdInputRef.current?.focus());
        } else if (!mustResend) {
          otpInputRef.current?.focus();
        }
        show(message, "⚠️");
      },
      onFinally: () => finishSignupAction(requestToken),
    });
  };

  if (phase === "otp") {
    return (
      <div className="ob-step ob-signup">
        <BackButton onBack={() => setPhase("form")} disabled={busy} />
        <SignupProgress percent={60} label={intl.formatMessage({ id: "onboarding.progress.phone" })} />
        <div className="ob-signup-head ob-step-head">
          <div className="ob-step-visual">
            <img src={asset("ui/phone-lavender.webp")} alt="" loading="eager" decoding="async" />
          </div>
          <div className="ob-step-copy">
            <div className="ob-signup-title">{intl.formatMessage({ id: "onboarding.signup.otpTitle" })}</div>
            <div className="ob-sub">{intl.formatMessage({ id: "onboarding.signup.otpDescription" }, { phone: pending?.phoneStorage ?? "" })}</div>
          </div>
        </div>
        <form
          className="ob-signup-form"
          onSubmit={(event) => {
            event.preventDefault();
            void verify();
          }}
        >
          <Field
            label={intl.formatMessage({ id: "onboarding.field.otp" })}
            validationMessage={otpError}
            errorId="ob-signup-otp-error"
          >
            <div className="ob-otp-wrap">
              <input
                ref={otpInputRef}
                id="hyeni-signup-otp"
                name="one-time-code"
                className="ob-input ob-input--otp"
                aria-label={intl.formatMessage({ id: "onboarding.field.otp" })}
                aria-invalid={Boolean(otpError)}
                aria-describedby={otpError ? "ob-signup-otp-error" : undefined}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                placeholder="000000"
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setOtpError(null);
                }}
              />
              {/* 6칸 트랙 — 채워진 칸이 하나씩 맞춰진다(iOS 문자 자동입력과 무관한 시각 피드백). */}
              <span className="ob-otp-track" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <span
                    key={index}
                    className={
                      otp.length > index
                        ? "ob-otp-cell ob-otp-cell--filled"
                        : otp.length === index
                          ? "ob-otp-cell ob-otp-cell--active"
                          : "ob-otp-cell"
                    }
                  />
                ))}
              </span>
            </div>
          </Field>
          <button
            type="submit"
            className="ob-cta ob-cta--accent hy-press hy-busy-quiet"
            disabled={busy || otpNeedsResend}
            aria-busy={busy && isAsyncActionTokenFor(pendingSignupAction, "verify")}
          >
            <BusyLabel
              busy={busy && isAsyncActionTokenFor(pendingSignupAction, "verify")}
              idle={intl.formatMessage({ id: "onboarding.signup.verify" })}
              pending={intl.formatMessage({ id: "onboarding.signup.verifying" })}
            />
          </button>
        </form>
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
        <div className="ob-auth-alternative">
          <button type="button" className="ob-link" onClick={onUseSocialSignup} disabled={busy} data-progress-owner="signup-action">
            {intl.formatMessage({ id: "onboarding.signup.useSocial" })}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ob-step ob-signup">
      <BackButton onBack={onBack} disabled={busy} />
      <SignupProgress percent={40} label={intl.formatMessage({ id: "onboarding.progress.account" })} />
      <div className="ob-signup-head ob-step-head">
        <div className="ob-step-visual">
          <img src={asset("ui/phone-lavender.webp")} alt="" loading="eager" decoding="async" />
        </div>
        <div className="ob-step-copy">
          <div className="ob-signup-title">{intl.formatMessage({ id: "onboarding.signup.title" })}</div>
          <div className="ob-sub">{intl.formatMessage({ id: "onboarding.signup.subtitle" })}</div>
        </div>
      </div>

      <form
        className="ob-signup-form"
        autoComplete="on"
        onSubmit={(event) => {
          event.preventDefault();
          void requestCode();
        }}
      >
        {formError && <div className="ob-auth-alert" role="alert">{formError}</div>}
        <Field label={intl.formatMessage({ id: "onboarding.field.name" })} validationMessage={fieldErrorMessage("name")} errorId="ob-signup-name-error">
          <input ref={nameInputRef} id="hyeni-signup-name" className="ob-input" name="name" autoComplete="name" aria-label={intl.formatMessage({ id: "onboarding.field.name" })} aria-invalid={Boolean(formErrors.name)} aria-describedby={formErrors.name ? "ob-signup-name-error" : undefined} placeholder={intl.formatMessage({ id: "onboarding.field.namePlaceholder" })} value={name} onChange={(e) => { setName(e.target.value); clearFormFieldError("name"); }} />
        </Field>
        <Field label={intl.formatMessage({ id: "onboarding.field.loginId" })} validationMessage={fieldErrorMessage("loginId")} errorId="ob-signup-login-id-error">
          <div className="ob-inline-control">
            <input ref={loginIdInputRef} id="hyeni-signup-username" className="ob-input" name="username" autoComplete="username" aria-label={intl.formatMessage({ id: "onboarding.field.loginId" })} aria-invalid={Boolean(formErrors.loginId)} aria-describedby={formErrors.loginId ? "ob-signup-login-id-error" : loginIdAvailability === "available" ? "ob-signup-login-id-status" : undefined} placeholder={intl.formatMessage({ id: "onboarding.field.loginIdPlaceholder" })} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={loginId} onChange={(e) => { loginIdCheckGenerationRef.current += 1; setLoginId(e.target.value); setLoginIdAvailability("idle"); setCheckedLoginId(null); clearFormFieldError("loginId"); }} />
            <button
              type="button"
              className="ob-inline-control__button hy-press"
              onClick={() => void checkLoginId()}
              disabled={busy || loginIdAvailability === "checking"}
              aria-busy={loginIdAvailability === "checking"}
            >
              {intl.formatMessage({ id: loginIdAvailability === "checking" ? "onboarding.signup.loginIdChecking" : "onboarding.signup.loginIdCheck" })}
            </button>
          </div>
          {loginIdAvailability === "available" && checkedLoginId === normalizeLoginId(loginId) && (
            <p id="ob-signup-login-id-status" className="ob-field-success" role="status">
              {intl.formatMessage({ id: "onboarding.signup.loginIdAvailable" })}
            </p>
          )}
        </Field>
        <Field label={intl.formatMessage({ id: "onboarding.field.password" })} validationMessage={fieldErrorMessage("password")} errorId="ob-signup-password-error">
          <input ref={passwordInputRef} id="hyeni-signup-password" className="ob-input" name="new-password" type="password" autoComplete="new-password" aria-label={intl.formatMessage({ id: "onboarding.field.password" })} aria-invalid={Boolean(formErrors.password)} aria-describedby={formErrors.password ? "ob-signup-password-error" : undefined} placeholder={intl.formatMessage({ id: "onboarding.field.passwordPlaceholder" })} value={password} onChange={(e) => { setPassword(e.target.value); clearFormFieldError("password"); }} />
        </Field>
        <Field label={intl.formatMessage({ id: "onboarding.field.passwordConfirm" })} validationMessage={fieldErrorMessage("passwordConfirm")} errorId="ob-signup-password-confirm-error">
          <input ref={passwordConfirmInputRef} id="hyeni-signup-password-confirm" className="ob-input" name="new-password-confirm" type="password" autoComplete="new-password" aria-label={intl.formatMessage({ id: "onboarding.field.passwordConfirm" })} aria-invalid={Boolean(formErrors.passwordConfirm)} aria-describedby={formErrors.passwordConfirm ? "ob-signup-password-confirm-error" : undefined} placeholder={intl.formatMessage({ id: "onboarding.field.passwordConfirmPlaceholder" })} value={passwordConfirm} onChange={(e) => { setPasswordConfirm(e.target.value); clearFormFieldError("passwordConfirm"); }} />
        </Field>
        <Field label={intl.formatMessage({ id: "onboarding.field.guardianType" })} validationMessage={fieldErrorMessage("gender")} errorId="ob-signup-gender-error">
          <div className="ob-guardian-options" role="group" aria-describedby={formErrors.gender ? "ob-signup-gender-error" : undefined}>
            {GENDERS.map((g, index) => (
              <button
                ref={index === 0 ? guardianFirstButtonRef : undefined}
                key={g.value}
                type="button"
                className={gender === g.value ? "ob-guardian-option ob-guardian-option--active hy-press" : "ob-guardian-option hy-press"}
                aria-pressed={gender === g.value}
                onClick={() => { setGender(g.value); clearFormFieldError("gender"); }}
              >
                {intl.formatMessage({ id: g.labelId })}
              </button>
            ))}
          </div>
        </Field>
        <Field label={intl.formatMessage({ id: "onboarding.field.birthdate" })} validationMessage={fieldErrorMessage("birthdate")} errorId="ob-signup-birthdate-error">
          <input ref={birthdateInputRef} id="hyeni-signup-birthdate" name="bday" className="ob-input" type="date" autoComplete="bday" aria-label={intl.formatMessage({ id: "onboarding.field.birthdate" })} aria-invalid={Boolean(formErrors.birthdate)} aria-describedby={formErrors.birthdate ? "ob-signup-birthdate-error" : undefined} value={birthdate} onChange={(e) => { setBirthdate(e.target.value); clearFormFieldError("birthdate"); }} />
        </Field>
        <Field label={intl.formatMessage({ id: "onboarding.field.phone" })} validationMessage={fieldErrorMessage("phone")} errorId="ob-signup-phone-error">
          <input ref={phoneInputRef} id="hyeni-signup-phone" name="tel" className="ob-input" type="tel" inputMode="tel" autoComplete="tel-national" aria-label={intl.formatMessage({ id: "onboarding.field.phone" })} aria-invalid={Boolean(formErrors.phone)} aria-describedby={formErrors.phone ? "ob-signup-phone-error" : undefined} placeholder={intl.formatMessage({ id: "onboarding.field.phonePlaceholder" })} value={phone} onChange={(e) => { setPhone(e.target.value); setExistingAccountDetected(false); clearFormFieldError("phone"); }} />
        </Field>
        <ReferralCodeField
          value={referralDraft}
          onChange={onReferralDraftChange}
          disabled={busy}
        />
        <button
          type="submit"
          className="ob-cta ob-cta--accent hy-press hy-busy-quiet"
          disabled={busy || loginIdAvailability === "checking"}
          aria-busy={busy && isAsyncActionTokenFor(pendingSignupAction, "request-code")}
        >
          <BusyLabel
            busy={busy && isAsyncActionTokenFor(pendingSignupAction, "request-code")}
            idle={intl.formatMessage({ id: "onboarding.signup.requestOtp" })}
            pending={intl.formatMessage({ id: "onboarding.signup.requestingOtp" })}
          />
        </button>
      </form>

      <div className="ob-auth-alternative">
        {existingAccountDetected && (
          <button type="button" className="ob-link" onClick={onExistingAccountLogin} disabled={busy} data-progress-owner="signup-action">
            {intl.formatMessage({ id: "onboarding.signup.existingAccount" })}
          </button>
        )}
        <button type="button" className="ob-link" onClick={onUseSocialSignup} disabled={busy} data-progress-owner="signup-action">
          {intl.formatMessage({ id: "onboarding.signup.useSocial" })}
        </button>
      </div>
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
}: {
  busy: boolean;
  progressPercent?: number | null;
  referralCode?: string | null;
  referralDraft: string;
  onReferralDraftChange: (value: string) => void;
  onBack: () => void;
  onNewFamily: () => void | Promise<void>;
  onJoin: () => void | Promise<void>;
}) {
  const intl = useIntl();
  const [pendingAction, setPendingAction] = useState<"new-family" | "join" | null>(null);
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
      <div className="ob-connect-head ob-step-head">
        <div className="ob-step-visual">
          <img className="ob-connect-mascot" src={asset("mascot/family.webp")} alt="" loading="eager" decoding="async" />
        </div>
        <div className="ob-step-copy">
          <div className="ob-h1">{intl.formatMessage({ id: "onboarding.connect.title" })}</div>
          <div className="ob-sub">{intl.formatMessage({ id: "onboarding.connect.subtitle" })}</div>
        </div>
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
  const [pairingError, setPairingError] = useState<string | null>(null);

  // rawCode: 스캔 rawValue 또는 입력값. 딥링크 URL(#/onboarding?pair=KID-…)도
  // normalizePairCodeInput 의 KID- 직접매치로 코드가 추출된다.
  const submit = async (rawCode?: string) => {
    if (busy) return;
    const code = normalizePairCodeInput(rawCode ?? raw);
    if (!code) {
      const message = intl.formatMessage({
        id: rawCode != null ? "onboarding.pairing.invalidQr" : "onboarding.pairing.invalidCode",
      });
      setPairingError(message);
      show(message, "🔢");
      return;
    }
    setPairingError(null);
    setRaw(code);
    setBusy(true);
    let permissionTransitionStarted = false;
    try {
      // 화면에 명시된 초대 역할을 그대로 전송한다. 세션 역할이 다르면 Worker가
      // stable role error로 거부해 다른 가족 역할로 조용히 등록되는 일을 막는다.
      let joinedFamilyId: string | null;
      if (mode === "child") {
        const nextHint = await readChildDeviceIdentityHint();
        onPermissionTransitionStart();
        permissionTransitionStarted = true;
        joinedFamilyId = await joinFamily(code, childJoinHint ?? nextHint);
      } else {
        onPermissionTransitionStart();
        permissionTransitionStarted = true;
        joinedFamilyId = await joinFamilyAsParent(code);
      }
      const confirmedFamily = await getMyFamily();
      const confirmedSession = deriveAuthState();
      if (!isPairingMembershipConfirmed({
        mode,
        expectedFamilyId: joinedFamilyId,
        session: confirmedSession,
        family: confirmedFamily,
      })) {
        throw new ApiError("pairing_confirmation_failed", 409);
      }
      onPaired();
      show(intl.formatMessage({ id: "onboarding.toast.familyConnected" }), "🔗");
      onDone();
    } catch (e) {
      if (permissionTransitionStarted) onPermissionTransitionCancel();
      const message = localizeApiError(e, intl, mode === "child" ? "child" : "formal");
      setPairingError(message);
      show(message, "⚠️");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ob-step ob-pairing">
      <BackButton onBack={onBack} disabled={busy} />
      <div className="ob-pair-head ob-step-head">
        <div className="ob-step-visual">
          <img src={asset("ui/camera-3d.webp")} alt="" loading="eager" decoding="async" />
        </div>
        <div className="ob-step-copy">
          <div className="ob-pair-title">
            {intl.formatMessage({
              id: mode === "parent" ? "onboarding.pairing.parent.title" : "onboarding.pairing.title",
            })}
          </div>
          <div className="ob-pair-sub">
            {intl.formatMessage({
              id: mode === "parent" ? "onboarding.pairing.parent.description" : "onboarding.pairing.description",
            })}
          </div>
        </div>
      </div>
      <div className="ob-pair-recovery">
        {intl.formatMessage({
          id: mode === "parent" ? "onboarding.pairing.parent.recovery" : "onboarding.pairing.recovery",
        })}
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
        className="ob-input ob-pair-code-input"
        aria-label={intl.formatMessage({ id: "onboarding.pairing.codeLabel" })}
        placeholder="KID-XXXXXXXX"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setPairingError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />

      {pairingError && <div className="ob-auth-alert" role="alert">{pairingError}</div>}

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
        <Suspense fallback={<div className="qrs-root" role="status" />}>
          <QrScanner
            onClose={() => setShowScanner(false)}
            onDetected={async (rawValue) => {
              setShowScanner(false);
              await submit(rawValue);
            }}
          />
        </Suspense>
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
  const { userId: permsUserId, familyId: permsFamilyId } = useAuth();
  const permissionItems = role === "child" ? CHILD_PERM_ITEMS : GUARDIAN_PERM_ITEMS;
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  // 이 단계에서 사용 정보 접근을 물었다는 기록 — 아이 홈이 곧바로 또 묻지 않게 한다.
  const usageAccessPromptKey = usageAccessPromptStorageKey(permsFamilyId, permsUserId);

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
      <div className="ob-perms-head ob-step-head">
        <div className="ob-step-visual">
          <img className="ob-perms-mascot" src={asset("ui/shield-heart.webp")} alt="" loading="eager" decoding="async" />
        </div>
        <div className="ob-step-copy">
          <div className="ob-h1">{intl.formatMessage({ id: role === "child" ? "onboarding.permissions.title.child" : "onboarding.permissions.title.formal" })}</div>
          <div className="ob-sub">{intl.formatMessage({ id: role === "child" ? "onboarding.permissions.subtitle.child" : "onboarding.permissions.subtitle.formal" })}</div>
        </div>
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
        usagePromptStorageKey={usageAccessPromptKey}
        onDismiss={finishLocationSetup}
        onPermissionGranted={finishLocationSetup}
      />
    </div>
  );
}
