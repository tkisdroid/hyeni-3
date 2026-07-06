import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Send, Image as ImageIcon, MapPin } from "lucide-react";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { useMyFamily } from "@/queries/useFamily";
import { useMemoThread, useSendMemo, useMarkRead } from "@/queries/useMemo";
import { useChildLocations } from "@/queries/useLocation";
import {
  mapRepliesToThread,
  encodeImageContent,
  encodeLocationContent,
  type ThreadMsg,
} from "@/transform/memoView";
import { todayDateKey } from "@/transform/dateKey";
import { apiUploadChildPhoto, childPhotoProxyUrl } from "@/lib/api/client";
import { resizeImageFileSafe, dataUrlToBlob } from "@/lib/imageResize";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { openExternal } from "@/lib/native/browser";
import "./MemoChat.css";

/** photo_url(원격 http)은 그대로, 로컬 캐릭터 키는 asset()으로 해석. */
function avatarSrc(path: string): string {
  return path.startsWith("http") ? path : asset(path);
}

/** 입력창을 채우는 빠른 답장(자동 전송 금지 — 사용자가 보내기를 눌러야 전송). */
const QUICK_REPLIES = ["지금 어디야?", "숙제는 했어?", "몇 시에 끝나?", "조심히 와 💛", "간식 챙겼어?"];

