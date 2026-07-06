import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, MapPin, Check, X, Pencil, Trash2 } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { SectionHeader } from "@/components/ui/SectionHeader";
import type { PrepKind } from "./ChildHome.data";
import { useMyFamily } from "@/queries/useFamily";
import { placePhoneCall } from "@/lib/native/phone";
import { useEvents, useDailySupplies, useUpsertDailySupply, useDeleteDailySupply } from "@/queries/useSchedule";
import type { DailySupply } from "@/lib/api/endpoints/schedule";
import { useStickerSummary } from "@/queries/useStickers";
import { useMemoThread } from "@/queries/useMemo";
import { useAiFriendPublicSettings } from "@/queries/useAi";
import { useAuth } from "@/auth/AuthContext";
import { groupEventsByDateKey } from "@/transform/scheduleView";
import { todayDateKey } from "@/transform/dateKey";
import "./ChildHome.css";

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
  const { data: stickerSummary } = useStickerSummary();
  const { userId } = useAuth();

  // 본인(아이) 멤버 — 이름 + 히어로 사진(있으면 사진, 없으면 캐릭터 폴백).
  const myMember =
    family?.members.find((m) => m.role === "child" && m.user_id === userId) ??
    family?.members.find((m) => m.role === "child") ??
    null;

  // 준비물·숙제: 오늘 date_key 의 daily-supplies 실데이터 + 체크/추가(서버 업서트).
  // 서버 응답은 모든 아이가 섞여 있으므로 본인(myMember.id = child_user_id)만 필터.
  const todayKey = useMemo(() => todayDateKey(now), [now]);
  const suppliesQuery = useDailySupplies(todayKey);
  const supplies = useMemo(() => {
    const all = suppliesQuery.data ?? [];
    return myMember ? all.filter((s) => s.child_user_id === myMember.id) : all;
  }, [suppliesQuery.data, myMember]);
  const upsert = useUpsertDailySupply();
  const remove = useDeleteDailySupply();
  const prepDone = supplies.filter((p) => p.done).length;
  // 이름변경 중인 항목 id + 입력값(반말 톤).
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const realChildName = myMember?.name || "친구";
  const myPhotoSrc =
    myMember?.photo_url && myMember.photo_url.startsWith("http") ? myMember.photo_url : null;
  // AI 친구 이름(실 설정). 미설정이면 기본 "혜니".
  const aiFriendPublic = useAiFriendPublicSettings(userId);
  const aiFriendName = aiFriendPublic.data?.ai_friend_name?.trim() || "혜니";
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
  const todayEvents = useMemo(
    () => groupEventsByDateKey(events ?? [], now)[todayDateKey(now)] ?? [],
    [events, now],
  );
  const nextEvent = todayEvents.find((e) => e.tag !== "다녀옴") ?? null;
  // AI 히어로 말풍선용 — 아직 다녀오지 않은(남은) 오늘 일정 개수.
  const remainingCount = useMemo(
    () => todayEvents.filter((e) => e.tag !== "다녀옴").length,
    [todayEvents],
  );
  // 오늘 내 스레드의 부모님 최신 메시지 — 도착하면 티커 맨 앞에 내용 그대로 노출(WS 실시간 갱신).
  const memoThread = useMemoThread(useMemo(() => [todayKey], [todayKey]), myMember?.id ?? null);
  const latestParentMemo = useMemo(() => {
    const replies = memoThread.data ?? [];
    for (let i = replies.length - 1; i >= 0; i -= 1) {
      const r = replies[i];
      if (r.user_role === "parent" && (r.content ?? "").trim()) return r.content.trim();
    }
    return null;
  }, [memoThread.data]);

  // 최상단 실시간 뉴스 티커 — 아이가 알아야 할 내용(부모 메시지·다음 일정·남은 일정·스티커).
  const tickerItems = useMemo(() => {
    const items: string[] = [];
    if (latestParentMemo) {
      // 부모님 메시지는 내용을 바로 보여준다(길면 말줄임 — 탭하면 대화로 이동하는 기존 동선 활용).
      const text = latestParentMemo.length > 34 ? `${latestParentMemo.slice(0, 34)}…` : latestParentMemo;
      items.push(`💌 부모님 · ${text}`);
    }
    if (nextEvent) {
      items.push(`📅 다음 · ${nextEvent.title}${nextEvent.time ? ` · ${nextEvent.time}` : ""}`);
    } else {
      items.push("📅 오늘 일정 다 끝났어 · 푹 쉬어도 돼");
    }
    if (remainingCount > 0) items.push(`⏰ 아직 ${remainingCount}개 남았어`);
    if (weekStickerCount > 0) items.push(`⭐ 스티커 ${weekStickerCount}개 모았어`);
    if (!latestParentMemo) items.push("💬 부모님께 오늘 이야기를 들려줘");
    return items;
  }, [latestParentMemo, nextEvent, remainingCount, weekStickerCount]);
  const [tickerIdx, setTickerIdx] = useState(0);
  useEffect(() => {
    if (tickerItems.length <= 1) return;
    const id = setInterval(() => setTickerIdx((i) => (i + 1) % tickerItems.length), 3500);
    return () => clearInterval(id);
  }, [tickerItems.length]);
  const tickerText = tickerItems[tickerIdx % tickerItems.length];
  const timetable = todayEvents.map((e) => ({
    id: e.id,
    time: e.time,
    timeColor: e.tag === "진행 중" ? "var(--hy-accent-text)" : "#A99FA4",
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
    upsert.mutate(
      { date_key: todayKey, label, done: false, kind: addKind, child_user_id: userId },
      {
        onSuccess: () => {
          setDraft("");
          setAddKind(null);
        },
        onError: () => show("추가하지 못했어. 다시 해볼래?", "⚠️"),
      },
    );
  };

  // 꾹 SOS — 누르고 3초 유지하면 발동
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
          <span key={tickerIdx} className="ch-ticker__text">{tickerText}</span>
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
        {/* 히어로 — 본인 사진(캐릭터 없음) + AI 친구 대화 */}
        <div className="ch-ai">
          <div className="ch-ai__spark">✨</div>
          <div className="ch-ai__spark2">💛</div>
          <div className="ch-ai__row">
            <div className="ch-ai__photo">
              {myPhotoSrc ? (
                <img src={myPhotoSrc} alt={realChildName} />
              ) : (
                <span className="ch-ai__photo-initial">{realChildName.slice(0, 1)}</span>
              )}
            </div>
            <div className="ch-ai__col">
              <div className="ch-ai__hello">안녕, {realChildName}! 🌈</div>
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
            <span className="ch-next__icon" style={{ fontSize: 26, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {nextEvent ? nextEvent.emoji : "🎈"}
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
            <MapPin size={19} strokeWidth={2.2} color="#fff" />
            길찾기
          </button>
        </div>

        {/* 바로 할 수 있어 */}
        <section>
          <div className="ch-qa-title">바로 할 수 있어</div>
          <div className="ch-qa-list">
            <button
              type="button"
              className="ch-qa hy-press"
              onClick={() => navigate("/child/memo")}
            >
              <span className="ch-qa__icon" style={{ background: "#FDE7F1" }}>
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
              <span className="ch-qa__icon" style={{ background: "#FFF3D6" }}>
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
              <ChevronRight size={20} strokeWidth={2.4} color="#C9BFC4" style={{ flex: "none" }} />
            </button>

            <button
              type="button"
              className="ch-qa hy-press"
              onClick={() => navigate("/friend-play")}
            >
              <span className="ch-qa__icon" style={{ background: "#FDF0DA" }}>
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
              <ChevronRight size={20} strokeWidth={2.4} color="#C9BFC4" style={{ flex: "none" }} />
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
              style={{ background: "#FDE7F1" }}
              onClick={() => callParent("mom", "엄마")}
            >
              <img src={asset("family/mom.webp")} alt="" />
              <span className="ch-call__btn-text">
                <span className="ch-call__name" style={{ color: "#B0477A" }}>
                  엄마
                </span>
                <span className="ch-call__sub" style={{ color: "#C77CA0" }}>
                  전화 걸기
                </span>
              </span>
            </button>
            <button
              type="button"
              className="ch-call__btn hy-press"
              style={{ background: "#E6F2FB" }}
              onClick={() => callParent("dad", "아빠")}
            >
              <img src={asset("family/dad.webp")} alt="" />
              <span className="ch-call__btn-text">
                <span className="ch-call__name" style={{ color: "#2E6DA4" }}>
                  아빠
                </span>
                <span className="ch-call__sub" style={{ color: "#6FA0C7" }}>
                  전화 걸기
                </span>
              </span>
            </button>
          </div>
        </div>

        {/* 오늘 시간표 */}
        <section>
          <SectionHeader
            iconBg="#FDE7F1"
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
                  <span className="ch-tt-icon" style={{ background: t.soft, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {t.emoji}
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
            iconBg="#FDF0DA"
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
              <div className="ch-prep-row" style={{ color: "var(--fg-muted)", fontWeight: 600 }}>
                불러오는 중…
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
                      <X size={15} strokeWidth={2.4} color="#E5484D" />
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
                        background: s.done ? "var(--hy-accent)" : "#fff",
                        border: s.done ? "none" : "2px solid var(--line-strong)",
                      }}
                    >
                      <Check size={15} strokeWidth={3} color="#fff" style={{ opacity: s.done ? 1 : 0 }} />
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
                      <Pencil size={14} strokeWidth={2.2} color="#C9BFC4" />
                    </button>
                    <button
                      type="button"
                      className="ch-prep-iconbtn hy-press"
                      aria-label="지우기"
                      onClick={() => delSupply(s)}
                      disabled={remove.isPending}
                    >
                      <Trash2 size={14} strokeWidth={2.2} color="#E5484D" />
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
                  <X size={15} strokeWidth={2.4} color="#E5484D" />
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

        {/* 꾹 SOS */}
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
            <span className="ch-sos__label">꾹 SOS</span>
            <span className="ch-sos__sub">3초 누르면 엄마·아빠한테 바로 연결</span>
          </span>
          <span className="ch-sos__chev">
            <ChevronRight size={20} strokeWidth={2.6} color="#fff" />
          </span>
        </button>
      </div>
    </div>
  );
}
