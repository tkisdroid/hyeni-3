import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Mic, VolumeX, Phone, Smartphone } from "lucide-react";
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
import { openFamilySocket, type FamilySocket } from "@/realtime/familySocket";
import { getApiAccessToken } from "@/lib/api/session";
import { RemoteAudioPlayer } from "@/lib/remoteAudioPlayer";
import "./RemoteAudio.css";

/** 듣기 제한 시간(초) · 위급 시 1분 청취. */
const LISTEN_SECONDS = 60;
/** hyeni-1 과 동일: 아이가 잠금/접힘 상태이면 알림 확인까지 시간이 걸릴 수 있어 대기 안내만 전환한다. */
const REMOTE_AUDIO_WAITING_HELP_MS = 25_000;

/** 웨이브 이퀄라이저 막대(20개)의 애니메이션 위상차. */
const WAVE_DELAYS = [
  "-0.90s", "-0.20s", "-0.60s", "0s", "-0.40s",
  "-0.80s", "-0.10s", "-0.50s", "-0.30s", "-0.70s",
  "-0.15s", "-0.55s", "-0.35s", "-0.75s", "-0.05s",
  "-0.45s", "-0.65s", "-0.25s", "-0.85s", "-0.50s",
] as const;

const pad2 = (n: number): string => String(n).padStart(2, "0");
const makeRequestId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

