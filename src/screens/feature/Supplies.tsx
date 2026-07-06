import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Check, Plus, Pencil, Trash2, X } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "@/queries/useFamily";
import { useActiveChild } from "@/app/activeChild";
import { useDailySupplies, useUpsertDailySupply, useDeleteDailySupply } from "@/queries/useSchedule";
import type { DailySupply } from "@/lib/api/endpoints/schedule";
import { parseAppDateKey, todayDateKey } from "@/transform/dateKey";
import "./Supplies.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/**
 * 숙제·준비물(P-13). 부모·아이 공용 — role 로 말투 분기(부모 존댓말/아이 반말).
 * location.state.dateKey(기본 오늘)의 daily-supplies 를 읽어 체크 토글·항목 추가/이름변경/삭제를
 * 서버에 반영. 서버 daily_supplies 는 (family, child, date) 당 1행이라 대상 아이를 하나 정한다.
 */
export function Supplies() {
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();
  const { role, userId } = useAuth();
  const isChild = role === "child";

  const dateKey = useMemo(() => {
    const fromState = (location.state as { dateKey?: string } | null)?.dateKey;
    return typeof fromState === "string" && fromState ? fromState : todayDateKey();
  }, [location.state]);

  const dateLabel = useMemo(() => {
    const d = parseAppDateKey(dateKey) ?? new Date();
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  }, [dateKey]);

  const { data: family } = useMyFamily();
  const childMembers = useMemo(
    () => (family?.members ?? []).filter((m) => m.role === "child"),
    [family],
  );
  // 대상 아이(member id): nav.childId > 아이 세션이면 본인 > 전역 활성 아이.
  // 첫째 폴백 제거 — 홈(활성 아이)과 이 화면이 다른 아이를 가리키던 읽기·쓰기 오귀속 차단.
  const { activeChild } = useActiveChild();
  const targetChildId = useMemo(() => {
    const fromState = (location.state as { childId?: string } | null)?.childId;
    if (fromState) return fromState;
    if (isChild) return childMembers.find((m) => m.user_id === userId)?.id ?? null;
    return activeChild?.id ?? null;
  }, [location.state, isChild, childMembers, userId, activeChild]);
  const targetChildName = childMembers.find((m) => m.id === targetChildId)?.name ?? "";

  const suppliesQuery = useDailySupplies(dateKey);
  // 서버 응답은 모든 아이가 섞여 있으므로 대상 아이로 필터.
  const supplies = useMemo(() => {
    const all = suppliesQuery.data ?? [];
    return targetChildId ? all.filter((s) => s.child_user_id === targetChildId) : all;
  }, [suppliesQuery.data, targetChildId]);
  const upsert = useUpsertDailySupply();
  const remove = useDeleteDailySupply();

  const [prepDraft, setPrepDraft] = useState("");
  const [hwDraft, setHwDraft] = useState("");
  // 이름변경 중인 항목 id + 입력값.
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const prepList = supplies.filter((s) => s.kind !== "hw");
  const hwList = supplies.filter((s) => s.kind === "hw");
  const doneCount = supplies.filter((s) => s.done).length;

  const toggle = (item: DailySupply) => {
    if (editId) return; // 편집 중엔 토글 금지
    upsert.mutate(
      {
        id: item.id,
        date_key: dateKey,
        label: item.label,
        done: !item.done,
        kind: item.kind ?? "prep",
        child_user_id: item.child_user_id ?? targetChildId,
      },
      { onError: () => show(isChild ? "안 됐어. 다시 눌러볼래?" : "반영에 실패했어요", "⚠️") },
    );
  };

  const add = (kind: "prep" | "hw", draft: string, clear: () => void) => {
    const label = draft.trim();
    if (!label || upsert.isPending) return;
    if (!targetChildId) {
      show(isChild ? "아직 준비가 안 됐어" : "가족에 등록된 아이가 없어요", "🎒");
      return;
    }
    upsert.mutate(
      { date_key: dateKey, label, done: false, kind, child_user_id: targetChildId },
      {
        onSuccess: clear,
        onError: () => show(isChild ? "추가하지 못했어. 다시 해볼래?" : "추가하지 못했어요", "⚠️"),
      },
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
    if (!label) {
      cancelEdit();
      return;
    }
    if (label === item.label) {
      cancelEdit();
      return;
    }
    upsert.mutate(
      {
        id: item.id,
        date_key: dateKey,
        label,
        done: item.done,
        kind: item.kind ?? "prep",
        child_user_id: item.child_user_id ?? targetChildId,
      },
      {
        onSuccess: cancelEdit,
        onError: () => show(isChild ? "못 바꿨어. 다시 해볼래?" : "이름을 바꾸지 못했어요", "⚠️"),
      },
    );
  };
  const del = (item: DailySupply) => {
    if (remove.isPending) return;
    if (editId === item.id) cancelEdit();
    remove.mutate(item, {
      onError: () => show(isChild ? "못 지웠어. 다시 해볼래?" : "삭제하지 못했어요", "⚠️"),
    });
  };

  const sections = [
    {
      kind: "prep" as const,
      heading: "준비물",
      list: prepList,
      draft: prepDraft,
      setDraft: setPrepDraft,
      placeholder: isChild ? "뭘 챙겨야 해?" : "준비물을 입력하세요",
    },
    {
      kind: "hw" as const,
      heading: "숙제",
      list: hwList,
      draft: hwDraft,
      setDraft: setHwDraft,
      placeholder: isChild ? "무슨 숙제야?" : "숙제를 입력하세요",
    },
  ];

  const emptyText = isChild ? "아직 없어 🎒" : "등록된 항목이 없어요";

  return (
    <div className="sup-screen">
      <div className="sup-header">
        <button type="button" className="sup-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="sup-title">숙제 · 준비물</span>
        <span className="sup-date">{dateLabel}</span>
      </div>

      <div className="sup-content">
        <div className="sup-intro">
          <img className="sup-intro__img" src={asset("cat/study.webp")} alt="" />
          <div>
            <div className="sup-intro__title">{isChild ? "오늘 챙길 것" : "오늘 준비물·숙제"}</div>
            <div className="sup-intro__sub">
              {suppliesQuery.isLoading
                ? "불러오는 중…"
                : `${targetChildName ? targetChildName + " · " : ""}${supplies.length}개 중 ${doneCount}개 완료`}
            </div>
          </div>
        </div>

        {sections.map((sec) => (
          <section key={sec.kind} className="sup-section">
            <div className="sup-section__head">
              <span className="sup-section__title">{sec.heading}</span>
              <span className="sup-section__count">{sec.list.length}</span>
            </div>
            <div className="sup-card">
              {suppliesQuery.isLoading ? (
                <div className="sup-empty">불러오는 중…</div>
              ) : sec.list.length === 0 ? (
                <div className="sup-empty">{emptyText}</div>
              ) : (
                sec.list.map((s) =>
                  editId === s.id ? (
                    <div key={s.id} className="sup-row">
                      <input
                        className="sup-edit-input"
                        value={editDraft}
                        autoFocus
                        aria-label="항목 이름 변경"
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(s);
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <button
                        type="button"
                        className="sup-iconbtn hy-press"
                        aria-label="이름 변경 저장"
                        onClick={() => commitEdit(s)}
                        disabled={upsert.isPending || !editDraft.trim()}
                      >
                        <Check size={16} strokeWidth={2.6} color="var(--hy-accent-text)" />
                      </button>
                      <button
                        type="button"
                        className="sup-iconbtn hy-press"
                        aria-label="이름 변경 취소"
                        onClick={cancelEdit}
                      >
                        <X size={16} strokeWidth={2.4} color="#E5484D" />
                      </button>
                    </div>
                  ) : (
                    <div key={s.id} className="sup-row">
                      <button
                        type="button"
                        className="sup-check hy-press"
                        aria-label="완료 토글"
                        onClick={() => toggle(s)}
                        style={{
                          background: s.done ? "var(--hy-accent)" : "#fff",
                          border: s.done ? "none" : "2px solid var(--line-strong)",
                        }}
                      >
                        <Check size={15} strokeWidth={3} color="#fff" style={{ opacity: s.done ? 1 : 0 }} />
                      </button>
                      <button type="button" className="sup-label" onClick={() => toggle(s)}>
                        <span
                          className="sup-label__text"
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
                        className="sup-iconbtn hy-press"
                        aria-label="이름 변경"
                        onClick={() => startEdit(s)}
                      >
                        <Pencil size={15} strokeWidth={2.2} color="var(--fg-faint)" />
                      </button>
                      <button
                        type="button"
                        className="sup-iconbtn hy-press"
                        aria-label="삭제"
                        onClick={() => del(s)}
                        disabled={remove.isPending}
                      >
                        <Trash2 size={15} strokeWidth={2.2} color="#E5484D" />
                      </button>
                    </div>
                  ),
                )
              )}

              <div className="sup-add">
                <input
                  className="sup-add__input"
                  value={sec.draft}
                  placeholder={sec.placeholder}
                  aria-label={`${sec.heading} 추가`}
                  onChange={(e) => sec.setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") add(sec.kind, sec.draft, () => sec.setDraft(""));
                  }}
                />
                <button
                  type="button"
                  className="sup-add__btn hy-press"
                  aria-label={`${sec.heading} 추가 확인`}
                  onClick={() => add(sec.kind, sec.draft, () => sec.setDraft(""))}
                  disabled={upsert.isPending || !sec.draft.trim()}
                >
                  <Plus size={18} strokeWidth={2.6} color="#fff" />
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
