import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useMyFamily, useUpdateProfile } from "@/queries/useFamily";
import { useAuth } from "@/auth/AuthContext";
import { normalizePhoneForStorage } from "@/transform/phone";
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
  const { userId } = useAuth();
  const { data: family, isLoading } = useMyFamily();
  const update = useUpdateProfile();

  const parents = useMemo(
    () => (family?.members ?? []).filter((m: FamilyMember) => m.role === "parent"),
    [family],
  );
  const me = parents.find((p) => p.user_id === userId);

  const [myPhone, setMyPhone] = useState("");
  useEffect(() => {
    setMyPhone(me?.phone ? formatPhone(me.phone) : "");
  }, [me?.phone]);

  const save = () => {
    if (update.isPending) return;
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

        {isLoading ? (
          <div className="psu-card" style={{ padding: 24, textAlign: "center", color: "var(--fg-muted)" }}>
            불러오는 중…
          </div>
        ) : (
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
        )}

        <div className="psu-note">
          <span className="psu-note__lock">🔒</span>
          본인 번호만 수정할 수 있어요. 번호는 가족·담임 선생님 연결에만 사용하고 아이에게는 공개되지 않아요.
        </div>

        <button type="button" className="psu-save hy-press" onClick={save} disabled={update.isPending || !me}>
          {update.isPending ? "저장 중…" : "저장하기"}
        </button>
      </div>
    </div>
  );
}
