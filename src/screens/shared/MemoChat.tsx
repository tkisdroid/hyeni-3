import { useFamilyTimeZone } from "@/region/FamilyTimeZone";
import { useIntl } from "react-intl";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePwaUpdateCriticalSection } from "@/lib/usePwaUpdateCriticalSection";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, Send, Image as ImageIcon, MapPin, ShieldAlert, Download } from "lucide-react";
import { asset } from "@/lib/assets";
import { childAvatarPath, parentAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { useSafeBack } from "@/app/useSafeBack";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { ChildSwitcher } from "@/components/ChildSwitcher";
import { useMyFamily } from "@/queries/useFamily";
import { useMemoThread, useSendMemo, useMarkRead, useUnreadMemoChildIds } from "@/queries/useMemo";
import { isPendingMemoReply } from "@/queries/memoCache";
import { useChildLocations } from "@/queries/useLocation";
import {
  mapRepliesToThread,
  encodeImageContent,
  encodeLocationContent,
  formatMemoDayLabel,
  type ThreadMsg,
} from "@/transform/memoView";
import { resolveMemoQuickReplies } from "@/transform/memoQuickReplies";
import { resolveMemoChatCopy } from "@/transform/memoChatCopy";
import { useRecentDateKeys } from "@/app/useRecentDateKeys";
import { apiUploadChildPhoto, acquireChildPhotoObjectUrl } from "@/lib/api/client";
import { resizeImageFileSafe, dataUrlToBlob } from "@/lib/imageResize";
import { reverseRawMapLabel } from "@/lib/mapActions";
import { openExternal } from "@/lib/native/browser";
import { MessageSafetyDialog, type ReportReasonOption } from "@/components/MessageSafetyDialog";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { useLongPress, type LongPressHandlers } from "@/lib/useLongPress";
import { usePinchZoom } from "@/lib/usePinchZoom";
import { saveImageToDevice } from "@/lib/native/mediaSave";
import {
  useBlockMemoUser,
  useMemoBlocks,
  useReportMemoReply,
  useUnblockMemoUser,
} from "@/queries/useContentSafety";
import type { MemoContentReportReason } from "@/lib/api/endpoints/contentSafety";
import { Loading } from "@/components/ui/Loading";
import { useLocale } from "@/i18n/useLocale";

import { latestDateKeyOrNull } from "@/transform/dateKey";
import "@/styles/jua.css";
import "./MemoChat.css";

const MEMO_REPORT_REASONS = [
  { value: "harassment", labelId: "shared.memo.report.harassment.formal" },
  { value: "sexual_or_violent", labelId: "shared.memo.report.sexualOrViolent.formal" },
  { value: "personal_info", labelId: "shared.memo.report.personalInfo.formal" },
  { value: "illegal_or_dangerous", labelId: "shared.memo.report.illegalOrDangerous.formal" },
  { value: "other", labelId: "shared.memo.report.other.formal" },
] as const;

const CHILD_MEMO_REPORT_REASONS = [
  { value: "harassment", labelId: "shared.memo.report.harassment.child" },
  { value: "sexual_or_violent", labelId: "shared.memo.report.sexualOrViolent.child" },
  { value: "personal_info", labelId: "shared.memo.report.personalInfo.child" },
  { value: "illegal_or_dangerous", labelId: "shared.memo.report.illegalOrDangerous.child" },
  { value: "other", labelId: "shared.memo.report.other.child" },
] as const;

/** photo_url(http/blob)은 그대로, 로컬 캐릭터 키는 asset()으로 해석. */
function avatarSrc(path: string): string {
  return path.startsWith("http") || path.startsWith("blob:") ? path : asset(path);
}

/** 등록한 사진인지(=원을 꽉 채워야 하는지). 기본 캐릭터 그림은 여백을 남긴다. */
function isUploadedAvatar(src: string | null | undefined): boolean {
  const value = src ?? "";
  return value.startsWith("http") || value.startsWith("blob:");
}

type ChildPhotoLoadState =
  | { path: string | null; status: "idle" | "loading" | "error"; url: null }
  | { path: string; status: "ready"; url: string };

interface ActiveChildPhotoLease {
  url: string | null;
  release(): void;
}

function verifyPrivateImageDecode(image: HTMLImageElement, onFailure: () => void): void {
  if (typeof image.decode !== "function") return;
  try {
    void image.decode().catch(onFailure);
  } catch {
    onFailure();
  }
}

function useChildPhotoUrl(path: string | null, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ChildPhotoLoadState>({ path: null, status: "idle", url: null });
  const activeLeaseRef = useRef<ActiveChildPhotoLease | null>(null);
  useEffect(() => {
    if (!path || !enabled) {
      setState({ path, status: "idle", url: null });
      return;
    }
    const lease = acquireChildPhotoObjectUrl(path);
    if (!lease) {
      setState({ path, status: "error", url: null });
      return;
    }
    const activeLease: ActiveChildPhotoLease = {
      url: null,
      release: () => lease.release(),
    };
    activeLeaseRef.current = activeLease;
    let active = true;
    setState({ path, status: "loading", url: null });
    void lease.url
      .then((next) => {
        if (!active) return;
        if (!next) {
          if (activeLeaseRef.current === activeLease) activeLeaseRef.current = null;
          activeLease.release();
          setState({ path, status: "error", url: null });
          return;
        }
        activeLease.url = next;
        setState({ path, status: "ready", url: next });
      })
      .catch(() => {
        if (activeLeaseRef.current === activeLease) activeLeaseRef.current = null;
        activeLease.release();
        if (active) setState({ path, status: "error", url: null });
      });
    return () => {
      active = false;
      if (activeLeaseRef.current === activeLease) activeLeaseRef.current = null;
      activeLease.release();
    };
  }, [attempt, enabled, path]);

  const visibleState: ChildPhotoLoadState = enabled && state.path === path
    ? state
    : { path, status: "idle", url: null };
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const markError = useCallback((failedUrl: string) => {
    const activeLease = activeLeaseRef.current;
    if (!activeLease || activeLease.url !== failedUrl) return;
    activeLeaseRef.current = null;
    activeLease.release();
    setState((current) => (
      current.status === "ready" && current.url === failedUrl
        ? { path: current.path, status: "error", url: null }
        : current
    ));
  }, []);
  return { ...visibleState, retry, markError };
}

function MemoImageBubble({
  path,
  press,
  isChildSession,
  onOpen,
}: {
  path: string;
  press: LongPressHandlers;
  isChildSession: boolean;
  onOpen: () => void;
}) {
  const intl = useIntl();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [nearby, setNearby] = useState(false);
  const photo = useChildPhotoUrl(path, nearby);

  useEffect(() => {
    const button = buttonRef.current;
    setNearby(false);
    if (!button) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearby(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNearby(entry?.isIntersecting === true),
      { rootMargin: "360px 0px" },
    );
    observer.observe(button);
    return () => observer.disconnect();
  }, [path]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className="mc-bubble mc-bubble--img hy-press"
      aria-label={intl.formatMessage({ id: photo.status === "error" ? "shared.memo.photo.retry" : "shared.memo.photo.open" })}
      aria-busy={photo.status === "loading"}
      onClick={(event) => {
        press.onClick?.(event);
        if (event.defaultPrevented) return;
        if (photo.status === "error") {
          photo.retry();
          return;
        }
        if (photo.status === "ready") onOpen();
      }}
      onPointerDown={press.onPointerDown}
      onPointerMove={press.onPointerMove}
      onPointerUp={press.onPointerUp}
      onPointerCancel={press.onPointerCancel}
      onPointerLeave={press.onPointerLeave}
      onContextMenu={press.onContextMenu}
    >
      {photo.status === "ready" ? (
        <img
          src={photo.url}
          alt={intl.formatMessage({ id: "shared.memo.photo.alt" })}
          decoding="async"
          onLoad={(event) => verifyPrivateImageDecode(
            event.currentTarget,
            () => photo.markError(photo.url),
          )}
          onError={() => photo.markError(photo.url)}
        />
      ) : (
        <span className={`mc-private-photo-status mc-private-photo-status--${photo.status}`} role="status">
          {photo.status === "error"
            ? (isChildSession
                ? intl.formatMessage({ id: "shared.memo.photo.error.child" })
                : intl.formatMessage({ id: "shared.memo.photo.error.formal" }))
            : intl.formatMessage({ id: "shared.memo.photo.loading" })}
        </span>
      )}
    </button>
  );
}


export function MemoChat() {
  const familyTimeZone = useFamilyTimeZone();
  const intl = useIntl();
  const { locale } = useLocale();
  const goBack = useSafeBack();
  const { show } = useToast();
  const { userId, role, familyId } = useAuth();
  const isChildSession = role === "child";
  const {
    data: family,
    isLoading: familyLoading,
    isError: familyError,
    refetch: refetchFamily,
  } = useMyFamily();
  const { activeChild, childMembers } = useActiveChild();
  const [searchParams, setSearchParams] = useSearchParams();
  const childHint = searchParams.get("child")?.trim() || null;

  // 대화 스코프 아이(member id) — 아이별 1:1 스레드(TK 결정: 대화도 각각).
  // 부모/선생님 = 전역 활성 아이(홈·대화 상단 전환 알약), 아이 = 자기 자신. 메시지 fetch·send 모두 이 스코프.
  const scopeChild = useMemo(() => {
    if (!family) return null;
    const members = family.members;
    if (role === "child") return members.find((m) => m.user_id === userId) ?? null;
    if (childHint) {
      const hintedChild = members.find(
        (m) => m.role === "child" && (m.id === childHint || m.user_id === childHint),
      ) ?? null;
      return hintedChild;
    }
    return activeChild && members.some((member) => member.role === "child" && member.id === activeChild.id)
      ? activeChild
      : null;
  }, [family, role, userId, activeChild, childHint]);
  const explicitChildMissing = role !== "child"
    && !!childHint
    && !familyLoading
    && !familyError
    && !scopeChild;

  // 최근 7일 date_key 스레드 — 스코프 아이 한정. 오늘만 보이던 이전 방식은
  // 어제 대화가 사라져 보이는 실사용 혼란(주간 리포트 15건 vs 빈 대화 탭)을 만들었다.
  const dateKeys = useRecentDateKeys(7, familyTimeZone);
  const memoDateKey = latestDateKeyOrNull(dateKeys);
  const thread = useMemoThread(dateKeys, scopeChild?.id ?? null);
  // 다자녀 부모: 지금 보지 않는 아이의 새 메시지를 전환 알약의 점으로 알린다(아이 세션은 형제 스레드를 읽지 않는다).
  const unreadChildIds = useUnreadMemoChildIds(
    isChildSession ? [] : dateKeys,
    isChildSession ? [] : childMembers.map((member) => member.id),
  );
  const sendMemo = useSendMemo();
  const markRead = useMarkRead();
  const memoBlocks = useMemoBlocks();
  const reportMemoReply = useReportMemoReply();
  const blockMemoUser = useBlockMemoUser();
  const unblockMemoUser = useUnblockMemoUser();
  // mutate 를 ref 로 잡아 effect 재실행(매 렌더 새 mutation 객체 생성)을 막는다.
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;

  // user_id → {이름, 아바타} 조회표 — peer 메시지를 실제 발신자(아이/공동부모)로 정확 귀속.
  const memberByUserId = useMemo(() => {
    const map = new Map<string, { name: string; avatar: string; role: string }>();
    for (const m of family?.members ?? []) {
      if (!m.user_id) continue;
      // 부모는 등록한 프로필 사진 > 성별 기본 캐릭터(예전에는 아빠 계정도 엄마 캐릭터였다).
      const avatar = m.role === "parent"
        ? parentAvatarPath(m.photo_url, m.gender)
        : childAvatarPath(m.photo_url);
      map.set(m.user_id, {
        name: m.name || (m.role === "parent" ? intl.formatMessage({ id: "shared.memoChat.copy001" }) : intl.formatMessage({ id: "shared.memoChat.copy002" })),
        avatar: avatarSrc(avatar),
        role: m.role,
      });
    }
    return map;
  }, [family, intl]);

  // 1:1 헤더 상대(peer). 아이가 보면 부모, 부모가 보면 스코프 아이(전역 활성 아이).
  const peer = useMemo(() => {
    const members = family?.members ?? [];
    if (role === "child") {
      const parent = members.find((m) => m.role === "parent") ?? null;
      return {
        userId: parent?.user_id ?? null,
        name: parent?.name || intl.formatMessage({ id: "shared.memoChat.copy003" }),
        avatar: avatarSrc(parent?.photo_url || "animal/bear.webp"),
      };
    }
    return {
      userId: scopeChild?.user_id ?? null,
      name: scopeChild?.name || intl.formatMessage({ id: "shared.memoChat.copy004" }),
      avatar: avatarSrc(childAvatarPath(scopeChild?.photo_url)),
    };
  }, [family, intl, role, scopeChild]);

  const replies = useMemo(() => thread.data ?? [], [thread.data]);
  // 빈 content(빈 문자열/공백뿐)는 빈 흰 말풍선이 되므로 스레드에서 제외한다.
  const messages = useMemo(
    () => mapRepliesToThread(replies, userId, locale, familyTimeZone, intl)
      .filter((m) => m.text.trim().length > 0),
    [familyTimeZone, intl, locale, replies, userId],
  );

  // 내가 보낸 메시지 중 나 외 가족 구성원이 하나라도 읽은 것 → "읽음" 표기.
  // (첫째 아이 user_id 만 검사하던 방식은 둘째만 읽으면 영원히 미표시 → 다자녀 대응.)
  const readByPeer = useMemo(() => {
    const set = new Set<string>();
    if (!userId) return set;
    for (const r of replies) {
      if (r.user_id !== userId) continue;
      const others = (r.read_by ?? []).filter((uid) => uid && uid !== userId);
      if (others.length > 0) set.add(r.id);
    }
    return set;
  }, [replies, userId]);

  const [draft, setDraft] = useState("");
  const [safetyTarget, setSafetyTarget] = useState<ThreadMsg | null>(null);
  const [previewImagePath, setPreviewImagePath] = useState<string | null>(null);
  const previewImage = useChildPhotoUrl(previewImagePath);
  const previewImageUrl = previewImage.status === "ready" ? previewImage.url : null;
  const previewGestureReady = previewImage.status === "ready";
  const [savingPhoto, setSavingPhoto] = useState(false);
  const previewCloseButtonRef = useRef<HTMLButtonElement>(null);
  const previewDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: previewImagePath !== null,
    onClose: () => setPreviewImagePath(null),
    initialFocusRef: previewCloseButtonRef,
  });
  const photoZoom = usePinchZoom();
  // 사진을 닫을 때 확대 상태를 초기화한다(다음 사진에 이전 배율이 남지 않게).
  // reset 은 안정적인 참조라 previewImagePath 가 바뀔 때만 실행된다.
  const resetPhotoZoom = photoZoom.reset;
  useEffect(() => {
    if (previewImagePath === null) resetPhotoZoom();
  }, [previewImagePath, resetPhotoZoom]);

  const savePreviewPhoto = useCallback(async () => {
    if (!previewImageUrl || savingPhoto) return;
    setSavingPhoto(true);
    try {
      const result = await saveImageToDevice(previewImageUrl);
      if (result.ok) {
        show(
          result.target === "gallery"
            ? (isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy005" }) : intl.formatMessage({ id: "shared.memoChat.copy006" }))
            : (isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy007" }) : intl.formatMessage({ id: "shared.memoChat.copy008" })),
        );
      } else if (result.reason === "permission_denied") {
        show(
          isChildSession
            ? intl.formatMessage({ id: "shared.memoChat.copy009" })
            : intl.formatMessage({ id: "shared.memoChat.copy010" }),
        );
      } else if (result.reason === "unsupported") {
        show(isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy011" }) : intl.formatMessage({ id: "shared.memoChat.copy012" }));
      } else {
        show(
          isChildSession
            ? intl.formatMessage({ id: "shared.memoChat.copy013" })
            : intl.formatMessage({ id: "shared.memoChat.copy014" }),
        );
      }
    } finally {
      setSavingPhoto(false);
    }
  }, [intl, isChildSession, previewImageUrl, savingPhoto, show]);
  // 신고·차단은 상대 메시지를 길게 누르면 열린다(버튼을 매 메시지에 띄우지 않기 위해).
  // 내 메시지와 발신자를 알 수 없는 레거시 행은 신고 대상이 아니므로 길게 누르기를 붙이지 않는다.
  const bindLongPressSafety = useLongPress<ThreadMsg>((m) => setSafetyTarget(m));
  const bindSafetyPress = useCallback(
    (m: ThreadMsg, onClick?: (event: ReactMouseEvent) => void): LongPressHandlers => (
      !m.mine && m.senderUserId ? bindLongPressSafety(m, onClick) : { onClick }
    ),
    [bindLongPressSafety],
  );
  const endRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const lastMessageId = messages[messages.length - 1]?.id ?? "";
  // 빠른 답장·안내 문구는 보내는 사람에 따라 다르다 — 아이 화면에 부모 문구("숙제는 했어?")나
  // 존댓말 안내가 뜨면 안 된다(말투 규칙: 아이 모드 = 반말).
  const quickReplies = useMemo(() => resolveMemoQuickReplies(role, intl), [role, intl]);
  const copy = useMemo(() => resolveMemoChatCopy(role, intl), [role, intl]);
  const blockedUserIds = useMemo(
    () => new Set(memoBlocks.data?.blockedUserIds ?? []),
    [memoBlocks.data?.blockedUserIds],
  );
  const blockedMembers = useMemo(
    () => [...blockedUserIds]
      .map((id) => ({ id, member: memberByUserId.get(id) ?? null })),
    [blockedUserIds, memberByUserId],
  );
  const safetySender = safetyTarget?.senderUserId
    ? memberByUserId.get(safetyTarget.senderUserId) ?? null
    : null;

  const scrollThreadToBottom = (behavior: ScrollBehavior) => {
    const anchor = endRef.current;
    if (!anchor) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const scrollHost = anchor.closest(".hy-screen") as HTMLElement | null;
        if (scrollHost) {
          scrollHost.scrollTo({ top: scrollHost.scrollHeight, behavior });
          return;
        }
        anchor.scrollIntoView({ behavior, block: "end" });
      });
    });
  };

  // 상대 메시지 열람 → 읽음 처리(read-receipt). 이미 읽음/처리한 id 는 건너뛰고,
  // 서버가 read_by 갱신 후 재요청되면 조건에서 걸러져 자기종료(무한 루프 없음).
  const markedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!userId) return;
    for (const r of replies) {
      if (r.user_id === userId) continue; // 내 메시지는 스킵
      if (isPendingMemoReply(r)) continue; // 아직 서버에 없는 임시 행
      if ((r.content ?? "").trim().length === 0) continue;
      if ((r.read_by ?? []).includes(userId)) continue;
      if (markedRef.current.has(r.id)) continue;
      const replyId = r.id;
      markedRef.current.add(replyId);
      void markReadRef.current
        .mutateAsync(replyId)
        .catch(() => undefined)
        .finally(() => markedRef.current.delete(replyId));
    }
  }, [replies, userId]);

  useEffect(() => {
    scrollThreadToBottom(mounted.current ? "smooth" : "auto");
    mounted.current = true;
  }, [lastMessageId, messages.length]);

  const handleSend = () => {
    if (!scopeChild) {
      show(isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy015" }) : intl.formatMessage({ id: "shared.memoChat.copy016" }), "⚠️");
      return;
    }
    if (!memoDateKey) {
      show(isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy017" }) : intl.formatMessage({ id: "shared.memoChat.copy018" }), "⚠️");
      return;
    }
    const text = draft.trim();
    if (!text) {
      show(copy.emptyDraft, "✏️");
      return;
    }
    if (sendMemo.isPending) return;
    // 입력칸은 서버 응답을 기다리지 않고 바로 비운다 — 기다리면 앱이 멈춘 것처럼 보인다.
    // 실패하면 원문을 그대로 돌려주므로 사용자가 다시 타이핑할 필요는 없다.
    setDraft("");
    // childId(member id)로 아이별 스레드에 귀속 — 다른 아이 화면엔 절대 표시되지 않음.
    sendMemo.mutate(
      { content: text, dateKey: memoDateKey, childId: scopeChild.id },
      {
        onError: () => {
          setDraft((current) => (current.trim() ? current : text));
          show(copy.sendFailed, "⚠️");
        },
      },
    );
  };

  // ── 사진 전송: 파일 선택 → 리사이즈 → R2 업로드(가족 격리 버킷) → [[img:]] 메시지 ──
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [sharing, setSharing] = useState<"" | "image" | "location">("");
  usePwaUpdateCriticalSection(
    draft.trim().length > 0 || savingPhoto || sharing !== "" || sendMemo.isPending,
  );
  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file || !familyId || !scopeChild || !memoDateKey || sharing) return;
    setSharing("image");
    try {
      const dataUrl = await resizeImageFileSafe(file, { maxEdge: 1280, quality: 0.8 });
      if (!dataUrl) {
        show(copy.imageLoadFailed, "⚠️");
        return;
      }
      const imageBlob = dataUrlToBlob(dataUrl);
      const uploaded = await apiUploadChildPhoto({
        familyId,
        purpose: "memo",
        targetMemberId: scopeChild.id,
        fileOrBlob: imageBlob,
        contentType: imageBlob.type || "image/jpeg",
      });
      sendMemo.mutate(
        { content: encodeImageContent(uploaded.path), dateKey: memoDateKey, childId: scopeChild.id },
        { onError: () => show(copy.imageFailed, "⚠️") },
      );
    } catch (error) {
      console.error("사진 전송 실패:", error);
      show(copy.imageFailed, "⚠️");
    } finally {
      setSharing("");
    }
  };

  // ── 위치 공유: 기기 GPS(우선) → 서버에 기록된 내 최신 위치(아이 세션 폴백) → 역지오코딩 ──
  const { data: sharedLocations } = useChildLocations();
  const getCurrentPosition = () =>
    new Promise<{ lat: number; lng: number } | null>((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      let done = false;
      const timer = window.setTimeout(() => {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, 5000);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (done) return;
          done = true;
          window.clearTimeout(timer);
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          if (done) return;
          done = true;
          window.clearTimeout(timer);
          resolve(null);
        },
        { enableHighAccuracy: false, timeout: 4500, maximumAge: 60_000 },
      );
    });
  const reverseAddress = async (lat: number, lng: number): Promise<string> => {
    if (!familyId) return "";
    return reverseRawMapLabel(familyId, { lat, lng }, intl.locale, "memo_share").catch(() => "");
  };
  const shareLocation = async () => {
    if (sharing || sendMemo.isPending || !scopeChild || !memoDateKey) return;
    setSharing("location");
    try {
      // GPS 실패 시(권한 없음 등) 서버에 기록된 내 최신 위치로 폴백(아이 세션은 백그라운드 추적 중).
      let point = await getCurrentPosition();
      if (!point) {
        const mine = (sharedLocations ?? []).find((l) => l.user_id === userId) ?? null;
        if (mine) point = { lat: mine.lat, lng: mine.lng };
      }
      if (!point) {
        show(copy.locationUnavailable, "📍");
        return;
      }
      const address = await reverseAddress(point.lat, point.lng);
      sendMemo.mutate(
        {
          content: encodeLocationContent(point.lat, point.lng, address || intl.formatMessage({ id: "shared.memoChat.copy019" })),
          dateKey: memoDateKey,
          childId: scopeChild.id,
        },
        { onError: () => show(copy.locationFailed, "⚠️") },
      );
    } finally {
      setSharing("");
    }
  };

  // 위치 버블 탭 → 카카오맵에서 그 지점 열기.
  const openLocation = (m: ThreadMsg) => {
    if (!m.location) return;
    const name = encodeURIComponent(m.location.address || intl.formatMessage({ id: "shared.memoChat.copy020" }));
    openExternal(`https://map.kakao.com/link/map/${name},${m.location.lat},${m.location.lng}`).catch(() =>
      show(isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy021" }) : intl.formatMessage({ id: "shared.memoChat.copy022" }), "🗺️"),
    );
  };

  const hasMessages = messages.length > 0;
  const showEmpty = !!scopeChild && !thread.isLoading && !thread.isError && !hasMessages;
  // 실시간 프레즌스 데이터가 없으므로 "온라인" 대신 최근 대화 시각으로 정직하게 표기.
  const statusLabel = hasMessages
    ? intl.formatMessage({ id: "shared.memo.latestActivity" }, { time: messages[messages.length - 1].time })
    : copy.noConversation;

  return (
    <div className="mc-root hy-rise-in" data-child={role === "child" ? "true" : undefined}>
      {/* 헤더 */}
      <header className="mc-header">
        <button
          type="button"
          className="mc-back hy-press"
          aria-label={intl.formatMessage({ id: "shared.memoChat.copy023" })}
          onClick={goBack}
        >
          <ChevronLeft size={24} strokeWidth={2.4} />
        </button>
        <span className="mc-peer-avatar" data-photo={isUploadedAvatar(peer.avatar) ? "true" : "false"}>
          <img src={peer.avatar} alt="" loading="eager" decoding="async" />
        </span>
        <div className="mc-peer-main">
          <div className="mc-peer-name">{peer.name}</div>
          <div className="mc-peer-status">
            <span className="mc-status-dot" />
            {statusLabel}
          </div>
        </div>
        {/* 다자녀 부모: 홈으로 돌아가지 않고 대화할 아이를 바꾼다(고정 헤더 둘째 줄 · 같은 전역 선택). */}
        {!isChildSession && (
          <ChildSwitcher
            className="mc-kidswitch"
            selectedId={scopeChild?.id ?? null}
            unreadIds={unreadChildIds}
            onChange={() => {
              if (!childHint) return;
              const next = new URLSearchParams(searchParams);
              next.delete("child");
              setSearchParams(next, { replace: true });
            }}
          />
        )}
      </header>

      {/* 대화 스레드 */}
      <div className="mc-thread">
        {blockedMembers.length > 0 && (
          <div className="mc-blocked-banner" role="status">
            <ShieldAlert size={18} strokeWidth={2.2} aria-hidden="true" />
            <div>
              <strong>{isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy024" }) : intl.formatMessage({ id: "shared.memoChat.copy025" })}</strong>
              <div className="mc-blocked-list">
                {blockedMembers.map(({ id, member }) => (
                  <button
                    key={id}
                    type="button"
                    className="mc-unblock hy-press"
                    disabled={unblockMemoUser.isPending} aria-busy={unblockMemoUser.isPending}
                    onClick={() => {
                      void unblockMemoUser.mutateAsync(id)
                        .then(() => show(intl.formatMessage(
                          { id: isChildSession ? "shared.memo.unblocked.child" : "shared.memo.unblocked.formal" },
                          { name: member?.name ?? intl.formatMessage({ id: isChildSession ? "shared.memoChat.copy026" : "shared.memoChat.copy027" }) },
                        ), "🛡️"))
                        .catch(() => show(isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy028" }) : intl.formatMessage({ id: "shared.memoChat.copy029" }), "⚠️"));
                    }}
                  >
                    {member?.name ?? intl.formatMessage({ id: "shared.memoChat.copy030" })} {intl.formatMessage({ id: "shared.memoChat.copy031" })}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {thread.isLoading && (
          <div className="mc-daysep">
            <Loading label={copy.loading} compact />
          </div>
        )}
        {familyLoading && (
          <div className="mc-daysep">
            <Loading label={copy.loading} compact />
          </div>
        )}
        {familyError && (
          <div className="mc-daysep mc-daysep--error" role="alert">
            <span>{copy.loadError}</span>
            <button type="button" className="hy-section-action hy-press" onClick={() => void refetchFamily()}>
              {isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy032" }) : intl.formatMessage({ id: "shared.memoChat.copy033" })}
            </button>
          </div>
        )}
        {explicitChildMissing && (
          <div className="mc-daysep">
            <span>{intl.formatMessage({ id: "shared.memoChat.copy034" })}</span>
            <button type="button" className="hy-section-action hy-press" onClick={goBack}>
              {intl.formatMessage({ id: "core.action.back" })}
            </button>
          </div>
        )}
        {thread.isError && (
          <div className="mc-daysep mc-daysep--error">
            <span>{copy.loadError}</span>
            <button type="button" className="hy-section-action hy-press" onClick={() => void thread.refetch()}>
              {isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy035" }) : intl.formatMessage({ id: "shared.memoChat.copy036" })}
            </button>
          </div>
        )}
        {showEmpty && (
          <div className="mc-daysep">
            <span>{copy.empty}</span>
          </div>
        )}

        {/* 신고 진입점 안내 — 메시지마다 버튼을 띄우는 대신 길게 누르기로 옮겼으므로
            찾는 방법을 대화 맨 위에 한 줄로 알린다(스크롤하면 자연스럽게 지나간다). */}
        {messages.length > 0 && (
          <p className="mc-safety-hint">
            <ShieldAlert size={12} strokeWidth={2.2} aria-hidden="true" />
            {isChildSession
              ? intl.formatMessage({ id: "shared.memoChat.copy037" })
              : intl.formatMessage({ id: "shared.memoChat.copy038" })}
          </p>
        )}

        {messages.map((m, i) => {
          // 상대 메시지는 실제 발신자 아바타로 귀속. 발신자가 헤더 상대와 다르면(공동부모 등)
          // 이름 라벨로 명시(1:1 스레드에서 제3자 발화 오독 방지).
          const sender = !m.mine && m.senderUserId ? memberByUserId.get(m.senderUserId) : null;
          const senderDiffers = !!sender && !!m.senderUserId && m.senderUserId !== peer.userId;
          const newDay = !!m.dayStamp && m.dayStamp !== messages[i - 1]?.dayStamp;
          // 상대 메시지는 길게 눌러 신고를 연다. JSX spread 는 디자인 시스템 정적 분석이
          // 해석하지 못하므로 핸들러를 하나씩 연결한다.
          const imagePress = bindSafetyPress(m);
          const locationPress = bindSafetyPress(m, () => openLocation(m));
          const textPress = bindSafetyPress(m);
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="mc-daysep">
                  <span>{formatMemoDayLabel(m.dayStamp, new Date(), locale, familyTimeZone, intl)}</span>
                </div>
              )}
              <div className={`mc-msg ${m.mine ? "mc-msg--mine" : "mc-msg--peer"}`}>
              {m.showMeta && (
                <span
                  className="mc-msg-avatar"
                  data-photo={isUploadedAvatar(sender?.avatar ?? peer.avatar) ? "true" : "false"}
                >
                  <img src={sender?.avatar ?? peer.avatar} alt="" loading="lazy" decoding="async" />
                </span>
              )}
              <div className="mc-bubble-wrap">
                {m.showMeta && senderDiffers && <div className="mc-sender">{sender.name}</div>}
                {m.kind === "image" && m.imagePath ? (
                  <MemoImageBubble
                    path={m.imagePath}
                    press={imagePress}
                    isChildSession={isChildSession}
                    onOpen={() => setPreviewImagePath(m.imagePath ?? null)}
                  />
                ) : m.kind === "location" && m.location ? (
                  <button
                    type="button"
                    className={`mc-bubble mc-bubble--${m.mine ? "mine" : "peer"} mc-bubble--loc hy-press`}
                    onClick={locationPress.onClick}
                    onPointerDown={locationPress.onPointerDown}
                    onPointerMove={locationPress.onPointerMove}
                    onPointerUp={locationPress.onPointerUp}
                    onPointerCancel={locationPress.onPointerCancel}
                    onPointerLeave={locationPress.onPointerLeave}
                    onContextMenu={locationPress.onContextMenu}
                  >
                    <span className="mc-loc-ic"><MapPin size={22} strokeWidth={2.2} /></span>
                    <span className="mc-loc-main">
                      <span className="mc-loc-title">{intl.formatMessage({ id: "shared.memoChat.copy039" })}</span>
                      <span className="mc-loc-addr">{m.location.address || intl.formatMessage({ id: "shared.memoChat.copy040" })}</span>
                    </span>
                  </button>
                ) : (
                  <div
                    className={`mc-bubble mc-bubble--${m.mine ? "mine" : "peer"}`}
                    onPointerDown={textPress.onPointerDown}
                    onPointerMove={textPress.onPointerMove}
                    onPointerUp={textPress.onPointerUp}
                    onPointerCancel={textPress.onPointerCancel}
                    onPointerLeave={textPress.onPointerLeave}
                    onContextMenu={textPress.onContextMenu}
                  >
                    {m.text}
                  </div>
                )}
                <div className="mc-time">{m.time}</div>
                {m.mine && readByPeer.has(m.id) && <div className="mc-read">{intl.formatMessage({ id: "shared.memoChat.copy041" })}</div>}

              </div>
              </div>
            </Fragment>
          );
        })}
        <div ref={endRef} className="mc-end" aria-hidden="true" />
      </div>

      {/* 하단 입력 (composer) */}
      <div className="mc-composer">
        <div className="mc-quick-group">
          <div className="mc-quick-title">{intl.formatMessage({ id: "shared.memo.quick.title" })}</div>
          <div className="mc-quick">
            {quickReplies.map((q) => (
              <button
                key={q}
                type="button"
                className="mc-quick-btn hy-press"
                onClick={() => setDraft(q)}
                disabled={!scopeChild}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
        <div className="mc-inputbar">
          {/* 사진·위치 공유: R2 업로드와 위치 공유를 사용자 액션에서만 실행한다. */}
          <button
            type="button"
            className="mc-attach hy-press"
            aria-label={intl.formatMessage({ id: "shared.memoChat.copy042" })}
            onClick={() => fileRef.current?.click()}
            disabled={sharing !== "" || !scopeChild}
          >
            <ImageIcon size={20} strokeWidth={2} aria-hidden="true" />
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onPickImage(e)} />
          <button
            type="button"
            className="mc-attach hy-press"
            aria-label={intl.formatMessage({ id: "shared.memoChat.copy043" })}
            onClick={() => void shareLocation()}
            disabled={sharing !== "" || !scopeChild}
          >
            <MapPin size={20} strokeWidth={2} aria-hidden="true" />
          </button>
          <input
            className="mc-input"
            aria-label={copy.inputPlaceholder}
            placeholder={copy.inputPlaceholder}
            value={draft}
            disabled={!scopeChild}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 한글 조합 중(IME) Enter 는 글자 확정용이므로 전송하지 않는다.
              if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSend();
            }}
          />
          <button
            type="button"
            className={`mc-send hy-busy-center hy-press${sendMemo.isPending ? " mc-send--sending" : ""}`}
            aria-label={sendMemo.isPending ? intl.formatMessage({ id: "shared.memoChat.copy044" }) : intl.formatMessage({ id: "shared.memoChat.copy045" })}
            onClick={handleSend}
            disabled={sendMemo.isPending || !scopeChild} aria-busy={sendMemo.isPending}
          >
            <Send size={20} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {previewImagePath && (
        <div
          ref={previewDialogRef}
          className="mc-photo-preview"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mc-photo-preview-title"
          aria-describedby="mc-photo-preview-description"
          onClick={(event) => {
            if (event.currentTarget === event.target) setPreviewImagePath(null);
          }}
        >
          <div className="mc-photo-preview__panel">
            <div className="mc-photo-preview__header">
              <h2 id="mc-photo-preview-title">{intl.formatMessage({ id: "shared.memoChat.copy046" })}</h2>
              <div className="mc-photo-preview__actions">
                <button
                  type="button"
                  className="mc-photo-preview__save hy-press"
                  onClick={() => void savePreviewPhoto()}
                  disabled={savingPhoto || !previewImageUrl}
                  aria-busy={savingPhoto}
                >
                  <Download size={16} strokeWidth={2.2} aria-hidden="true" />
                  {savingPhoto ? intl.formatMessage({ id: "shared.memoChat.copy047" }) : intl.formatMessage({ id: "shared.memoChat.copy048" })}
                </button>
                <button
                  ref={previewCloseButtonRef}
                  type="button"
                  className="mc-photo-preview__close hy-press"
                  onClick={() => setPreviewImagePath(null)}
                >
                  {intl.formatMessage({ id: "shared.memoChat.copy049" })}
                </button>
              </div>
            </div>
            <p id="mc-photo-preview-description" className="mc-photo-preview__description">
              {isChildSession
                ? intl.formatMessage({ id: "shared.memoChat.copy050" })
                : intl.formatMessage({ id: "shared.memoChat.copy051" })}
            </p>
            {/* 손가락 두 개로 확대·축소, 두 번 탭으로 확대 토글, 확대 상태에서 끌어 이동. */}
            <div
              ref={photoZoom.containerRef}
              className="mc-photo-preview__stage"
              data-ready={previewGestureReady ? "true" : undefined}
              onPointerDown={previewGestureReady ? photoZoom.handlers.onPointerDown : undefined}
              onPointerMove={previewGestureReady ? photoZoom.handlers.onPointerMove : undefined}
              onPointerUp={previewGestureReady ? photoZoom.handlers.onPointerUp : undefined}
              onPointerCancel={previewGestureReady ? photoZoom.handlers.onPointerCancel : undefined}
            >
              {previewImage.status === "ready" ? (
                <img
                  src={previewImage.url}
                  alt={intl.formatMessage({ id: "shared.memoChat.copy052" })}
                  decoding="async"
                  draggable={false}
                  onLoad={(event) => verifyPrivateImageDecode(
                    event.currentTarget,
                    () => previewImage.markError(previewImage.url),
                  )}
                  onError={() => previewImage.markError(previewImage.url)}
                  style={{
                    transform: `translate(${photoZoom.transform.x}px, ${photoZoom.transform.y}px) scale(${photoZoom.transform.scale})`,
                  }}
                />
              ) : previewImage.status === "error" ? (
                <div className="mc-photo-preview__status" role="alert">
                  <span>{isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy053" }) : intl.formatMessage({ id: "shared.memoChat.copy054" })}</span>
                  <button type="button" className="hy-section-action hy-press" onClick={previewImage.retry}>
                    {isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy055" }) : intl.formatMessage({ id: "shared.memoChat.copy056" })}
                  </button>
                </div>
              ) : (
                <div className="mc-photo-preview__status" role="status">
                  <Loading label={isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy057" }) : intl.formatMessage({ id: "shared.memoChat.copy058" })} compact />
                </div>
              )}
            </div>
            {previewImage.status === "ready" && <p className="mc-photo-preview__hint">
              {photoZoom.isZoomed
                ? (isChildSession
                    ? intl.formatMessage({ id: "shared.memoChat.copy059" })
                    : intl.formatMessage({ id: "shared.memoChat.copy060" }))
                : (isChildSession
                    ? intl.formatMessage({ id: "shared.memoChat.copy061" })
                    : intl.formatMessage({ id: "shared.memoChat.copy062" }))}
            </p>}
          </div>
        </div>
      )}

      <MessageSafetyDialog
        open={!!safetyTarget}
        tone={isChildSession ? "child" : "parent"}
        title={isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy063" }) : intl.formatMessage({ id: "shared.memoChat.copy064" })}
        description={isChildSession
          ? intl.formatMessage({ id: "shared.memoChat.copy065" })
          : intl.formatMessage({ id: "shared.memoChat.copy066" })}
        reasons={(isChildSession ? CHILD_MEMO_REPORT_REASONS : MEMO_REPORT_REASONS).map(({ value, labelId }): ReportReasonOption<MemoContentReportReason> => ({
          value,
          label: intl.formatMessage({ id: labelId }),
        }))}
        onClose={() => setSafetyTarget(null)}
        onReport={async (reason, detail) => {
          if (!safetyTarget?.id) throw new Error("report_target_missing");
          await reportMemoReply.mutateAsync({ replyId: safetyTarget.id, reason, detail });
          show(
            isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy067" }) : intl.formatMessage({ id: "shared.memoChat.copy068" }),
            "🛡️",
          );
        }}
        blockLabel={safetyTarget?.senderUserId && !blockedUserIds.has(safetyTarget.senderUserId)
          ? intl.formatMessage(
              { id: isChildSession ? "shared.memo.blockTitle.child" : "shared.memo.blockTitle.formal" },
              { name: safetySender?.name ?? intl.formatMessage({ id: isChildSession ? "shared.memoChat.copy069" : "shared.memoChat.copy070" }) },
            )
          : undefined}
        blockDescription={isChildSession
          ? intl.formatMessage({ id: "shared.memoChat.copy071" })
          : intl.formatMessage({ id: "shared.memoChat.copy072" })}
        onBlock={safetyTarget?.senderUserId && !blockedUserIds.has(safetyTarget.senderUserId)
          ? async () => {
              const targetUserId = safetyTarget.senderUserId;
              if (!targetUserId) throw new Error("block_target_missing");
              await blockMemoUser.mutateAsync(targetUserId);
              show(
                isChildSession ? intl.formatMessage({ id: "shared.memoChat.copy073" }) : intl.formatMessage({ id: "shared.memoChat.copy074" }),
                "🛡️",
              );
            }
          : undefined}
      />
    </div>
  );
}
