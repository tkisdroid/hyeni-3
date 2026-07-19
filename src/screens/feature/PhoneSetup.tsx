import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Lock } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { useMyFamily, useUpdateProfile } from "@/queries/useFamily";
import { useAuth } from "@/auth/AuthContext";
import { normalizePhoneForStorage } from "@/transform/phone";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import type { FamilyMember } from "@/lib/api/endpoints/family";
import "./PhoneSetup.css";

/** 숫자만 남겨 010-0000-0000 형태로 정규화(표시용). */
function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

function roleLabel(gender: string | null | undefined): string {
  if (gender === "mom") return "엄마";
  if (gender === "dad") return "아빠";
  return "보호자";
}

function avatarFor(gender: string | null | undefined): string {
  return gender === "dad" ? "family/dad.webp" : "family/mom.webp";
}

function softFor(gender: string | null | undefined): string {
  return gender === "dad" ? "#E6F2FB" : "#FDE7F1";
}

/** 전화번호 설정: 실 보호자 목록 표시. 본인 번호만 편집(백엔드는 본인 프로필만 수정 가능). */
export function PhoneSetup() {
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
    setMyPhone(me?.phone ? formatPhone(me.phone) : "");
    setHydratedPhoneSourceKey(phoneSourceKey);
  }, [hydratedPhoneSourceKey, me, phoneSourceKey]);

  const save = () => {
    if (update.isPending) return;
    if (!phoneFormReady || !me) {
      show("현재 계정의 전화번호를 불러온 뒤 다시 시도해 주세요", "⚠️");
      return;
    }
    let phone: string;
    try {
      phone = normalizePhoneForStorage(myPhone);
    } catch (e) {
      show(e instanceof Error ? e.message : "번호를 확인해 주세요", "⚠️");
      return;
    }
    update.mutate(
      { phone },
      {
        onSuccess: () => show("전화번호를 저장했어요", "📞"),
        onError: (e) => show(e instanceof Error ? e.message : "저장에 실패했어요", "⚠️"),
      },
    );
  };

  if (phoneQueryState === "loading" || phoneFormHydrating) {
    return (
      <ScreenQueryState
        screenTitle="전화번호 설정"
        state="loading"
        heading="가족 정보를 불러오고 있어요"
        description="전화번호를 안전하게 연결할 보호자를 확인하는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (phoneQueryState === "error") {
    return (
      <ScreenQueryState
        screenTitle="전화번호 설정"
        state="error"
        heading="가족 정보를 불러오지 못했어요"
        description="본인 보호자 행을 확인한 뒤에만 전화번호를 변경할 수 있어요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryPhoneSetup()}
        retrying={familyQuery.isFetching}
      />
    );
  }

  if (phoneDataEmpty) {
    return (
      <ScreenQueryState
        screenTitle="전화번호 설정"
        state="empty"
        heading="연결된 보호자 정보가 없어요"
        description="가족 연결 상태를 다시 확인해 주세요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryPhoneSetup()}
        retrying={familyQuery.isFetching}
        retryLabel="가족 정보 다시 확인"
      />
    );
  }

  return (
    <div className="psu-screen">
      <div className="psu-header">
        <button
          type="button"
          className="psu-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="psu-title">전화번호 설정</span>
      </div>

      <div className="psu-content">
        <div className="psu-intro">
          <img className="psu-intro__img" src={asset("ui/phone-lavender.webp")} alt="" />
          <div>
            <div className="psu-intro__title">가족 전화번호</div>
            <div className="psu-intro__sub">SOS 연결과 선생님 매칭에 쓰여요</div>
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
                    {roleLabel(g.gender)}
                    {isMe ? " · 나" : ""}
                  </span>
                  {isMe ? (
                    <input
                      className="psu-row__input"
                      value={myPhone}
                      onChange={(e) => setMyPhone(formatPhone(e.target.value))}
                      placeholder="010-0000-0000"
                      inputMode="numeric"
                      aria-label={`${roleLabel(g.gender)} 전화번호`}
                      disabled={!phoneFormReady || update.isPending}
                    />
                  ) : (
                    <span className="psu-row__input" style={{ color: "var(--fg-muted)", display: "flex", alignItems: "center" }}>
                      {g.phone ? formatPhone(g.phone) : "미등록"}
                    </span>
                  )}
                </div>
              );
          })}
        </div>

        <div className="psu-note">
          <span className="psu-note__lock" aria-hidden="true">
            <Lock size={18} strokeWidth={2.2} />
          </span>
          본인 번호만 수정할 수 있어요. 번호는 가족·담임 선생님 연결에만 사용하고 아이에게는 공개되지 않아요.
        </div>

        <button
          type="button"
          className="psu-save hy-press"
          onClick={save}
          disabled={!phoneFormReady || update.isPending || !me}
        >
          {update.isPending ? "저장 중…" : "저장하기"}
        </button>
      </div>
    </div>
  );
}
