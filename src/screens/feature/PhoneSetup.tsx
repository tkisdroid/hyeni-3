import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, Lock } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { useMyFamily, useUpdateProfile } from "@/queries/useFamily";
import { useAuth } from "@/auth/AuthContext";
import { normalizePhoneForStorage } from "@/transform/phone";
import { formatPhoneDisplay } from "@/transform/phoneFormat";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import type { FamilyMember } from "@/lib/api/endpoints/family";
import "./PhoneSetup.css";
import { useIntl, type IntlShape } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

function roleLabel(gender: string | null | undefined, intl: IntlShape): string {
  if (gender === "mom") return intl.formatMessage({ id: "parent.phoneSetup.role.mom" });
  if (gender === "dad") return intl.formatMessage({ id: "parent.phoneSetup.role.dad" });
  return intl.formatMessage({ id: "parent.phoneSetup.role.guardian" });
}

function avatarFor(gender: string | null | undefined): string {
  return gender === "dad" ? "family/dad.webp" : "family/mom.webp";
}

function softFor(gender: string | null | undefined): string {
  return gender === "dad" ? "var(--blue-soft)" : "var(--rose-soft)";
}

/** 전화번호 설정: 실 보호자 목록 표시. 본인 번호만 편집(백엔드는 본인 프로필만 수정 가능). */
export function PhoneSetup() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { show } = useToast();
  const { userId, familyId } = useAuth();
  const familyQuery = useMyFamily();
  const family = familyQuery.data;
  const update = useUpdateProfile();

  const parents = useMemo(
    () => (family?.members ?? []).filter((m: FamilyMember) => m.role === "parent"),
    [family],
  );
  const phoneQueryState = resolveQueryTruthState([
    { isLoading: familyQuery.isLoading, isError: familyQuery.isError },
  ]);
  const noParents = family && parents.length === 0;
  const phoneDataEmpty = phoneQueryState === "ready" && (!family || noParents);
  const retryPhoneSetup = async (): Promise<void> => {
    await familyQuery.refetch();
  };
  const me = parents.find((p) => p.user_id === userId);
  const phoneSourceKey = familyId
    && family?.familyId === familyId
    && userId
    && me?.user_id === userId
    ? JSON.stringify([familyId, userId, me.id, me.phone ?? ""])
    : null;

  const [myPhone, setMyPhone] = useState("");
  const [hydratedPhoneSourceKey, setHydratedPhoneSourceKey] = useState<string | null>(null);
  const phoneFormReady = phoneQueryState === "ready"
    && phoneSourceKey !== null
    && hydratedPhoneSourceKey === phoneSourceKey;
  const phoneFormHydrating = phoneQueryState === "ready"
    && phoneSourceKey !== null
    && !phoneFormReady;

  useEffect(() => {
    if (!me || !phoneSourceKey) {
      setHydratedPhoneSourceKey(null);
      return;
    }
    if (hydratedPhoneSourceKey === phoneSourceKey) return;
    setMyPhone(me?.phone ? formatPhoneDisplay(me.phone) : "");
    setHydratedPhoneSourceKey(phoneSourceKey);
  }, [hydratedPhoneSourceKey, me, phoneSourceKey]);

  const save = () => {
    if (update.isPending) return;
    if (!phoneFormReady || !me) {
      show(intl.formatMessage({ id: "parent.phoneSetup.error.notReady" }), "⚠️");
      return;
    }
    let phone: string;
    try {
      phone = normalizePhoneForStorage(myPhone);
    } catch (e) {
      show(localizeApiError(e, intl, "formal"), "⚠️");
      return;
    }
    update.mutate(
      { phone },
      {
        onSuccess: () => show(intl.formatMessage({ id: "parent.phoneSetup.saved" }), "📞"),
        onError: (e) => show(localizeApiError(e, intl, "formal"), "⚠️"),
      },
    );
  };

  if (phoneQueryState === "loading" || phoneFormHydrating) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "parent.phoneSetup.screenTitle" })}
        state="loading"
        heading={intl.formatMessage({ id: "parent.phoneSetup.loading.heading" })}
        description={intl.formatMessage({ id: "parent.phoneSetup.loading.description" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (phoneQueryState === "error") {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "parent.phoneSetup.screenTitle" })}
        state="error"
        heading={intl.formatMessage({ id: "parent.phoneSetup.loadError.heading" })}
        description={intl.formatMessage({ id: "parent.phoneSetup.loadError.description" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryPhoneSetup()}
        retrying={familyQuery.isFetching}
      />
    );
  }

  if (phoneDataEmpty) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "parent.phoneSetup.screenTitle" })}
        state="empty"
        heading={intl.formatMessage({ id: "parent.phoneSetup.empty.heading" })}
        description={intl.formatMessage({ id: "parent.phoneSetup.empty.description" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryPhoneSetup()}
        retrying={familyQuery.isFetching}
        retryLabel={intl.formatMessage({ id: "parent.phoneSetup.empty.retry" })}
      />
    );
  }

  return (
    <div className="psu-screen">
      <div className="psu-header">
        <button
          type="button"
          className="psu-back hy-press"
          aria-label={intl.formatMessage({ id: "parent.phoneSetup.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="psu-title">
          {intl.formatMessage({ id: "parent.phoneSetup.screenTitle" })}
        </span>
      </div>

      <div className="psu-content">
        <div className="psu-intro">
          <img className="psu-intro__img" src={asset("ui/phone-lavender.webp")} alt="" />
          <div>
            <div className="psu-intro__title">
              {intl.formatMessage({ id: "parent.phoneSetup.intro.title" })}
            </div>
            <div className="psu-intro__sub">
              {intl.formatMessage({ id: "parent.phoneSetup.intro.description" })}
            </div>
          </div>
        </div>

        <div className="psu-card">
          {parents.map((g) => {
              const isMe = g.user_id === userId;
              return (
                <div key={g.id} className="psu-row">
                  <span className="psu-row__avatar" style={{ background: softFor(g.gender) }}>
                    <img src={asset(avatarFor(g.gender))} alt="" />
                  </span>
                  <span className="psu-row__role">
                    {roleLabel(g.gender, intl)}
                    {isMe ? intl.formatMessage({ id: "parent.phoneSetup.role.current" }) : ""}
                  </span>
                  {isMe ? (
                    <input
                      className="psu-row__input"
                      value={myPhone}
                      onChange={(e) => setMyPhone(formatPhoneDisplay(e.target.value))}
                      placeholder={intl.formatMessage({ id: "parent.phoneSetup.phonePlaceholder" })}
                      inputMode="numeric"
                      aria-label={intl.formatMessage(
                        { id: "parent.phoneSetup.phoneAria" },
                        { role: roleLabel(g.gender, intl) },
                      )}
                      disabled={!phoneFormReady || update.isPending}
                    />
                  ) : (
                    <span className="psu-row__input" style={{ color: "var(--fg-muted)", display: "flex", alignItems: "center" }}>
                      {g.phone
                        ? formatPhoneDisplay(g.phone)
                        : intl.formatMessage({ id: "parent.phoneSetup.phoneMissing" })}
                    </span>
                  )}
                </div>
              );
          })}
        </div>

        <div className="psu-note hy-explain">
          <span className="psu-note__lock" aria-hidden="true">
            <Lock size={18} strokeWidth={2.2} />
          </span>
          <span className="hy-explain__lines">
            <span className="hy-explain__line">
              {intl.formatMessage({ id: "parent.phoneSetup.note.selfOnly" })}
            </span>
            <span className="hy-explain__line">
              {intl.formatMessage({ id: "parent.phoneSetup.note.privacy" })}
            </span>
          </span>
        </div>

        <button
          type="button"
          className="psu-save hy-press"
          onClick={save}
          disabled={!phoneFormReady || update.isPending || !me} aria-busy={update.isPending}
        >
          {update.isPending
            ? intl.formatMessage({ id: "parent.phoneSetup.save.pending" })
            : intl.formatMessage({ id: "parent.phoneSetup.save.button" })}
        </button>
      </div>
    </div>
  );
}
