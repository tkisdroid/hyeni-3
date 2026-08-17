import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useIntl } from "react-intl";
import { ChevronLeft, Check, Plus, Pencil, Trash2, X } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "@/queries/useFamily";
import { useActiveChild } from "@/app/activeChild";
import { useDailySupplies, useUpsertDailySupply, useDeleteDailySupply } from "@/queries/useSchedule";
import type { DailySupply } from "@/lib/api/endpoints/schedule";
import { dateToDateKeyInTimeZone, parseAppDateKey } from "@/transform/dateKey";
import { resolveDailySupplyChildMemberId } from "@/transform/dailySupplyScope";
import {
  MAX_SUPPLY_ITEMS_PER_KIND,
  isDailySupplyLimitError,
} from "@/transform/eventSupplies";
import { useLocale } from "@/i18n/useLocale";
import { formatCalendarDay, LEGACY_FAMILY_TIME_ZONE } from "@/i18n/format";
import "./Supplies.css";

/**
 * 숙제·준비물(P-13). 부모·아이 공용 — role 로 말투 분기(부모 존댓말/아이 반말).
 * location.state.dateKey(기본 오늘)의 daily-supplies 를 읽어 체크 토글·항목 추가/이름변경/삭제를
 * 서버에 반영. 서버 daily_supplies 는 (family, child, date) 당 1행이라 대상 아이를 하나 정한다.
 */