export function MemoChat() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { userId, role, familyId } = useAuth();
  const { data: family } = useMyFamily();
  const { activeChild } = useActiveChild();

  // 대화 스코프 아이(member id) — 아이별 1:1 스레드(TK 결정: 대화도 각각).
  // 부모/선생님 = 전역 활성 아이(홈 스위치), 아이 = 자기 자신. 메시지 fetch·send 모두 이 스코프.
  const scopeChild = useMemo(() => {
    const members = family?.members ?? [];
    if (role === "child") return members.find((m) => m.user_id === userId) ?? null;
    return activeChild;
  }, [family, role, userId, activeChild]);

  // 오늘 하루의 date_key 스레드(단일 날짜 → "오늘" 구분선과 일치) — 스코프 아이 한정.
  const dateKeys = useMemo(() => [todayDateKey()], []);
  const thread = useMemoThread(dateKeys, scopeChild?.id ?? null);
  const sendMemo = useSendMemo();
  const markRead = useMarkRead();
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
  const endRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  // 오늘 요일(시안의 "오늘 · 목요일" 고정값을 실제 요일로 대체).
  const dayLabel = useMemo(() => {
    const weekday = new Date().toLocaleDateString("ko-KR", { weekday: "long" });
    return `오늘 · ${weekday}`;
  }, []);
  const lastMessageId = messages[messages.length - 1]?.id ?? "";

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
      markedRef.current.add(r.id);
      markReadRef.current.mutate(r.id);
    }
  }, [replies, userId]);

  useEffect(() => {
    scrollThreadToBottom(mounted.current ? "smooth" : "auto");
    mounted.current = true;
  }, [lastMessageId, messages.length]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) {
      show("메시지를 입력해 주세요", "✏️");
      return;
    }
    if (sendMemo.isPending) return;
    // childId(member id)로 아이별 스레드에 귀속 — 다른 아이 화면엔 절대 표시되지 않음.
    sendMemo.mutate(
      { content: text, childId: scopeChild?.id ?? null },
      {
        onSuccess: () => setDraft(""),
        onError: () => show("메시지 전송에 실패했어요", "⚠️"),
      },
    );
  };

  // ── 사진 전송: 파일 선택 → 리사이즈 → R2 업로드(가족 격리 버킷) → [[img:]] 메시지 ──
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [sharing, setSharing] = useState<"" | "image" | "location">("");
  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file || !familyId || sharing) return;
    setSharing("image");
    try {
      const dataUrl = await resizeImageFileSafe(file, { maxEdge: 1280, quality: 0.8 });
      if (!dataUrl) {
        show("사진을 불러오지 못했어요", "⚠️");
        return;
      }
      const path = `${familyId}/memo-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
      await apiUploadChildPhoto(path, dataUrlToBlob(dataUrl), "image/jpeg");
      sendMemo.mutate(
        { content: encodeImageContent(path), childId: scopeChild?.id ?? null },
        { onError: () => show("사진 전송에 실패했어요", "⚠️") },
      );
    } catch (error) {
      console.error("사진 전송 실패:", error);
      show("사진 전송에 실패했어요", "⚠️");
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
    if (sharing || sendMemo.isPending) return;
    setSharing("location");
    try {
      // GPS 실패 시(권한 없음 등) 서버에 기록된 내 최신 위치로 폴백(아이 세션은 백그라운드 추적 중).
      let point = await getCurrentPosition();
      if (!point) {
        const mine = (sharedLocations ?? []).find((l) => l.user_id === userId) ?? null;
        if (mine) point = { lat: mine.lat, lng: mine.lng };
      }
      if (!point) {
        show(role === "child" ? "지금 위치를 못 찾았어. 잠시 후 다시 해줘" : "현재 위치를 확인하지 못했어요", "📍");
        return;
      }
      const address = await reverseAddress(point.lat, point.lng);
      sendMemo.mutate(
        { content: encodeLocationContent(point.lat, point.lng, address || "내 위치"), childId: scopeChild?.id ?? null },
        { onError: () => show("위치 전송에 실패했어요", "⚠️") },
      );
    } finally {
      setSharing("");
    }
  };

  // 위치 버블 탭 → 카카오맵에서 그 지점 열기.
  const openLocation = (m: ThreadMsg) => {
    if (!m.location) return;
    const name = encodeURIComponent(m.location.address || "공유한 위치");
    void openExternal(`https://map.kakao.com/link/map/${name},${m.location.lat},${m.location.lng}`);
  };

  const hasMessages = messages.length > 0;
  const showEmpty = !thread.isLoading && !thread.isError && !hasMessages;
  // 실시간 프레즌스 데이터가 없으므로 "온라인" 대신 최근 대화 시각으로 정직하게 표기.
  const statusLabel = hasMessages
    ? `최근 대화 · ${messages[messages.length - 1].time}`
    : "새 대화를 시작해요";

  return (
    <div className="mc-root hy-rise-in">
      {/* 헤더 */}
      <header className="mc-header">
        <button
          type="button"
          className="mc-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={24} strokeWidth={2.4} />
        </button>
        <span className="mc-peer-avatar">
          <img src={peer.avatar} alt="" />
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
        {hasMessages && (
          <div className="mc-daysep">
            <span>{dayLabel}</span>
          </div>
        )}

        {thread.isLoading && (
          <div className="mc-daysep">
            <span>대화를 불러오는 중…</span>
          </div>
        )}
        {thread.isError && (
          <div className="mc-daysep">
            <span>대화를 불러오지 못했어요</span>
          </div>
        )}
        {showEmpty && (
          <div className="mc-daysep">
            <span>아직 나눈 대화가 없어요. 먼저 인사를 건네보세요 💌</span>
          </div>
        )}

        {messages.map((m) => {
          // 상대 메시지는 실제 발신자 아바타로 귀속. 발신자가 헤더 상대와 다르면(공동부모 등)
          // 이름 라벨로 명시(1:1 스레드에서 제3자 발화 오독 방지).
          const sender = !m.mine && m.senderUserId ? memberByUserId.get(m.senderUserId) : null;
          const senderDiffers = !!sender && !!m.senderUserId && m.senderUserId !== peer.userId;
          return (
            <div key={m.id} className={`mc-msg ${m.mine ? "mc-msg--mine" : "mc-msg--peer"}`}>
              {m.showMeta && (
                <span className="mc-msg-avatar">
                  <img src={sender?.avatar ?? peer.avatar} alt="" />
                </span>
              )}
              <div className="mc-bubble-wrap">
                {m.showMeta && senderDiffers && <div className="mc-sender">{sender.name}</div>}
                {m.kind === "image" && m.imagePath ? (
                  <button
                    type="button"
                    className="mc-bubble mc-bubble--img hy-press"
                    onClick={() => {
                      const u = childPhotoProxyUrl(m.imagePath);
                      if (u) void openExternal(u);
                    }}
                  >
                    <img src={childPhotoProxyUrl(m.imagePath) ?? undefined} alt="공유한 사진" />
                  </button>
                ) : m.kind === "location" && m.location ? (
                  <button
                    type="button"
                    className={`mc-bubble mc-bubble--${m.mine ? "mine" : "peer"} mc-bubble--loc hy-press`}
                    onClick={() => openLocation(m)}
                  >
                    <span className="mc-loc-ic">📍</span>
                    <span className="mc-loc-main">
                      <span className="mc-loc-title">위치 공유</span>
                      <span className="mc-loc-addr">{m.location.address || "지도에서 보기"}</span>
                    </span>
                  </button>
                ) : (
                  <div className={`mc-bubble mc-bubble--${m.mine ? "mine" : "peer"}`}>{m.text}</div>
                )}
                <div className="mc-time">{m.time}</div>
                {m.mine && readByPeer.has(m.id) && <div className="mc-read">읽음</div>}
              </div>
            </div>
          );
        })}
        <div ref={endRef} className="mc-end" aria-hidden="true" />
      </div>

      {/* 하단 입력 (composer) */}
      <div className="mc-composer">
        <div className="mc-quick">
          {QUICK_REPLIES.map((q) => (
            <button
              key={q}
              type="button"
              className="mc-quick-btn hy-press"
              onClick={() => setDraft(q)}
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
            disabled={sharing !== ""}
          >
            <ImageIcon size={19} strokeWidth={2} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onPickImage(e)} />
          <button
            type="button"
            className="mc-attach hy-press"
            aria-label="위치 보내기"
            onClick={() => void shareLocation()}
            disabled={sharing !== ""}
          >
            <MapPin size={19} strokeWidth={2} />
          </button>
          <input
            className="mc-input"
            placeholder="메시지를 입력하세요..."
            value={draft}
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
            disabled={sendMemo.isPending}
          >
            <Send size={20} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}
