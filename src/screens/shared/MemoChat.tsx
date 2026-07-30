import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, Send, Image as ImageIcon, MapPin, ShieldAlert, Download } from "lucide-react";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { useSafeBack } from "@/app/useSafeBack";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { useMyFamily } from "@/queries/useFamily";
import { useMemoThread, useSendMemo, useMarkRead } from "@/queries/useMemo";
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
import { apiUploadChildPhoto, childPhotoProxyUrl } from "@/lib/api/client";
import { resizeImageFileSafe, dataUrlToBlob } from "@/lib/imageResize";
import { loadKakaoMaps } from "@/lib/kakaoMap";
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
import "./MemoChat.css";

const MEMO_REPORT_REASONS: readonly ReportReasonOption<MemoContentReportReason>[] = [
  { value: "harassment", label: "괴롭히거나 불편하게 해요" },
  { value: "sexual_or_violent", label: "성적이거나 폭력적인 내용이에요" },
  { value: "personal_info", label: "개인정보를 요구하거나 노출해요" },
  { value: "illegal_or_dangerous", label: "불법이거나 위험한 내용이에요" },
  { value: "other", label: "다른 이유가 있어요" },
];

const CHILD_MEMO_REPORT_REASONS: readonly ReportReasonOption<MemoContentReportReason>[] = [
  { value: "harassment", label: "괴롭히거나 불편하게 해" },
  { value: "sexual_or_violent", label: "성적이거나 폭력적인 내용이야" },
  { value: "personal_info", label: "개인정보를 요구하거나 보여줘" },
  { value: "illegal_or_dangerous", label: "불법이거나 위험한 내용이야" },
  { value: "other", label: "다른 이유가 있어" },
];

/** photo_url(원격 http)은 그대로, 로컬 캐릭터 키는 asset()으로 해석. */
function avatarSrc(path: string): string {
  return path.startsWith("http") ? path : asset(path);
}