export function Supplies() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();
  const { role, userId } = useAuth();
  const isChild = role === "child";
  const audience = isChild ? "child" : "parent";

  const dateKey = useMemo(() => {
    const fromState = (location.state as { dateKey?: string } | null)?.dateKey;
    return typeof fromState === "string" && fromState
      ? fromState
      : dateToDateKeyInTimeZone(new Date(), LEGACY_FAMILY_TIME_ZONE);
  }, [location.state]);

  const dateLabel = useMemo(() => {
    const d = parseAppDateKey(dateKey) ?? new Date();
    return formatCalendarDay(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12), {
      locale,
      timeZone: "UTC",
      weekday: "short",
    });
  }, [dateKey, locale]);

  const familyQuery = useMyFamily();
  const family = familyQuery.data;
  const childMembers = useMemo(
    () => (family?.members ?? []).filter((m) => m.role === "child"),
    [family],
  );
  // 대상 힌트: 명시적 화면 state > 부모 홈 전역 활성 아이. 실제 대상 검증은 공용 resolver 한 곳에서만 한다.
  const { activeChild } = useActiveChild();
  const targetHint = useMemo(() => {
    const fromState = (location.state as { childId?: string } | null)?.childId;
    if (fromState) return fromState;
    return activeChild?.id ?? null;
  }, [location.state, activeChild]);
  const targetChildId = useMemo(
    () => resolveDailySupplyChildMemberId(family?.members ?? [], role, userId, targetHint),
    [family?.members, role, userId, targetHint],
  );
  const targetChildName = childMembers.find((m) => m.id === targetChildId)?.name ?? "";

  const suppliesQuery = useDailySupplies(dateKey);
  // 서버 응답은 모든 아이가 섞여 있으므로 대상 아이로 필터.
  const supplies = useMemo(() => {
    const all = suppliesQuery.data ?? [];
    return targetChildId ? all.filter((s) => s.child_user_id === targetChildId) : [];
  }, [suppliesQuery.data, targetChildId]);
  const isLoading = familyQuery.isLoading || suppliesQuery.isLoading;
  const isError = familyQuery.isError || suppliesQuery.isError;
  const upsert = useUpsertDailySupply();
  const remove = useDeleteDailySupply();

  const [prepDraft, setPrepDraft] = useState("");
  const [hwDraft, setHwDraft] = useState("");
  // 이름변경 중인 항목 id + 입력값.
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingUpsertAction, setPendingUpsertAction] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const prepList = supplies.filter((s) => s.kind !== "hw");
  const hwList = supplies.filter((s) => s.kind === "hw");
  const doneCount = supplies.filter((s) => s.done).length;
  const limitMessage = (kind: "prep" | "hw") => intl.formatMessage(
    { id: kind === "hw" ? "shared.supplies.limitHomework" : "shared.supplies.limitPrep" },
    { audience, max: MAX_SUPPLY_ITEMS_PER_KIND },
  );

  const toggle = (item: DailySupply) => {
    if (editId || !targetChildId || item.child_user_id !== targetChildId) return;
    upsert.mutate(
      {
        id: item.id,
        date_key: dateKey,
        label: item.label,
        done: !item.done,
        kind: item.kind ?? "prep",
        child_user_id: targetChildId,
      },
      {
        onError: () => show(
          intl.formatMessage({ id: "shared.supplies.toggleError" }, { audience }),
          "⚠️",
        ),
      },
    );
  };

  const add = (kind: "prep" | "hw", draft: string, clear: () => void) => {
    const label = draft.trim();
    if (!label || upsert.isPending) return;
    if (!targetChildId) {
      show(intl.formatMessage({ id: "shared.supplies.addNoTarget" }, { audience }), "🎒");
      return;
    }
    const list = kind === "hw" ? hwList : prepList;
    if (list.length >= MAX_SUPPLY_ITEMS_PER_KIND) {
      show(limitMessage(kind), "🎒");
      return;
    }
    const actionKey = `add:${kind}`;
    setPendingUpsertAction(actionKey);
    upsert.mutate(
      { date_key: dateKey, label, done: false, kind, child_user_id: targetChildId },
      {
        onSuccess: clear,
        onError: (error) => show(
          isDailySupplyLimitError(error)
            ? limitMessage(kind)
            : intl.formatMessage({ id: "shared.supplies.addError" }, { audience }),
          isDailySupplyLimitError(error) ? "🎒" : "⚠️",
        ),
        onSettled: () => setPendingUpsertAction((current) => (current === actionKey ? null : current)),
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
    if (!targetChildId || item.child_user_id !== targetChildId) return;
    const label = editDraft.trim();
    if (!label) {
      cancelEdit();
      return;
    }
    if (label === item.label) {
      cancelEdit();
      return;
    }
    const actionKey = `edit:${item.id ?? ""}`;
    setPendingUpsertAction(actionKey);
    upsert.mutate(
      {
        id: item.id,
        date_key: dateKey,
        label,
        done: item.done,
        kind: item.kind ?? "prep",
        child_user_id: targetChildId,
      },
      {
        onSuccess: cancelEdit,
        onError: () => show(
          intl.formatMessage({ id: "shared.supplies.editError" }, { audience }),
          "⚠️",
        ),
        onSettled: () => setPendingUpsertAction((current) => (current === actionKey ? null : current)),
      },
    );
  };
  const del = (item: DailySupply) => {
    if (remove.isPending || !targetChildId || item.child_user_id !== targetChildId) return;
    if (editId === item.id) cancelEdit();
    const itemId = item.id ?? null;
    setPendingDeleteId(itemId);
    remove.mutate(item, {
      onError: () => show(
        intl.formatMessage({ id: "shared.supplies.deleteError" }, { audience }),
        "⚠️",
      ),
      onSettled: () => setPendingDeleteId((current) => (current === itemId ? null : current)),
    });
  };

  const sections = [
    {
      kind: "prep" as const,
      heading: intl.formatMessage({ id: "shared.supplies.prepHeading" }),
      list: prepList,
      draft: prepDraft,
      setDraft: setPrepDraft,
      placeholder: intl.formatMessage({ id: "shared.supplies.prepPlaceholder" }, { audience }),
    },
    {
      kind: "hw" as const,
      heading: intl.formatMessage({ id: "shared.supplies.homeworkHeading" }),
      list: hwList,
      draft: hwDraft,
      setDraft: setHwDraft,
      placeholder: intl.formatMessage({ id: "shared.supplies.homeworkPlaceholder" }, { audience }),
    },
  ];

  const emptyText = intl.formatMessage({ id: "shared.supplies.empty" }, { audience });

  return (
    <div className="sup-screen">
      <div className="sup-header">
        <button
          type="button"
          className="sup-back hy-press"
          aria-label={intl.formatMessage({ id: "core.action.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="sup-title">{intl.formatMessage({ id: "shared.supplies.screenTitle" })}</span>
        <span className="sup-date">{dateLabel}</span>
      </div>

      <div className="sup-content">
        <div className="sup-intro">
          <img className="sup-intro__img" src={asset("cat/study.webp")} alt="" />
          <div>
            <div className="sup-intro__title">
              {intl.formatMessage({ id: "shared.supplies.introTitle" }, { audience })}
            </div>
            <div className="sup-intro__sub">
              {isLoading
                ? intl.formatMessage({ id: "shared.supplies.loadingShort" })
                : isError
                  ? intl.formatMessage({ id: "shared.supplies.loadErrorShort" }, { audience })
                  : !targetChildId
                    ? intl.formatMessage({ id: "shared.supplies.noTargetShort" }, { audience })
                    : intl.formatMessage(
                        {
                          id: targetChildName
                            ? "shared.supplies.summaryWithChild"
                            : "shared.supplies.summary",
                        },
                        { childName: targetChildName, total: supplies.length, done: doneCount },
                      )}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="sup-status sup-status--loading" role="status">
            <span className="sup-status__spinner" aria-hidden="true" />
            <strong>{intl.formatMessage({ id: "shared.supplies.loading" })}</strong>
          </div>
        ) : isError ? (
          <div className="sup-status sup-status--error" role="alert">
            <strong>{intl.formatMessage({ id: "shared.supplies.loadErrorTitle" }, { audience })}</strong>
            <span>{intl.formatMessage({ id: "shared.supplies.loadErrorDescription" }, { audience })}</span>
            <button
              type="button"
              className="sup-status__retry hy-press"
              onClick={() => void Promise.all([familyQuery.refetch(), suppliesQuery.refetch()])}
            >
              {intl.formatMessage({ id: "core.action.retry" })}
            </button>
          </div>
        ) : !targetChildId ? (
          <div className="sup-status sup-status--no-target">
            <strong>{intl.formatMessage({ id: "shared.supplies.noTargetTitle" }, { audience })}</strong>
            <span>
              {intl.formatMessage({ id: "shared.supplies.noTargetDescription" }, { audience })}
            </span>
          </div>
        ) : sections.map((sec) => (
          <section key={sec.kind} className="sup-section">
            <div className="sup-section__head">
              <span className="sup-section__title">{sec.heading}</span>
              <span className="sup-section__count">{sec.list.length}/{MAX_SUPPLY_ITEMS_PER_KIND}</span>
            </div>
            <div className="sup-card">
              {sec.list.length === 0 ? (
                <div className="sup-empty">{emptyText}</div>
              ) : (
                sec.list.map((s) =>
                  editId === s.id ? (
                    <div key={s.id} className="sup-row">
                      <input
                        className="sup-edit-input"
                        value={editDraft}
                        autoFocus
                        aria-label={intl.formatMessage({ id: "shared.supplies.editInputAria" })}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(s);
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <button
                        type="button"
                        className="sup-iconbtn hy-press"
                        aria-label={intl.formatMessage({ id: "shared.supplies.editSaveAria" })}
                        onClick={() => commitEdit(s)}
                        disabled={upsert.isPending || !editDraft.trim()}
                        aria-busy={upsert.isPending && pendingUpsertAction === `edit:${s.id ?? ""}`}
                      >
                        <Check size={16} strokeWidth={2.6} color="var(--hy-accent-text)" />
                      </button>
                      <button
                        type="button"
                        className="sup-iconbtn hy-press"
                        aria-label={intl.formatMessage({ id: "shared.supplies.editCancelAria" })}
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
                        aria-label={intl.formatMessage({ id: "shared.supplies.toggleAria" })}
                        onClick={() => toggle(s)}
                        style={{
                          background: s.done ? "var(--hy-accent-cta)" : "#fff",
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
                        aria-label={intl.formatMessage({ id: "shared.supplies.editAria" })}
                        onClick={() => startEdit(s)}
                      >
                        <Pencil size={15} strokeWidth={2.2} color="var(--fg-faint)" />
                      </button>
                      <button
                        type="button"
                        className="sup-iconbtn hy-press"
                        aria-label={intl.formatMessage({ id: "shared.supplies.deleteAria" })}
                        onClick={() => del(s)}
                        disabled={remove.isPending}
                        aria-busy={remove.isPending && pendingDeleteId === s.id}
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
                  placeholder={sec.list.length >= MAX_SUPPLY_ITEMS_PER_KIND
                    ? intl.formatMessage(
                        { id: "shared.supplies.limitPlaceholder" },
                        { audience, max: MAX_SUPPLY_ITEMS_PER_KIND },
                      )
                    : sec.placeholder}
                  aria-label={intl.formatMessage(
                    { id: "shared.supplies.addAria" },
                    { item: sec.heading },
                  )}
                  disabled={sec.list.length >= MAX_SUPPLY_ITEMS_PER_KIND}
                  onChange={(e) => sec.setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") add(sec.kind, sec.draft, () => sec.setDraft(""));
                  }}
                />
                <button
                  type="button"
                  className="sup-add__btn hy-press"
                  aria-label={intl.formatMessage(
                    { id: "shared.supplies.addConfirmAria" },
                    { item: sec.heading },
                  )}
                  onClick={() => add(sec.kind, sec.draft, () => sec.setDraft(""))}
                  disabled={upsert.isPending || !sec.draft.trim() || sec.list.length >= MAX_SUPPLY_ITEMS_PER_KIND}
                  aria-busy={upsert.isPending && pendingUpsertAction === `add:${sec.kind}`}
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
