import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, ChevronLeft, FileClock, Mic, Phone, Smartphone, Timer, VolumeX } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { useMyFamily } from "@/queries/useFamily";
import { useChildLocations, useSavedPlaces } from "@/queries/useLocation";
import { useLocationLabels } from "@/queries/useLocationLabels";
import { placePhoneCall } from "@/lib/native/phone";
import {
  isRemoteListenNativeSupported,
  isRemoteListenAllowed,
  openRemoteListenSession,
  closeRemoteListenSession,
  type RemoteListenSession,
} from "@/lib/native/ambient";
import { useRequestRemoteListen, useStopRemoteListen } from "@/queries/useRemote";
import { useRemoteListenSessionStatus } from "@/queries/useRemoteAudit";
import { openFamilySocket, type FamilySocket } from "@/realtime/familySocket";
import { getApiAccessToken } from "@/lib/api/session";
import { RemoteAudioPlayer } from "@/lib/remoteAudioPlayer";
import { resolveRemoteListenSessionTiming } from "@/transform/remoteListenSessionTiming";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "./RemoteAudio.css";

/** 듣기 제한 시간(초) · 위급 시 1분 청취. */
const LISTEN_SECONDS = 60;
/** hyeni-1 과 동일: 아이가 잠금/접힘 상태이면 알림 확인까지 시간이 걸릴 수 있어 대기 안내만 전환한다. */
const REMOTE_AUDIO_WAITING_HELP_MS = 25_000;
/** 이 시간 동안 새 WAV가 없으면 LIVE를 해제하고 서버 세션 상태를 다시 확인한다. */
const REMOTE_AUDIO_STREAM_STALE_MS = 4_000;

/** 웨이브 이퀄라이저 막대(20개)의 애니메이션 위상차. */
const WAVE_DELAYS = [
  "-0.90s", "-0.20s", "-0.60s", "0s", "-0.40s",
  "-0.80s", "-0.10s", "-0.50s", "-0.30s", "-0.70s",
  "-0.15s", "-0.55s", "-0.35s", "-0.75s", "-0.05s",
  "-0.45s", "-0.65s", "-0.25s", "-0.85s", "-0.50s",
] as const;