export function MemoChat() {
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
  const { activeChild } = useActiveChild();
  const [searchParams] = useSearchParams();
  const childHint = searchParams.get("child")?.trim() || null;

  // 대화 스코프 아이(member id) — 아이별 1:1 스레드(TK 결정: 대화도 각각).
  // 부모/선생님 = 전역 활성 아이(홈 스위치), 아이 = 자기 자신. 메시지 fetch·send 모두 이 스코프.
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
  const dateKeys = useRecentDateKeys(7);
  const thread = useMemoThread(dateKeys, scopeChild?.id ?? null);
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
      const fallback = m.role === "parent" ? "family/mom.webp" : childAvatarPath(m.photo_url);
      map.set(m.user_id, {
        name: m.name || (m.role === "parent" ? "보호자" : "아이"),
        avatar: avatarSrc(m.role === "parent" ? (m.photo_url || fallback) : fallback),
        role: m.role,
      });
    }
    return map;
  }, [family]);

  // 1:1 헤더 상대(peer). 아이가 보면 부모, 부모가 보면 스코프 아이(전역 활성 아이).
  const peer = useMemo(() => {
    const members = family?.members ?? [];
    if (role === "child") {
      const parent = members.find((m) => m.role === "parent") ?? null;
      return {
        userId: parent?.user_id ?? null,
        name: parent?.name || "엄마·아빠",
        avatar: avatarSrc(parent?.photo_url || "animal/bear.webp"),
      };
    }
    return {
      userId: scopeChild?.user_id ?? null,
      name: scopeChild?.name || "우리 아이",
      avatar: avatarSrc(childAvatarPath(scopeChild?.photo_url)),
    };
  }, [family, role, scopeChild]);

  const replies = useMemo(() => thread.data ?? [], [thread.data]);
  // 빈 content(빈 문자열/공백뿐)는 빈 흰 말풍선이 되므로 스레드에서 제외한다.
  const messages = useMemo(
    () => mapRepliesToThread(replies, userId).filter((m) => m.text.trim().length > 0),
    [replies, userId],
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
  const [savingPhoto, setSavingPhoto] = useState(false);
  const previewDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: previewImagePath !== null,
    onClose: () => setPreviewImagePath(null),
  });
  const photoZoom = usePinchZoom();
  // 사진을 닫을 때 확대 상태를 초기화한다(다음 사진에 이전 배율이 남지 않게).
  // reset 은 안정적인 참조라 previewImagePath 가 바뀔 때만 실행된다.
  const resetPhotoZoom = photoZoom.reset;
  useEffect(() => {
    if (previewImagePath === null) resetPhotoZoom();
  }, [previewImagePath, resetPhotoZoom]);

  const savePreviewPhoto = useCallback(async () => {
    const url = childPhotoProxyUrl(previewImagePath);
    if (!url || savingPhoto) return;
    setSavingPhoto(true);
    try {
      const result = await saveImageToDevice(url);
      if (result.ok) {
        show(result.target === "gallery" ? "사진첩에 저장했어요." : "사진을 내려받았어요.");
      } else if (result.reason === "permission_denied") {
        show("저장하려면 기기 설정에서 저장 권한을 허용해 주세요.");
      } else if (result.reason === "unsupported") {
        show("이 기기에서는 저장을 지원하지 않아요.");
      } else {
        show("사진을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setSavingPhoto(false);
    }
  }, [previewImagePath, savingPhoto, show]);
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
  const quickReplies = useMemo(() => resolveMemoQuickReplies(role), [role]);
  const copy = useMemo(() => resolveMemoChatCopy(role), [role]);
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
      show("대화 대상 아이를 확인할 수 없어요", "⚠️");
      return;
    }
    const text = draft.trim();
    if (!text) {
      show(copy.emptyDraft, "✏️");
      return;
    }
    if (sendMemo.isPending) return;
    // childId(member id)로 아이별 스레드에 귀속 — 다른 아이 화면엔 절대 표시되지 않음.
    sendMemo.mutate(
      { content: text, childId: scopeChild.id },
      {
        onSuccess: () => setDraft(""),
        onError: () => show(copy.sendFailed, "⚠️"),
      },
    );
  };

  // ── 사진 전송: 파일 선택 → 리사이즈 → R2 업로드(가족 격리 버킷) → [[img:]] 메시지 ──
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [sharing, setSharing] = useState<"" | "image" | "location">("");
  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file || !familyId || !scopeChild || sharing) return;
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
        { content: encodeImageContent(uploaded.path), childId: scopeChild.id },
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
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const maps: any = await loadKakaoMaps();
      if (!maps?.services) return "";
      return await new Promise<string>((resolve) => {
        const geocoder = new maps.services.Geocoder();
        geocoder.coord2Address(
          lng,
          lat,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (results: any[], status: string) => {
            if (status !== "OK" || !results[0]) {
              resolve("");
              return;
            }
            resolve(
              results[0].road_address?.address_name || results[0].address?.address_name || "",
            );
          },
        );
      });
    } catch {
      return "";
    }
  };
  const shareLocation = async () => {
    if (sharing || sendMemo.isPending || !scopeChild) return;
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
        { content: encodeLocationContent(point.lat, point.lng, address || "내 위치"), childId: scopeChild.id },
        { onError: () => show(copy.locationFailed, "⚠️") },
      );
    } finally {
      setSharing("");
    }
  };

  // 위치 버블 탭 → 카카오맵에서 그 지점 열기.
  const openLocation = (m: ThreadMsg) => {
    if (!m.location) return;
    const name = encodeURIComponent(m.location.address || "공유한 위치");
    openExternal(`https://map.kakao.com/link/map/${name},${m.location.lat},${m.location.lng}`).catch(() =>
      show(isChildSession ? "지도를 열 수 없어" : "지도를 열 수 없어요", "🗺️"),
    );
  };

  const hasMessages = messages.length > 0;
  const showEmpty = !!scopeChild && !thread.isLoading && !thread.isError && !hasMessages;
  // 실시간 프레즌스 데이터가 없으므로 "온라인" 대신 최근 대화 시각으로 정직하게 표기.
  const statusLabel = hasMessages
    ? `최근 대화 · ${messages[messages.length - 1].time}`
    : copy.noConversation;

  return (
    <div className="mc-root hy-rise-in" data-child={role === "child" ? "true" : undefined}>
      {/* 헤더 */}
      <header className="mc-header">
        <button
          type="button"
          className="mc-back hy-press"
          aria-label="뒤로"
          onClick={goBack}
        >
          <ChevronLeft size={24} strokeWidth={2.4} />
        </button>
        <span className="mc-peer-avatar">
          <img src={peer.avatar} alt="" loading="eager" decoding="async" />
        </span>
        <div className="mc-peer-main">
          <div className="mc-peer-name">{peer.name}</div>
          <div className="mc-peer-status">
            <span className="mc-status-dot" />
            {statusLabel}
          </div>
        </div>
      </header>

      {/* 대화 스레드 */}
      <div className="mc-thread">
        {blockedMembers.length > 0 && (
          <div className="mc-blocked-banner" role="status">
            <ShieldAlert size={18} strokeWidth={2.2} aria-hidden="true" />
            <div>
              <strong>{isChildSession ? "차단한 메시지는 숨겼어" : "차단한 사용자의 메시지를 숨겼어요"}</strong>
              <div className="mc-blocked-list">
                {blockedMembers.map(({ id, member }) => (
                  <button
                    key={id}
                    type="button"
                    className="mc-unblock hy-press"
                    disabled={unblockMemoUser.isPending} aria-busy={unblockMemoUser.isPending}
                    onClick={() => {
                      void unblockMemoUser.mutateAsync(id)
                        .then(() => show(isChildSession ? `${member?.name ?? "상대"} 메시지를 다시 볼 수 있어.` : `${member?.name ?? "상대"}님의 차단을 해제했어요.`, "🛡️"))
                        .catch(() => show(isChildSession ? "차단을 풀지 못했어. 다시 눌러줘." : "차단을 해제하지 못했어요.", "⚠️"));
                    }}
                  >
                    {member?.name ?? "보호자"} · 차단 해제
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {thread.isLoading && (
          <div className="mc-daysep">
            <Loading label={copy.loading} size={6} />
          </div>
        )}
        {familyLoading && (
          <div className="mc-daysep">
            <Loading label={copy.loading} size={6} />
          </div>
        )}
        {familyError && (
          <div className="mc-daysep mc-daysep--error" role="alert">
            <span>{copy.loadError}</span>
            <button type="button" className="hy-section-action hy-press" onClick={() => void refetchFamily()}>
              {isChildSession ? "다시 불러오기" : "다시 시도"}
            </button>
          </div>
        )}
        {explicitChildMissing && (
          <div className="mc-daysep">
            <span>알림이 가리킨 아이 대화를 찾을 수 없어요</span>
          </div>
        )}
        {thread.isError && (
          <div className="mc-daysep mc-daysep--error">
            <span>{copy.loadError}</span>
            <button type="button" className="hy-section-action hy-press" onClick={() => void thread.refetch()}>
              {isChildSession ? "다시 불러오기" : "다시 시도"}
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
              ? "받은 메시지를 길게 누르면 신고·차단할 수 있어."
              : "받은 메시지를 길게 누르면 신고·차단할 수 있어요."}
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
          const imagePress = bindSafetyPress(m, () => {
            if (m.imagePath) setPreviewImagePath(m.imagePath);
          });
          const locationPress = bindSafetyPress(m, () => openLocation(m));
          const textPress = bindSafetyPress(m);
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="mc-daysep">
                  <span>{formatMemoDayLabel(m.dayStamp)}</span>
                </div>
              )}
              <div className={`mc-msg ${m.mine ? "mc-msg--mine" : "mc-msg--peer"}`}>
              {m.showMeta && (
                <span className="mc-msg-avatar">
                  <img src={sender?.avatar ?? peer.avatar} alt="" loading="lazy" decoding="async" />
                </span>
              )}
              <div className="mc-bubble-wrap">
                {m.showMeta && senderDiffers && <div className="mc-sender">{sender.name}</div>}
                {m.kind === "image" && m.imagePath ? (
                  <button
                    type="button"
                    className="mc-bubble mc-bubble--img hy-press"
                    onClick={imagePress.onClick}
                    onPointerDown={imagePress.onPointerDown}
                    onPointerMove={imagePress.onPointerMove}
                    onPointerUp={imagePress.onPointerUp}
                    onPointerCancel={imagePress.onPointerCancel}
                    onPointerLeave={imagePress.onPointerLeave}
                    onContextMenu={imagePress.onContextMenu}
                  >
                    <img
                      src={childPhotoProxyUrl(m.imagePath) ?? undefined}
                      alt="공유한 사진"
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
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
                      <span className="mc-loc-title">위치 공유</span>
                      <span className="mc-loc-addr">{m.location.address || "지도에서 보기"}</span>
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
                {m.mine && readByPeer.has(m.id) && <div className="mc-read">읽음</div>}

              </div>
              </div>
            </Fragment>
          );
        })}
        <div ref={endRef} className="mc-end" aria-hidden="true" />
      </div>

      {/* 하단 입력 (composer) */}
      <div className="mc-composer">
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
        <div className="mc-inputbar">
          {/* 사진·위치 공유: R2 업로드와 위치 공유를 사용자 액션에서만 실행한다. */}
          <button
            type="button"
            className="mc-attach hy-press"
            aria-label="사진 보내기"
            onClick={() => fileRef.current?.click()}
            disabled={sharing !== "" || !scopeChild}
          >
            <ImageIcon size={19} strokeWidth={2} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onPickImage(e)} />
          <button
            type="button"
            className="mc-attach hy-press"
            aria-label="위치 보내기"
            onClick={() => void shareLocation()}
            disabled={sharing !== "" || !scopeChild}
          >
            <MapPin size={19} strokeWidth={2} />
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
            className={`mc-send hy-press${sendMemo.isPending ? " mc-send--sending" : ""}`}
            aria-label={sendMemo.isPending ? "보내는 중" : "보내기"}
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
          onClick={(event) => {
            if (event.currentTarget === event.target) setPreviewImagePath(null);
          }}
        >
          <div className="mc-photo-preview__panel">
            <div className="mc-photo-preview__header">
              <h2 id="mc-photo-preview-title">공유한 사진</h2>
              <div className="mc-photo-preview__actions">
                <button
                  type="button"
                  className="mc-photo-preview__save hy-press"
                  onClick={() => void savePreviewPhoto()}
                  disabled={savingPhoto}
                >
                  <Download size={16} strokeWidth={2.2} aria-hidden="true" />
                  {savingPhoto ? "저장 중" : "저장"}
                </button>
                <button
                  type="button"
                  className="mc-photo-preview__close hy-press"
                  onClick={() => setPreviewImagePath(null)}
                  autoFocus
                >
                  닫기
                </button>
              </div>
            </div>
            {/* 손가락 두 개로 확대·축소, 두 번 탭으로 확대 토글, 확대 상태에서 끌어 이동. */}
            <div
              ref={photoZoom.containerRef}
              className="mc-photo-preview__stage"
              onPointerDown={photoZoom.handlers.onPointerDown}
              onPointerMove={photoZoom.handlers.onPointerMove}
              onPointerUp={photoZoom.handlers.onPointerUp}
              onPointerCancel={photoZoom.handlers.onPointerCancel}
            >
              <img
                src={childPhotoProxyUrl(previewImagePath) ?? undefined}
                alt="공유한 사진 크게 보기"
                loading="lazy"
                decoding="async"
                draggable={false}
                style={{
                  transform: `translate(${photoZoom.transform.x}px, ${photoZoom.transform.y}px) scale(${photoZoom.transform.scale})`,
                }}
              />
            </div>
            <p className="mc-photo-preview__hint">
              {photoZoom.isZoomed ? "끌어서 옮기고, 두 번 탭하면 원래 크기로 돌아가요" : "두 손가락으로 벌리거나 두 번 탭하면 확대돼요"}
            </p>
          </div>
        </div>
      )}

      <MessageSafetyDialog
        open={!!safetyTarget}
        tone={isChildSession ? "child" : "parent"}
        title={isChildSession ? "이 메시지가 불편했어?" : "메시지 신고 및 차단"}
        description={isChildSession
          ? "신고하면 운영자가 확인해. 부모님께 자동으로 전달되지는 않아."
          : "신고 내용은 운영 검토 큐에 안전하게 저장돼요."}
        reasons={isChildSession ? CHILD_MEMO_REPORT_REASONS : MEMO_REPORT_REASONS}
        onClose={() => setSafetyTarget(null)}
        onReport={async (reason, detail) => {
          if (!safetyTarget?.id) throw new Error("report_target_missing");
          await reportMemoReply.mutateAsync({ replyId: safetyTarget.id, reason, detail });
          show(
            isChildSession ? "알려줘서 고마워. 운영자가 확인할게." : "신고를 접수했어요. 운영자가 확인할게요.",
            "🛡️",
          );
        }}
        blockLabel={safetyTarget?.senderUserId && !blockedUserIds.has(safetyTarget.senderUserId)
          ? (isChildSession ? `${safetySender?.name ?? "이 사람"} 메시지 차단` : `${safetySender?.name ?? "이 사용자"}님의 메시지 차단`)
          : undefined}
        blockDescription={isChildSession
          ? "메시지만 서로 안 보여. SOS와 안전 알림은 그대로 받아."
          : "가족 연결·위치·SOS·안전 알림은 유지되고 메모만 서로 보이지 않아요."}
        onBlock={safetyTarget?.senderUserId && !blockedUserIds.has(safetyTarget.senderUserId)
          ? async () => {
              const targetUserId = safetyTarget.senderUserId;
              if (!targetUserId) throw new Error("block_target_missing");
              await blockMemoUser.mutateAsync(targetUserId);
              show(
                isChildSession ? "이 사람 메시지를 차단했어. 안전 알림은 계속 와." : "메시지를 차단했어요. 안전 알림은 계속 전달돼요.",
                "🛡️",
              );
            }
          : undefined}
      />
    </div>
  );
}
