import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, MapPin, Check, X, Pencil, Trash2 } from "lucide-react";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { Loading } from "@/components/ui/Loading";
import { SectionHeader } from "@/components/ui/SectionHeader";
import type { PrepKind } from "./ChildHome.data";
import { useMyFamily } from "@/queries/useFamily";
import { placePhoneCall } from "@/lib/native/phone";
import { useEvents, useDailySupplies, useUpsertDailySupply, useDeleteDailySupply } from "@/queries/useSchedule";
import { useSavedPlaces } from "@/queries/useLocation";
import type { DailySupply } from "@/lib/api/endpoints/schedule";
import { useStickerSummary } from "@/queries/useStickers";
import { useMemoThread, useSendMemo } from "@/queries/useMemo";
import { useAiFriendPublicSettings } from "@/queries/useAi";
import { useAuth } from "@/auth/AuthContext";
import { groupEventsByDateKey, PAST_TAGS } from "@/transform/scheduleView";
import { todayDateKey } from "@/transform/dateKey";
import { filterEventsForChild } from "@/transform/eventScope";
import { DEFAULT_AI_FRIEND_NAME, resolveAiFriendDisplayName } from "@/transform/aiFriendName";
import { QUICK_STATUS_ACTIONS, buildQuickStatusMemo, type QuickStatusActionId } from "@/transform/quickStatusShare";
import { resolveEventCharacter } from "@/transform/eventCharacter";
import "./ChildHome.css";

// 원탭 상태 버튼의 3D 아이콘(에셋 키) — 유니코드 이모지 대신 앱 고유 캐릭터로 통일.
// status/*.webp 는 흰 배경 불투명이라 칩 위에서 어색 → 알파 채널 있는 에셋만 사용.
const QUICK_STATUS_ICONS: Record<QuickStatusActionId, string> = {
  arrived: "ui/place-home.webp",
  departed: "mascot/wave.webp",
  late: "ui/warning.webp",
  pickup: "ui/pin-heart.webp",
  call: "ui/phone-lavender.webp",
  battery: "ui/battery.webp",
};

function avatarSrc(path: string): string {
  return path.startsWith("http") ? path : asset(path);
}