const TRUST_CARDS = [
  {
    icon: Bell,
    title: "아이에게 알림이 가요",
    text: "위급 확인이라 아이가 누르지 않아도 연결되고, 듣는 동안 아이 화면에 계속 표시돼요.",
  },
  {
    icon: Timer,
    title: "1분 후 자동 종료돼요",
    text: "위급 상황 확인을 위한 짧은 청취만 지원해요.",
  },
  {
    icon: FileClock,
    title: "기록이 남아요",
    text: "가족의 안전과 투명성을 위해 청취 기록을 남겨요.",
  },
] as const;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 주변소리: 대기 화면 → '듣는 중' 오버레이(웨이브) 토글. */
export function RemoteAudio() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId, userId } = useAuth();
  const familyQuery = useMyFamily();
  const locationsQuery = useChildLocations();
  const placesQuery = useSavedPlaces();
  const family = familyQuery.data;
  const locations = locationsQuery.data;
  const places = placesQuery.data;
  const remoteAudioQueryState = resolveQueryTruthState([
    { isLoading: familyQuery.isLoading, isError: familyQuery.isError },
    { isLoading: locationsQuery.isLoading, isError: locationsQuery.isError },
    { isLoading: placesQuery.isLoading, isError: placesQuery.isError },
  ]);
  const remoteAudioDataMissing = remoteAudioQueryState === "ready" && (
    !family || locations === undefined || places === undefined
  );
  const remoteAudioDataReady = remoteAudioQueryState === "ready" && !remoteAudioDataMissing;
  const remoteAudioRefetching =
    familyQuery.isFetching || locationsQuery.isFetching || placesQuery.isFetching;
  const retryRemoteAudio = async (): Promise<void> => {
    await Promise.all([
      familyQuery.refetch(),
      locationsQuery.refetch(),
      placesQuery.refetch(),
    ]);
  };

  // 대상 아이 = 진입 시 지정(state.childUserId, 아이 상세에서 전달) > 전역 활성 아이.
  // 첫 아이 하드코딩 제거 — 다자녀에서 엉뚱한(기기 없는) 아이를 듣던 오연결 차단.
  const { activeChild, childMembers } = useActiveChild();
  const routeState = (useLocation().state ?? null) as { childUserId?: string } | null;
  const childMember = useMemo(() => {
    if (routeState?.childUserId) {
      const target = childMembers.find((m) => m.user_id === routeState.childUserId);
      if (target) return target;
    }
    return activeChild;
  }, [routeState, childMembers, activeChild]);
  const childName = childMember?.name || "아이";
  // 위치는 대상 아이 것만(타 아이 위치 폴백 금지 — 오노출 방지).
  const childLoc = childMember?.user_id
    ? locations?.find((l) => l.user_id === childMember.user_id) ?? null
    : null;
  const locationLabel = useLocationLabels(childLoc ? [childLoc] : [], places);
  const childPlace = childLoc ? locationLabel(childLoc) : "위치 확인 중";

  // 전화 대상: 본인 외 보호자(공동보호자) 우선, 없으면 첫 보호자. 번호 없으면 안내만.
  const callTarget =
    (family?.members ?? [])
      .filter((m) => m.role === "parent" && m.phone)
      .find((m) => m.user_id && m.user_id !== userId) ??
    (family?.members ?? []).find((m) => m.role === "parent" && m.phone) ??
    null;

  // 원격 청취는 안드로이드 네이티브 앱 전용. 웹(PWA/아이폰)에선 안내만 표시.
  const [native] = useState(isRemoteListenNativeSupported);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [waitingHint, setWaitingHint] = useState(false);
  const [starting, setStarting] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [localRequestStartedAtMs, setLocalRequestStartedAtMs] = useState<number | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [lastAudioAtMs, setLastAudioAtMs] = useState<number | null>(null);
  const startInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const endingRef = useRef(false);

  // 실제 청취 세션: 아이 기기 캡처 명령(push-notify) + audit 세션 행(remote_listen_sessions).
  const requestListen = useRequestRemoteListen();
  const stopListenCmd = useStopRemoteListen();
  const stopListenMutateAsyncRef = useRef(stopListenCmd.mutateAsync);
  stopListenMutateAsyncRef.current = stopListenCmd.mutateAsync;
  const stopThenCloseRef = useRef<(
    session: RemoteListenSession | null,
    targetChildUserId: string | null,
    requestId: string | null,
    reason: string,
  ) => Promise<void>>(async () => {});
  stopThenCloseRef.current = async (session, targetChildUserId, requestId, reason) => {
    try {
      if (requestId && targetChildUserId) {
        await stopListenMutateAsyncRef.current({ targetChildUserId, requestId });
      }
    } finally {
      await closeRemoteListenSession(session, reason);
    }
  };
  const sessionRef = useRef<RemoteListenSession | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const targetChildUserIdRef = useRef<string | null>(null);
  const childUserId = childMember?.user_id ?? null;
  const sessionStatusQuery = useRemoteListenSessionStatus(activeRequestId);
  const sessionStatus =
    sessionStatusQuery.data?.id === activeRequestId
      && (!childUserId || sessionStatusQuery.data.childUserId === childUserId)
      ? sessionStatusQuery.data
      : null;
  const estimatedServerNowMs = sessionStatus
    ? sessionStatus.serverNowMs + Math.max(0, clockMs - sessionStatus.receivedAtMs)
    : null;
  const sessionTiming = useMemo(
    () => resolveRemoteListenSessionTiming({
      clientNowMs: clockMs,
      localRequestStartedAtMs: localRequestStartedAtMs ?? clockMs,
      serverNowMs: estimatedServerNowMs,
      serverStartedAtMs: sessionStatus?.startedAtMs ?? null,
      serverCheckedAtMs: sessionStatus?.serverNowMs ?? null,
      consentedAtMs: sessionStatus?.consentedAtMs ?? null,
      captureExpiresAtMs: sessionStatus?.captureExpiresAtMs ?? null,
      endedAtMs: sessionStatus?.endedAtMs ?? null,
    }),
    [clockMs, estimatedServerNowMs, localRequestStartedAtMs, sessionStatus],
  );

  // 실시간 오디오 수신: 아이 기기가 broadcast(audio_chunk)로 보낸 WAV 청크를 재생.
  // familySocket 은 App 레벨(useFamilyRealtime)과 별개 연결 — 청취 중에만 열고 종료 시 닫는다.
  const playerRef = useRef<RemoteAudioPlayer | null>(null);
  const audioSocketRef = useRef<FamilySocket | null>(null);
  const seenChunksRef = useRef<Set<string>>(new Set());
  // 청크가 실제로 재생되기 시작했는지(연결 상태 표시용).
  const [receiving, setReceiving] = useState(false);
  const receivingRef = useRef(false);
  receivingRef.current = receiving;
  const listeningRef = useRef(false);
  listeningRef.current = listening;

  // 청취 종료(수동/타임아웃/언마운트 공통): 오디오 소켓/플레이어 정리 + audit 세션 종료 + 아이 캡처 중지.
  // 최신값 참조를 위해 매 렌더 ref 에 재바인딩(effect stale-closure 방지).
  const endListenRef = useRef<(reason: string) => void>(() => {});
  endListenRef.current = (reason: string) => {
    if (endingRef.current) return;
    endingRef.current = true;
    setListening(false);
    setReceiving(false);
    setWaitingHint(false);
    setLastAudioAtMs(null);
    setActiveRequestId(null);
    setLocalRequestStartedAtMs(null);
    seenChunksRef.current.clear();
    // 오디오 수신 소켓·플레이어 정리.
    if (audioSocketRef.current) {
      audioSocketRef.current.close();
      audioSocketRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.stop();
      playerRef.current = null;
    }
    const session = sessionRef.current;
    const requestId = requestIdRef.current;
    const targetChildUserId = targetChildUserIdRef.current;
    sessionRef.current = null;
    requestIdRef.current = null;
    targetChildUserIdRef.current = null;
    void stopThenCloseRef.current(session, targetChildUserId, requestId, reason);
  };

  useEffect(() => {
    if (!listening) return;
    setClockMs(Date.now());
    const id = window.setInterval(() => setClockMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [listening]);

  // 접힘/잠금 상태에서는 아이 기기가 알림/Activity 를 거쳐 늦게 열릴 수 있다.
  // hyeni-1 처럼 자동 종료하지 않고, 일정 시간 뒤 대기 안내만 더 명확하게 바꾼다.
  useEffect(() => {
    if (!listening || receiving) {
      setWaitingHint(false);
      return;
    }
    const id = window.setTimeout(() => {
      if (!receivingRef.current) setWaitingHint(true);
    }, REMOTE_AUDIO_WAITING_HELP_MS);
    return () => window.clearTimeout(id);
  }, [listening, receiving]);

  // 서버가 확인한 연결·캡처 절대 만료·아이 측 업로드 실패를 부모 화면의 정본으로 쓴다.
  // 상태 조회가 일시 실패하면 resolver의 보수적 상한이 마지막 순간 연결을 조기 종료하지 않는다.
  useEffect(() => {
    if (!listening) return;
    if (sessionTiming.phase === "request_expired") {
      endListenRef.current("request_timeout");
      show("아이 기기가 1분 안에 연결되지 않아 요청을 종료했어요", "⏱️");
      return;
    }
    if (sessionTiming.phase === "capture_expired") {
      endListenRef.current("timeout");
      show("1분이 지나 듣기를 종료했어요", "⏱️");
      return;
    }
    if (sessionTiming.phase === "ended") {
      const reason = sessionStatus?.endReason ?? "timeout";
      endListenRef.current(reason);
      if (reason === "audio_auth_failed") {
        show("아이 기기의 로그인 확인이 필요해 소리 공유가 중단됐어요", "🔒");
      } else if (reason === "audio_upload_failed") {
        show("소리 연결이 끊겨 듣기를 안전하게 종료했어요", "⚠️");
      } else if (reason === "request_timeout") {
        show("아이 기기가 1분 안에 연결되지 않아 요청을 종료했어요", "⏱️");
      } else if (reason === "timeout") {
        show("1분이 지나 듣기를 종료했어요", "⏱️");
      }
    }
  }, [listening, sessionStatus?.endReason, sessionTiming.phase, show]);

  // 청크 전송이 끊겼는데 과거 청크만으로 LIVE가 계속 보이지 않도록 즉시 연결 상태를 내린다.
  useEffect(() => {
    if (!listening || !receiving || lastAudioAtMs === null) return;
    const remainingFreshMs = lastAudioAtMs + REMOTE_AUDIO_STREAM_STALE_MS - Date.now();
    const id = window.setTimeout(() => {
      if (!listeningRef.current) return;
      setReceiving(false);
      setWaitingHint(true);
    }, Math.max(0, remainingFreshMs));
    return () => window.clearTimeout(id);
  }, [lastAudioAtMs, listening, receiving]);

  // 언마운트 시 열린 세션이 있으면 audit 행을 닫고 오디오 소켓/플레이어를 정리한다(never-ended·누수 방지).
  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        if (audioSocketRef.current) {
          audioSocketRef.current.close();
          audioSocketRef.current = null;
        }
        if (playerRef.current) {
          playerRef.current.stop();
          playerRef.current = null;
        }
        seenChunksRef.current.clear();
        const s = sessionRef.current;
        const requestId = requestIdRef.current;
        const targetChildUserId = targetChildUserIdRef.current;
        sessionRef.current = null;
        requestIdRef.current = null;
        targetChildUserIdRef.current = null;
        void stopThenCloseRef.current(s, targetChildUserId, requestId, "unmount");
      };
    },
    [],
  );

  // 듣기 시작: 킬 스위치 확인 → audit 세션 선기록 → 아이 기기 캡처 명령 → 오버레이.
  // 감사 기록을 만들 수 없으면 마이크 명령도 보내지 않는다(투명성 fail-closed).
  const startListen = async () => {
    if (startInFlightRef.current || requestIdRef.current) return;
    if (!remoteAudioDataReady) {
      show("아이와 위치 정보를 확인한 뒤 다시 시도해 주세요.", "⚠️");
      return;
    }
    startInFlightRef.current = true;
    endingRef.current = false;
    setStarting(true);
    try {
      if (!familyId || !userId || !childUserId) {
        show("대상 아이와 가족 정보를 확인한 뒤 다시 시도해 주세요.", "⚠️");
        return;
      }
      const allowed = await isRemoteListenAllowed(familyId);
      if (!mountedRef.current) return;
      if (!allowed) {
        show("가족 설정에서 원격 청취가 꺼져 있어요", "🔕");
        return;
      }
      seenChunksRef.current.clear();
      const auditSession = await openRemoteListenSession({
        familyId,
        initiatorUserId: userId,
        childUserId,
      });
      if (!mountedRef.current) {
        await closeRemoteListenSession(auditSession, "unmount_before_command");
        return;
      }
      if (!auditSession.id) {
        show("청취 기록을 안전하게 남길 수 없어 시작하지 않았어요. 잠시 후 다시 시도해 주세요.", "🔒");
        return;
      }
      const requestId = auditSession.id;
      requestIdRef.current = requestId;
      targetChildUserIdRef.current = childUserId;
      sessionRef.current = auditSession;
      let res: Awaited<ReturnType<typeof requestListen.mutateAsync>>;
      try {
        res = await requestListen.mutateAsync({
          targetChildUserId: childUserId,
          durationSec: LISTEN_SECONDS,
          requestId,
        });
        if (!mountedRef.current) return;
      } catch {
        if (!mountedRef.current) return;
        sessionRef.current = null;
        requestIdRef.current = null;
        targetChildUserIdRef.current = null;
        await stopThenCloseRef.current(
          auditSession,
          childUserId,
          requestId,
          "command_failed",
        );
        if (!mountedRef.current) return;
        show("아이 기기가 오프라인이거나 알림을 받을 수 없어요. 잠시 후 다시 시도해 주세요.", "⚠️");
        return;
      }
      if (!res.ok) {
        sessionRef.current = null;
        requestIdRef.current = null;
        targetChildUserIdRef.current = null;
        await stopThenCloseRef.current(
          auditSession,
          childUserId,
          requestId,
          `command_http_${res.status}`,
        );
        if (!mountedRef.current) return;
        if (res.status === 402) {
          show("주변 소리 듣기는 프리미엄에서 사용할 수 있어요. SOS와 긴급 알림은 무료로 계속 받을 수 있어요.", "⭐");
        }
        else if (res.status === 403) show("주 보호자만 원격 청취를 시작할 수 있어요", "🔒");
        else show("아이 기기가 오프라인이거나 알림을 받을 수 없어요. 잠시 후 다시 시도해 주세요.", "⚠️");
        return;
      }
      if (res.total === 0) {
        sessionRef.current = null;
        requestIdRef.current = null;
        targetChildUserIdRef.current = null;
        await stopThenCloseRef.current(
          auditSession,
          childUserId,
          requestId,
          "no_target_device",
        );
        if (!mountedRef.current) return;
        show("연결된 아이 기기를 찾지 못했어요. 아이 앱이 설치되어 있고 로그인되어 있는지 확인해 주세요.", "⚠️");
        return;
      }
      // 오디오 수신 시작: 플레이어 준비 + broadcast(audio_chunk) 구독.
      // 아이 네이티브가 보낸 WAV 청크를 FamilyRoom 이 fan-out → 여기서 디코드·재생한다.
      const player = new RemoteAudioPlayer();
      player.start();
      playerRef.current = player;
      audioSocketRef.current = openFamilySocket(
        familyId,
        () => getApiAccessToken(),
        (msg) => {
          if (msg.kind !== "broadcast" || msg.event !== "audio_chunk") return;
          const payload = msg.payload as
            | {
                data?: string;
                childUserId?: string;
                requestId?: string;
                sequenceNumber?: number | string;
                mimeType?: string;
                durationMs?: number | string;
                source?: string;
              }
            | undefined;
          const activeRequestId = requestIdRef.current;
          if (!childUserId || !activeRequestId) return;
          if (!payload?.childUserId || payload.childUserId !== childUserId) return;
          if (!payload?.requestId || payload.requestId !== activeRequestId) return;
          if (!payload?.data) return;
          const sequence = Number.isFinite(Number(payload.sequenceNumber))
            ? Number(payload.sequenceNumber)
            : null;
          const chunkKey = [
            payload.requestId,
            payload.childUserId,
            sequence === null ? payload.source || payload.mimeType || "audio" : "seq",
            sequence === null ? payload.data.slice(0, 96) : String(sequence),
          ].join(":");
          if (seenChunksRef.current.has(chunkKey)) return;
          seenChunksRef.current.add(chunkKey);
          if (seenChunksRef.current.size > 180) {
            seenChunksRef.current = new Set(Array.from(seenChunksRef.current).slice(-120));
          }
          const activePlayer = playerRef.current;
          if (!activePlayer) return;
          void activePlayer.enqueueBase64Wav(payload.data, payload.mimeType ?? "audio/wav").then((played) => {
            if (played && requestIdRef.current === payload.requestId) {
              setLastAudioAtMs(Date.now());
              setWaitingHint(false);
              if (!receivingRef.current) setReceiving(true);
            }
          });
        },
      );

      setMuted(false);
      setReceiving(false);
      setWaitingHint(false);
      setLastAudioAtMs(null);
      setLocalRequestStartedAtMs(auditSession.startedAt);
      setActiveRequestId(requestId);
      setClockMs(Date.now());
      setListening(true);
    } finally {
      startInFlightRef.current = false;
      if (mountedRef.current) setStarting(false);
    }
  };
  const stopListen = () => endListenRef.current("user_stop");
  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      playerRef.current?.setMuted(next);
      show(next ? "소리를 음소거했어요" : "음소거를 해제했어요", next ? "🔇" : "🔊");
      return next;
    });
  };
  // 보호자에게 실제 발신(placePhoneCall). 번호 미등록이면 정직하게 안내.
  const callGuardian = () => {
    if (!callTarget?.phone) {
      show("등록된 보호자 전화번호가 없어요", "📞");
      return;
    }
    show(`${callTarget.name || "보호자"}에게 전화를 거는 중…`, "📞");
    void placePhoneCall(callTarget.phone).then((r) => {
      if (!r.ok) show("전화를 걸 수 없어요. 전화 앱을 확인해 주세요", "⚠️");
    });
  };

  const consentConfirmed = sessionTiming.phase === "consented";
  const remaining = sessionTiming.remainingSeconds ?? 0;
  const remoteTime = consentConfirmed
    ? `${pad2(Math.floor(remaining / 60))}:${pad2(remaining % 60)}`
    : "--:--";
  const listenEyebrow = receiving
    ? "주변 소리 듣는 중"
    : consentConfirmed
      ? "기기 확인 · 소리 연결 중"
    : waitingHint
      ? "응답 기다리는 중"
      : "아이 기기 연결 중";
  const liveLabel = receiving ? "LIVE" : consentConfirmed ? "확인됨" : waitingHint ? "대기" : "연결 중";
  const listenFoot = receiving
    ? "소리가 연결됐어요"
    : consentConfirmed
      ? "아이 기기를 확인했어요. 소리를 연결하고 있어요"
    : waitingHint
      ? sessionStatusQuery.isError
        ? "아이 응답과 서버 상태를 다시 확인하고 있어요"
        : "아이 기기 응답 대기"
      : "아이 기기에서 소리를 여는 중이에요";

  // 청취가 시작된 뒤의 일시적 재조회 실패는 중지 동선을 가리지 않는다.
  // 대기 상태에서는 대상·위치·가족 정본이 모두 확인된 경우에만 원격 청취를 연다.
  if (!listening && remoteAudioQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle="주변 소리 듣기"
        state="loading"
        heading="아이 연결 정보를 확인하고 있어요"
        description="청취 대상과 현재 위치 정보를 안전하게 확인하는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (!listening && (remoteAudioQueryState === "error" || remoteAudioDataMissing)) {
    return (
      <ScreenQueryState
        screenTitle="주변 소리 듣기"
        state="error"
        heading="주변 소리 정보를 확인하지 못했어요"
        description="확인되지 않은 아이에게 요청이 가지 않도록 시작 기능을 닫았어요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryRemoteAudio()}
        retrying={remoteAudioRefetching}
      />
    );
  }

  if (!listening && childMembers.length === 0) {
    return (
      <ScreenQueryState
        screenTitle="주변 소리 듣기"
        state="empty"
        heading="연결된 아이가 없어요"
        description="아이를 연결한 뒤, 아이가 직접 허용하면 주변 소리를 들을 수 있어요."
        onBack={() => navigate(-1)}
        onRetry={() => navigate("/child-invite")}
        retryLabel="아이 연결하기"
      />
    );
  }

  return (
    <div className="ra-root">
      {/* 대기 화면 */}
      <div className="ra-idle">
        <button
          type="button"
          className="ra-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>

        <div className="ra-idle-center">
          <div className="ra-halo">
            <span className="ra-halo-ring1" />
            <span className="ra-halo-ring2" />
            <img className="ra-halo-img" src={asset("ui/menu-remote-audio.webp")} alt="" />
          </div>
          <div className="ra-title">{childName} 주변 소리 듣기</div>
          <div className="ra-sub">
            위급할 때 아이 주변 소리를
            <br />
            1분 동안 들을 수 있어요
          </div>
          <div className="ra-trust-grid">
            {TRUST_CARDS.map((item) => {
              const TrustIcon = item.icon;
              return (
                <div key={item.title} className="ra-trust-card hy-explain">
                  <span className="ra-trust-card__icon" aria-hidden="true">
                    <TrustIcon size={20} strokeWidth={2.2} />
                  </span>
                  <span className="ra-trust-card__body hy-explain__lines">
                    <span className="ra-trust-card__title hy-explain__line">{item.title}</span>
                    <span className="ra-trust-card__text hy-explain__line">{item.text}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="ra-audit-link hy-press"
            onClick={() => navigate("/remote-audio-audit")}
          >
            <FileClock size={18} strokeWidth={2.2} />
            청취 기록 보기
          </button>
        </div>

        {native ? (
          <div className="ra-start-wrap">
            <div className="ra-start-note hy-explain">
              <span className="hy-explain__lines">
                <span className="hy-explain__line">위급할 때만 사용해 주세요.</span>
                <span className="hy-explain__line">아이 기기에 알림이 뜨고 곧바로 연결돼요.</span>
              </span>
            </div>
            <button
              type="button"
              className="ra-start hy-press"
              onClick={() => void startListen()}
              disabled={starting || requestListen.isPending || !childUserId || !remoteAudioDataReady}
              aria-busy={starting || requestListen.isPending}
            >
              <Mic size={20} strokeWidth={2.2} color="#fff" />
              {starting || requestListen.isPending ? "연결 요청 중" : "듣기 시작"}
            </button>
          </div>
        ) : (
          <div className="ra-webnote hy-explain">
            <Smartphone size={18} strokeWidth={2.2} color="#6d4e9c" />
            주변 소리 듣기는 안드로이드 앱에서 지원돼요
          </div>
        )}
      </div>

      {/* 듣는 중 오버레이 */}
      {listening && (
        <div className="ra-listen" data-receiving={receiving ? "true" : "false"}>
          <div className="ra-listen-head">
            <div className="ra-listen-eyebrow">{listenEyebrow}</div>
            <div className="ra-listen-title">
              {childName} · {childPlace}
            </div>
          </div>

          <div className="ra-pulse">
            <span className="ra-pulse-ring1" />
            <span className="ra-pulse-ring2" />
            <div className="ra-pulse-core">
              <Mic size={52} strokeWidth={1.8} color="#fff" />
            </div>
          </div>

          <div className="ra-bars">
            {WAVE_DELAYS.map((delay, i) => (
              <span key={i} className="ra-bar" style={{ animationDelay: delay }} />
            ))}
          </div>

          <div className="ra-timer">
            <span className="ra-live">
              <span className="ra-live-dot" />
              {liveLabel}
            </span>
            <span className="ra-time">{remoteTime}</span>
          </div>

          <div className="ra-controls">
            <button
              type="button"
              className="ra-ctrl-mute hy-press"
              aria-label={muted ? "음소거 해제" : "음소거"}
              aria-pressed={muted}
              data-muted={muted}
              onClick={toggleMute}
            >
              <VolumeX size={24} strokeWidth={2.2} color="#fff" />
            </button>
            <button
              type="button"
              className="ra-ctrl-stop hy-press"
              aria-label="종료"
              onClick={stopListen}
            >
              <span className="ra-stop-square" />
            </button>
            <button
              type="button"
              className="ra-ctrl-call hy-press"
              aria-label="보호자에게 전화"
              onClick={callGuardian}
            >
              <Phone size={24} strokeWidth={2.2} color="#fff" />
            </button>
          </div>

          <div className="ra-listen-foot">{listenFoot}</div>
        </div>
      )}
    </div>
  );
}