/** 주변소리: 대기 화면 → '듣는 중' 오버레이(웨이브) 토글. */
export function RemoteAudio() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId, userId } = useAuth();
  const { data: family } = useMyFamily();
  const { data: locations } = useChildLocations();
  const { data: places } = useSavedPlaces();

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
  const [remaining, setRemaining] = useState(LISTEN_SECONDS);
  const [waitingHint, setWaitingHint] = useState(false);

  // 실제 청취 세션: 아이 기기 캡처 명령(push-notify) + audit 세션 행(remote_listen_sessions).
  const requestListen = useRequestRemoteListen();
  const stopListenCmd = useStopRemoteListen();
  const sessionRef = useRef<RemoteListenSession | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const childUserId = childMember?.user_id ?? null;

  // 실시간 오디오 수신: 아이 기기가 broadcast(audio_chunk)로 보낸 WAV 청크를 재생.
  // familySocket 은 App 레벨(useFamilyRealtime)과 별개 연결 — 청취 중에만 열고 종료 시 닫는다.
  const playerRef = useRef<RemoteAudioPlayer | null>(null);
  const audioSocketRef = useRef<FamilySocket | null>(null);
  const seenChunksRef = useRef<Set<string>>(new Set());
  // 청크가 실제로 재생되기 시작했는지(연결 상태 표시용).
  const [receiving, setReceiving] = useState(false);
  const receivingRef = useRef(false);
  receivingRef.current = receiving;

  // 청취 종료(수동/타임아웃/언마운트 공통): 오디오 소켓/플레이어 정리 + audit 세션 종료 + 아이 캡처 중지.
  // 최신값 참조를 위해 매 렌더 ref 에 재바인딩(effect stale-closure 방지).
  const endListenRef = useRef<(reason: string) => void>(() => {});
  endListenRef.current = (reason: string) => {
    setListening(false);
    setReceiving(false);
    setWaitingHint(false);
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
    sessionRef.current = null;
    requestIdRef.current = null;
    void closeRemoteListenSession(session, reason);
    stopListenCmd.mutate({ targetChildUserId: childUserId });
  };

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

  // 청취 중 1초 카운트다운. 첫 오디오 재생이 시작된 뒤에만 1분을 센다.
  useEffect(() => {
    if (!listening || !receiving) return;
    if (remaining <= 0) {
      endListenRef.current("timeout");
      show("1분이 지나 듣기를 종료했어요", "⏱️");
      return;
    }
    const id = window.setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => window.clearTimeout(id);
  }, [listening, receiving, remaining, show]);

  // 언마운트 시 열린 세션이 있으면 audit 행을 닫고 오디오 소켓/플레이어를 정리한다(never-ended·누수 방지).
  useEffect(
    () => () => {
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
      if (s) {
        sessionRef.current = null;
        void closeRemoteListenSession(s, "unmount");
      }
    },
    [],
  );

  // 듣기 시작: 킬 스위치 확인 → 아이 기기 캡처 명령 → audit 세션 생성 → 오버레이. (사용자 액션 전용)
  const startListen = async () => {
    const allowed = await isRemoteListenAllowed(familyId);
    if (!allowed) {
      show("가족 설정에서 원격 청취가 꺼져 있어요", "🔕");
      return;
    }
    // 아이 기기에 캡처 시작 명령(서버가 프리미엄·주보호자 게이트) — 실패 시 정직 안내.
    const requestId = makeRequestId();
    requestIdRef.current = requestId;
    seenChunksRef.current.clear();
    let res: Awaited<ReturnType<typeof requestListen.mutateAsync>>;
    try {
      res = await requestListen.mutateAsync({
        targetChildUserId: childUserId,
        durationSec: LISTEN_SECONDS,
        requestId,
      });
    } catch {
      requestIdRef.current = null;
      show("청취 명령을 전송하지 못했어요", "⚠️");
      return;
    }
    if (!res.ok) {
      requestIdRef.current = null;
      if (res.status === 402) show("원격 청취는 프리미엄 구독에서 지원돼요", "⭐");
      else if (res.status === 403) show("주 보호자만 원격 청취를 시작할 수 있어요", "🔒");
      else show("청취 명령을 전송하지 못했어요", "⚠️");
      return;
    }
    if (res.total === 0) {
      requestIdRef.current = null;
      show("연결된 아이 기기를 찾지 못했어요", "⚠️");
      return;
    }
    // audit 세션 행 생성(마이크 캡처보다 먼저 — 크래시 시 정리 가능).
    sessionRef.current = await openRemoteListenSession({
      familyId,
      initiatorUserId: userId,
      childUserId,
    });

    // 오디오 수신 시작: 플레이어 준비 + broadcast(audio_chunk) 구독.
    // 아이 네이티브가 보낸 WAV 청크를 FamilyRoom 이 fan-out → 여기서 디코드·재생한다.
    const player = new RemoteAudioPlayer();
    player.start();
    playerRef.current = player;
    if (familyId) {
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
          // 대상 아이가 지정돼 있으면 그 아이 청크만 재생(다자녀 격리).
          if (childUserId && payload?.childUserId && payload.childUserId !== childUserId) return;
          const activeRequestId = requestIdRef.current;
          if (payload?.requestId && activeRequestId && payload.requestId !== activeRequestId) return;
          if (!payload?.data) return;
          const sequence = Number.isFinite(Number(payload.sequenceNumber))
            ? Number(payload.sequenceNumber)
            : null;
          const chunkKey = [
            payload.requestId || activeRequestId || "legacy",
            payload.childUserId || "",
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
            if (played && !receivingRef.current) {
              setRemaining(LISTEN_SECONDS);
              setWaitingHint(false);
              setReceiving(true);
            }
          });
        },
      );
    }

    setMuted(false);
    setReceiving(false);
    setWaitingHint(false);
    setRemaining(LISTEN_SECONDS);
    setListening(true);
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
    void placePhoneCall(callTarget.phone);
  };

  const remoteTime = `${pad2(Math.floor(remaining / 60))}:${pad2(remaining % 60)}`;
  const listenEyebrow = receiving
    ? "주변 소리 듣는 중"
    : waitingHint
      ? "응답 기다리는 중"
      : "아이 기기 연결 중";
  const liveLabel = receiving ? "LIVE" : waitingHint ? "대기" : "연결 중";
  const listenFoot = receiving
    ? "소리가 연결됐어요"
    : waitingHint
      ? "아이 알림 확인 대기"
      : "아이 기기에서 소리를 여는 중이에요";

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
          <div className="ra-note">🔔 아이에게 알림이 가요</div>
        </div>

        {native ? (
          <button
            type="button"
            className="ra-start hy-press"
            onClick={() => void startListen()}
            disabled={requestListen.isPending}
          >
            <Mic size={21} strokeWidth={2} color="#fff" />
            {requestListen.isPending ? "연결 요청 중" : "듣기 시작"}
          </button>
        ) : (
          <div className="ra-webnote">
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
              <VolumeX size={24} strokeWidth={2} color="#fff" />
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
              <Phone size={24} strokeWidth={2} color="#fff" />
            </button>
          </div>

          <div className="ra-listen-foot">{listenFoot}</div>
        </div>
      )}
    </div>
  );
}