export function ChildHome() {
  const navigate = useNavigate();
  const { show } = useToast();

  // 준비물·숙제 추가 입력(어떤 종류를 추가 중인지 + 입력값)
  const [addKind, setAddKind] = useState<PrepKind | null>(null);
  const [draft, setDraft] = useState("");

  // ── 실 데이터: 아이 이름 + 오늘 시간표 ──
  const now = useMemo(() => new Date(), []);
  const { data: family } = useMyFamily();
  const { data: events } = useEvents();
  const { data: places } = useSavedPlaces();
  const { data: stickerSummary } = useStickerSummary();
  const { userId } = useAuth();

  // 본인(아이) 멤버 — 이름 + 히어로 사진(있으면 사진, 없으면 캐릭터 폴백).
  const myMember =
    family?.members.find((m) => m.role === "child" && m.user_id === userId) ?? null;

  // 준비물·숙제: 오늘 date_key 의 daily-supplies 실데이터 + 체크/추가(서버 업서트).
  // 서버 응답은 모든 아이가 섞여 있으므로 본인(myMember.id = child_user_id)만 필터.
  const todayKey = useMemo(() => todayDateKey(now), [now]);
  const suppliesQuery = useDailySupplies(todayKey);
  const supplies = useMemo(() => {
    const all = suppliesQuery.data ?? [];
    return myMember ? all.filter((s) => s.child_user_id === myMember.id) : [];
  }, [suppliesQuery.data, myMember]);
  const upsert = useUpsertDailySupply();
  const remove = useDeleteDailySupply();
  const prepDone = supplies.filter((p) => p.done).length;
  // 이름변경 중인 항목 id + 입력값(반말 톤).
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const realChildName = myMember?.name || "친구";
  const myPhotoSrc = childAvatarPath(myMember?.photo_url);
  // AI 친구 이름(실 설정). 과거 아이 이름으로 시드된 값은 미설정으로 보고 기본 통통이로 표시.
  const aiFriendPublic = useAiFriendPublicSettings(userId);
  const aiFriendName = resolveAiFriendDisplayName({
    savedName: aiFriendPublic.data?.ai_friend_name,
    childName: realChildName,
    fallbackName: DEFAULT_AI_FRIEND_NAME,
  });
  // 부모님께 전화: 성별로 엄마/아빠 번호를 찾아 발신. 번호 없으면 안내만(반말 톤).
  const callParent = (gender: "mom" | "dad", label: string) => {
    const number = (family?.members ?? []).find(
      (m) => m.role === "parent" && m.gender === gender,
    )?.phone;
    if (!number) {
      show(`${label} 전화번호가 없어`, "📞");
      return;
    }
    show(`${label}한테 전화 거는 중...`, "📞");
    void placePhoneCall(number);
  };
  // 내가 모은 스티커 수(요약 API 의 내 user_id 행 total_count).
  const weekStickerCount = useMemo(
    () => (stickerSummary ?? []).find((r) => r.user_id === userId)?.total_count ?? 0,
    [stickerSummary, userId],
  );
  const myEvents = useMemo(
    () => filterEventsForChild(events ?? [], myMember?.id),
    [events, myMember?.id],
  );
  const todayEvents = useMemo(
    () => groupEventsByDateKey(myEvents, now, undefined, places)[todayKey] ?? [],
    [myEvents, now, todayKey, places],
  );
  const nextEvent = todayEvents.find((e) => !PAST_TAGS.has(e.tag)) ?? null;
  // AI 히어로 말풍선용 — 아직 다녀오지 않은(남은) 오늘 일정 개수.
  const remainingCount = useMemo(
    () => todayEvents.filter((e) => !PAST_TAGS.has(e.tag)).length,
    [todayEvents],
  );
  // 오늘 내 스레드의 부모님 최신 메시지 — 도착하면 티커 맨 앞에 내용 그대로 노출(WS 실시간 갱신).
  const memoThread = useMemoThread(useMemo(() => [todayKey], [todayKey]), myMember?.id ?? null);
  const sendMemo = useSendMemo();
  const latestParentMemo = useMemo(() => {
    const replies = memoThread.data ?? [];
    for (let i = replies.length - 1; i >= 0; i -= 1) {
      const r = replies[i];
      if (r.user_role === "parent" && (r.content ?? "").trim()) return r.content.trim();
    }
    return null;
  }, [memoThread.data]);

  // 최상단 실시간 뉴스 티커 — 아이가 알아야 할 내용(부모 메시지·다음 일정·남은 일정·스티커).
  // 아이콘은 유니코드 이모지 대신 3D 에셋으로 통일.
  const tickerItems = useMemo(() => {
    const items: Array<{ icon: string; text: string }> = [];
    if (latestParentMemo) {
      // 부모님 메시지는 내용을 바로 보여준다(길면 말줄임 — 탭하면 대화로 이동하는 기존 동선 활용).
      const text = latestParentMemo.length > 34 ? `${latestParentMemo.slice(0, 34)}…` : latestParentMemo;
      items.push({ icon: "ui/chat-heart.webp", text: `부모님 · ${text}` });
    }
    if (nextEvent) {
      items.push({
        icon: "ui/calendar-heart.webp",
        text: `다음 · ${nextEvent.title}${nextEvent.time ? ` · ${nextEvent.time}` : ""}`,
      });
    } else {
      items.push({ icon: "ui/calendar-heart.webp", text: "오늘 일정 다 끝났어 · 푹 쉬어도 돼" });
    }
    if (remainingCount > 0) items.push({ icon: "ui/bell.webp", text: `아직 ${remainingCount}개 남았어` });
    if (weekStickerCount > 0)
      items.push({ icon: "ui/star-medal.webp", text: `스티커 ${weekStickerCount}개 모았어` });
    if (!latestParentMemo)
      items.push({ icon: "ui/chat-heart.webp", text: "부모님께 오늘 이야기를 들려줘" });
    return items;
  }, [latestParentMemo, nextEvent, remainingCount, weekStickerCount]);
  const [tickerIdx, setTickerIdx] = useState(0);
  useEffect(() => {
    if (tickerItems.length <= 1) return;
    const id = setInterval(() => setTickerIdx((i) => (i + 1) % tickerItems.length), 3500);
    return () => clearInterval(id);
  }, [tickerItems.length]);
  const ticker = tickerItems[tickerIdx % tickerItems.length];
  const timetable = todayEvents.map((e) => ({
    id: e.id,
    time: e.time,
    timeColor: e.tag === "진행 중" ? "var(--hy-accent-text)" : "var(--fg-faint)",
    dotColor: e.color,
    soft: e.soft,
    emoji: e.emoji,
    title: e.title,
    place: e.place,
    isNow: e.tag === "진행 중",
  }));
  const todayLabel = `${now.getMonth() + 1}월 ${now.getDate()}일`;

  const toggleSupply = (item: DailySupply) => {
    if (editId) return; // 이름 바꾸는 중엔 체크 안 함
    upsert.mutate(
      {
        id: item.id,
        date_key: todayKey,
        label: item.label,
        done: !item.done,
        kind: item.kind ?? "prep",
        child_user_id: item.child_user_id ?? null,
      },
      { onError: () => show("안 됐어. 다시 눌러볼래?", "⚠️") },
    );
  };
  const startEdit = (item: DailySupply) => {
    setEditId(item.id ?? null);
    setEditDraft(item.label);
  };
  const cancelEdit = () => {
    setEditId(null);
    setEditDraft("");
  };
  const commitEdit = (item: DailySupply) => {
    const label = editDraft.trim();
    if (!label || label === item.label) {
      cancelEdit();
      return;
    }
    upsert.mutate(
      {
        id: item.id,
        date_key: todayKey,
        label,
        done: item.done,
        kind: item.kind ?? "prep",
        child_user_id: item.child_user_id ?? null,
      },
      { onSuccess: cancelEdit, onError: () => show("못 바꿨어. 다시 해볼래?", "⚠️") },
    );
  };
  const delSupply = (item: DailySupply) => {
    if (remove.isPending) return;
    if (editId === item.id) cancelEdit();
    remove.mutate(item, { onError: () => show("못 지웠어. 다시 해볼래?", "⚠️") });
  };
  const submitAdd = () => {
    const label = draft.trim();
    if (!label || !addKind || upsert.isPending) return;
    if (!myMember) {
      show("내 정보를 아직 못 찾았어. 잠시 후 다시 해볼래?", "⚠️");
      return;
    }
    upsert.mutate(
      { date_key: todayKey, label, done: false, kind: addKind, child_user_id: myMember.id },
      {
        onSuccess: () => {
          setDraft("");
          setAddKind(null);
        },
        onError: () => show("추가하지 못했어. 다시 해볼래?", "⚠️"),
      },
    );
  };

  const sendQuickStatus = (actionId: QuickStatusActionId) => {
    if (!myMember?.id || sendMemo.isPending) return;
    sendMemo.mutate(buildQuickStatusMemo(actionId, myMember.id, todayKey), {
      onSuccess: () => show("부모님께 보냈어", "💬"),
      onError: () => show("보내지 못했어. 잠시 후 다시 해줘", "⚠️"),
    });
  };

  // SOS — 누르고 3초 유지하면 발동
  const [sosHold, setSosHold] = useState(false);
  const sosTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startSos = () => {
    setSosHold(true);
    sosTimer.current = setTimeout(() => {
      sosTimer.current = null;
      setSosHold(false);
      navigate("/child/sos");
    }, 3000);
  };
  const cancelSos = () => {
    if (sosTimer.current) {
      clearTimeout(sosTimer.current);
      sosTimer.current = null;
    }
    setSosHold(false);
  };
  // 언마운트 시 진행 중인 SOS 홀드 타이머 정리(홈 이탈 후 지연 navigate 방지).
  useEffect(
    () => () => {
      if (sosTimer.current) clearTimeout(sosTimer.current);
    },
    [],
  );

  return (
    <div className="hy-rise-in">
      {/* 헤더 — 최상단 실시간 뉴스 티커(아이가 알아야 할 내용) */}
      <header className="ch-header">
        <div className="ch-ticker" aria-live="polite">
          <span className="ch-ticker__dot" />
          <img key={`ic-${tickerIdx}`} className="ch-ticker__ic" src={asset(ticker.icon)} alt="" />
          <span key={tickerIdx} className="ch-ticker__text">{ticker.text}</span>
        </div>
        <button
          type="button"
          className="ch-sticker-btn hy-press"
          onClick={() => navigate("/child/sticker")}
        >
          <img src={asset("ui/crown.webp")} alt="" />
          <span className="ch-sticker-btn__count">{weekStickerCount}</span>
        </button>
      </header>

      <div className="ch-content">
        {/* 히어로 — 본인 사진 또는 기본 혜니 캐릭터 + AI 친구 대화 */}
        <div className="ch-ai">
          <div className="ch-ai__spark">
            <img src={asset("ui/sparkle.webp")} alt="" />
          </div>
          <div className="ch-ai__spark2">
            <img src={asset("ui/heart.webp")} alt="" />
          </div>
          <div className="ch-ai__row">
            <div className="ch-ai__photo">
              <img src={avatarSrc(myPhotoSrc)} alt={realChildName} />
            </div>
            <div className="ch-ai__col">
              <div className="ch-ai__hello">
                안녕, {realChildName}!
                <img className="ch-ai__rainbow" src={asset("ui/rainbow.webp")} alt="" />
              </div>
              <div className="ch-ai__mini">오늘도 반가워</div>
            </div>
          </div>
          <div className="ch-ai__bubble">
            {remainingCount > 0 ? (
              <>
                {aiFriendName}가 기다려! 남은 일정 <b>{remainingCount}개</b> 있어. 🎈
              </>
            ) : (
              <>{aiFriendName}랑 오늘 있었던 일 이야기해볼까? 🎈</>
            )}
          </div>
          <button
            type="button"
            className="ch-ai__cta hy-press"
            onClick={() => {
              // 부모가 AI 를 꺼둔 경우 정직 안내(진입 후 에러보다 먼저).
              if (aiFriendPublic.data?.ai_enabled === false) {
                show("AI 친구는 부모님이 켜줘야 해. 부탁해봐! 🙏", "🤖");
                return;
              }
              // 아직 이름을 안 지었으면 먼저 캐릭터·이름 정하기부터(첫 만남).
              if (!aiFriendPublic.data?.ai_friend_name?.trim()) {
                navigate("/child/ai-friend-setup");
                return;
              }
              navigate("/child/ai-friend");
            }}
          >
            <img src={asset("ui/chat-heart.webp")} alt="" />
            <span>{aiFriendName}랑 이야기하기</span>
          </button>
        </div>

        {/* 다음 일정 + 길찾기 */}
        <div className="ch-next">
          <div className="ch-next__row">
            <span className="ch-next__icon">
              <img
                src={asset(nextEvent ? resolveEventCharacter(nextEvent.title) : "mascot/cheer.webp")}
                alt=""
              />
            </span>
            <span className="ch-next__main">
              <span className="ch-next__label">다음 일정</span>
              <span className="ch-next__title">{nextEvent ? nextEvent.title : "오늘 일정 끝!"}</span>
              <span className="ch-next__sub">
                {nextEvent ? `${nextEvent.place ? nextEvent.place + " · " : ""}${nextEvent.time}` : "푹 쉬어도 돼 😊"}
              </span>
            </span>
          </div>
          <button type="button" className="ch-next__cta hy-press" onClick={() => navigate("/route")}>
            <MapPin size={19} strokeWidth={2.2} color="var(--bg-card)" />
            길찾기
          </button>
        </div>

        {/* 원탭 상태 공유 */}
        <section className="ch-status-share">
          <div className="ch-status-share__head">
            <span>
              <b>지금 상태 보내기</b>
              <small>버튼만 누르면 부모님께 알려줄게</small>
            </span>
          </div>
          <div className="ch-status-share__grid">
            {QUICK_STATUS_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                className="ch-status-share__btn hy-press"
                onClick={() => sendQuickStatus(action.id)}
                disabled={sendMemo.isPending || !myMember}
              >
                <img className="ch-status-share__ic" src={asset(QUICK_STATUS_ICONS[action.id])} alt="" />
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* 바로 할 수 있어 */}
        <section>
          <div className="ch-qa-title">바로 할 수 있어</div>
          <div className="ch-qa-list">
            <button
              type="button"
              className="ch-qa hy-press"
              onClick={() => navigate("/child/memo")}
            >
              <span className="ch-qa__icon" style={{ background: "var(--rose-soft)" }}>
                <img src={asset("ui/chat-heart.webp")} alt="" style={{ width: 30, height: 30, objectFit: "contain" }} />
              </span>
              <span className="ch-qa__main">
                <span className="ch-qa__title">부모님에게 이야기하기</span>
                <span className="ch-qa__sub">오늘 있었던 일을 들려줘 💗</span>
              </span>
            </button>

            <button
              type="button"
              className="ch-qa hy-press"
              onClick={() => navigate("/child/sticker")}
            >
              <span className="ch-qa__icon" style={{ background: "var(--cream-soft)" }}>
                <img src={asset("sticker/best.webp")} alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />
              </span>
              <span className="ch-qa__main">
                <span className="ch-qa__title">받은 스티커</span>
                <span className="ch-qa__sub">
                  {weekStickerCount > 0
                    ? `이번 주 스티커 ${weekStickerCount}개 모았어 ⭐`
                    : "칭찬 받으면 스티커가 도착해 💝"}
                </span>
              </span>
              <ChevronRight size={20} strokeWidth={2.4} color="var(--fg-disabled)" style={{ flex: "none" }} />
            </button>

            <button
              type="button"
              className="ch-qa hy-press"
              onClick={() => navigate("/friend-play")}
            >
              <span className="ch-qa__icon" style={{ background: "var(--cream-soft)" }}>
                <img
                  src={asset("ui/menu-friend-playdate.webp")}
                  alt=""
                  style={{ width: 38, height: 38, objectFit: "contain" }}
                />
              </span>
              <span className="ch-qa__main">
                <span className="ch-qa__title">친구랑 놀기</span>
                <span className="ch-qa__sub">같이 놀 친구를 찾아 초대 보내기</span>
              </span>
              <ChevronRight size={20} strokeWidth={2.4} color="var(--fg-disabled)" style={{ flex: "none" }} />
            </button>
          </div>
        </section>

        {/* 부모님께 전화 */}
        <div className="ch-call">
          <div className="ch-call__head">
            <span className="ch-call__head-icon">
              <img src={asset("ui/phone-lavender.webp")} alt="" />
            </span>
            <span className="ch-call__title">부모님께 전화</span>
          </div>
          <div className="ch-call__grid">
            <button
              type="button"
              className="ch-call__btn hy-press"
              style={{ background: "var(--rose-soft)" }}
              onClick={() => callParent("mom", "엄마")}
            >
              <img src={asset("family/mom.webp")} alt="" />
              <span className="ch-call__btn-text">
                <span className="ch-call__name" style={{ color: "var(--rose-text)" }}>
                  엄마
                </span>
                <span className="ch-call__sub" style={{ color: "var(--rose-400)" }}>
                  전화 걸기
                </span>
              </span>
            </button>
            <button
              type="button"
              className="ch-call__btn hy-press"
              style={{ background: "var(--blue-soft)" }}
              onClick={() => callParent("dad", "아빠")}
            >
              <img src={asset("family/dad.webp")} alt="" />
              <span className="ch-call__btn-text">
                <span className="ch-call__name" style={{ color: "var(--blue-text)" }}>
                  아빠
                </span>
                <span className="ch-call__sub" style={{ color: "var(--blue-500)" }}>
                  전화 걸기
                </span>
              </span>
            </button>
          </div>
        </div>

        {/* 오늘 시간표 */}
        <section>
          <SectionHeader
            iconBg="var(--rose-soft)"
            icon={<img src={asset("ui/calendar-heart.webp")} alt="" />}
            title="오늘 시간표"
            action={
              <span
                style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--fg-faint)" }}
              >
                {todayLabel}
              </span>
            }
          />
          <div className="ch-tt-card">
            {timetable.length === 0 ? (
              <div className="ch-tt-row" style={{ color: "var(--fg-muted)", fontWeight: 600 }}>
                오늘은 일정이 없어 🎈
              </div>
            ) : (
              timetable.map((t) => (
                <div key={t.id} className="ch-tt-row">
                  <span className="ch-tt-time" style={{ color: t.timeColor }}>
                    {t.time}
                  </span>
                  <span className="ch-tt-dot" style={{ background: t.dotColor }} />
                  <span className="ch-tt-icon" style={{ background: t.soft }}>
                    <img src={asset(resolveEventCharacter(t.title))} alt="" />
                  </span>
                  <span className="ch-tt-main">
                    <span className="ch-tt-title">{t.title}</span>
                    <span className="ch-tt-place">{t.place}</span>
                  </span>
                  {t.isNow && <span className="ch-tt-now">지금</span>}
                </div>
              ))
            )}
          </div>
        </section>

        {/* 준비물 · 숙제 */}
        <section>
          <SectionHeader
            iconBg="var(--cream-soft)"
            icon={<img src={asset("cat/study.webp")} alt="" />}
            title="준비물 · 숙제"
            action={
              <span className="ch-prep-count">
                {prepDone}/{supplies.length}
              </span>
            }
          />
          <div className="ch-prep-card">
            {suppliesQuery.isLoading ? (
              <div className="ch-prep-row" style={{ justifyContent: "center" }}>
                <Loading label="챙길 걸 불러오는 중" />
              </div>
            ) : supplies.length === 0 ? (
              <div className="ch-prep-row" style={{ color: "var(--fg-muted)", fontWeight: 600 }}>
                아직 챙길 게 없어 🎒
              </div>
            ) : (
              supplies.map((s) =>
                editId === s.id ? (
                  <div key={s.id} className="ch-prep-row">
                    <input
                      className="ch-prep-input"
                      value={editDraft}
                      autoFocus
                      aria-label="이름 바꾸기"
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(s);
                        if (e.key === "Escape") cancelEdit();
                      }}
                    />
                    <button
                      type="button"
                      className="ch-prep-addsubmit hy-press"
                      onClick={() => commitEdit(s)}
                      disabled={upsert.isPending || !editDraft.trim()}
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      className="ch-prep-del"
                      aria-label="취소"
                      onClick={cancelEdit}
                    >
                      <X size={15} strokeWidth={2.4} color="var(--danger-500)" />
                    </button>
                  </div>
                ) : (
                  <div key={s.id} className="ch-prep-row">
                    <button
                      type="button"
                      className="ch-prep-check hy-press"
                      aria-label="완료 토글"
                      onClick={() => toggleSupply(s)}
                      style={{
                        background: s.done ? "var(--hy-accent)" : "var(--bg-card)",
                        border: s.done ? "none" : "2px solid var(--line-strong)",
                      }}
                    >
                      <Check size={15} strokeWidth={3} color="var(--bg-card)" style={{ opacity: s.done ? 1 : 0 }} />
                    </button>
                    <button type="button" className="ch-prep-labelbtn" onClick={() => toggleSupply(s)}>
                      {s.kind === "hw" && (
                        <span
                          className="ch-prep-kind"
                          style={{ color: "var(--lav-text)", background: "var(--lav-soft2)" }}
                        >
                          숙제
                        </span>
                      )}
                      <span
                        className="ch-prep-text"
                        style={{
                          color: s.done ? "var(--fg-faint)" : "var(--fg-body)",
                          textDecoration: s.done ? "line-through" : "none",
                        }}
                      >
                        {s.label}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ch-prep-iconbtn hy-press"
                      aria-label="이름 바꾸기"
                      onClick={() => startEdit(s)}
                    >
                      <Pencil size={14} strokeWidth={2.2} color="var(--fg-disabled)" />
                    </button>
                    <button
                      type="button"
                      className="ch-prep-iconbtn hy-press"
                      aria-label="지우기"
                      onClick={() => delSupply(s)}
                      disabled={remove.isPending}
                    >
                      <Trash2 size={14} strokeWidth={2.2} color="var(--danger-500)" />
                    </button>
                  </div>
                ),
              )
            )}

            {addKind ? (
              <div className="ch-prep-row">
                <input
                  className="ch-prep-input"
                  value={draft}
                  autoFocus
                  placeholder={addKind === "hw" ? "무슨 숙제야?" : "뭘 챙겨야 해?"}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitAdd();
                  }}
                />
                <button
                  type="button"
                  className="ch-prep-addsubmit hy-press"
                  onClick={submitAdd}
                  disabled={upsert.isPending || !draft.trim()}
                >
                  추가
                </button>
                <button
                  type="button"
                  className="ch-prep-del"
                  aria-label="취소"
                  onClick={() => {
                    setAddKind(null);
                    setDraft("");
                  }}
                >
                  <X size={15} strokeWidth={2.4} color="var(--danger-500)" />
                </button>
              </div>
            ) : (
              <div className="ch-prep-add-row">
                <button
                  type="button"
                  className="ch-prep-add ch-prep-add--prep"
                  onClick={() => {
                    setAddKind("prep");
                    setDraft("");
                  }}
                >
                  + 준비물
                </button>
                <button
                  type="button"
                  className="ch-prep-add ch-prep-add--hw"
                  onClick={() => {
                    setAddKind("hw");
                    setDraft("");
                  }}
                >
                  + 숙제
                </button>
              </div>
            )}
          </div>
        </section>

        {/* SOS 도움 요청 */}
        <button
          type="button"
          className={`ch-sos hy-press${sosHold ? " is-holding" : ""}`}
          onPointerDown={startSos}
          onPointerUp={cancelSos}
          onPointerLeave={cancelSos}
          onPointerCancel={cancelSos}
        >
          <span className="ch-sos__sheen" />
          <span className="ch-sos__fill" />
          <span className="ch-sos__icon">
            <img src={asset("ui/sos-shield.webp")} alt="" />
          </span>
          <span className="ch-sos__main">
            <span className="ch-sos__label">SOS 도움 요청</span>
            <span className="ch-sos__sub">3초 누르면 엄마·아빠한테 바로 연결</span>
          </span>
          <span className="ch-sos__chev">
            <ChevronRight size={20} strokeWidth={2.6} color="var(--bg-card)" />
          </span>
        </button>
      </div>
    </div>
  );
}
