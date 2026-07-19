import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Camera } from "lucide-react";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { useMyFamily, useSetChildProfile, useUploadChildPhoto } from "@/queries/useFamily";
import { resizeImageFileSafe } from "@/lib/imageResize";
import { normalizeRequiredChildBirthdate } from "@/transform/childProfileRequirements";
import { normalizePhoneForStorage } from "@/transform/phone";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "./ProfileEdit.css";

function normalizeHex(v: string | null | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(t) ? t : undefined;
}

// 생년월일 문자열("YYYY-MM-DD") → 만 나이. 런타임 계산(정적 추정 아님).
function ageFromBirthdate(bd: string | null | undefined, now: Date): number | null {
  if (!bd) return null;
  const d = new Date(`${bd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

// Date → date input 값("YYYY-MM-DD"). max 속성/프리필용(멘탈 날짜계산 아님·런타임 포맷).
function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

// 저장값(가끔 ISO 타임스탬프) → date input 이 받는 "YYYY-MM-DD" 앞 10자리만.
function toDateFieldValue(bd: string | null | undefined): string {
  if (!bd) return "";
  const m = String(bd).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
}

// 저장형/원시 전화 → 화면 표시용 "010-0000-0000"(숫자만 추출 후 하이픈).
function formatPhoneDisplay(v: string | null | undefined): string {
  const d = String(v || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

/**
 * 프로필 편집 (P-03 → 편집). 대상 아이(location.state.childId)의 전 정보를 실제 저장한다.
 * - 사진: 파일 선택 → 리사이즈 → R2 업로드(주 보호자만).
 * - 이름·생일·전화: 서버 member/profile(주 보호자만). 저장 시 notifyPg 로 아이 기기 실시간 반영.
 * 대상 = location.state.childId(없으면 첫 자녀). 현재값을 해당 아이 멤버에서 프리필한다.
 */
export function ProfileEdit() {
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const childId = (routeLocation.state as { childId?: string } | null)?.childId ?? null;
  const { show } = useToast();
  const { familyId } = useAuth();
  const now = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => toDateInputValue(now), [now]);

  const familyQuery = useMyFamily();
  const family = familyQuery.data;
  const saveProfile = useSetChildProfile();
  const uploadPhoto = useUploadChildPhoto();

  // 대상 아이 멤버(state.childId > 전역 활성 아이) + 자동 색상 배정용 index.
  // 첫째 무조건 폴백 제거 — 앱 재기동 등으로 state 소실 시 엉뚱한 아이 프로필을 덮어쓰는 사고 방지.
  const { activeChild } = useActiveChild();
  const children = useMemo(() => (family?.members ?? []).filter((m) => m.role === "child"), [family]);
  const member = useMemo(
    () => children.find((m) => m.id === childId) ?? activeChild ?? null,
    [children, childId, activeChild],
  );
  const colorIndex = useMemo(() => {
    if (!member) return 0;
    if (member.child_order != null) return Math.max(0, member.child_order - 1);
    const idx = children.findIndex((m) => m.id === member.id);
    return idx >= 0 ? idx : 0;
  }, [member, children]);

  const profileQueryState = resolveQueryTruthState([
    { isLoading: familyQuery.isLoading, isError: familyQuery.isError },
  ]);
  const profileSourceKey = familyId
    && family?.familyId === familyId
    && member
    ? JSON.stringify([
        familyId,
        member.id,
        member.name ?? "",
        toDateFieldValue(member.birthdate),
        formatPhoneDisplay(member.phone),
      ])
    : null;

  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [phone, setPhone] = useState("");
  const [pickedDataUrl, setPickedDataUrl] = useState<string | null>(null);
  const [hydratedProfileSourceKey, setHydratedProfileSourceKey] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const profileFormReady = profileQueryState === "ready"
    && profileSourceKey !== null
    && hydratedProfileSourceKey === profileSourceKey;
  const profileFormHydrating = profileQueryState === "ready"
    && profileSourceKey !== null
    && !profileFormReady;

  // 현재 가족·아이의 서버 snapshot을 폼에 반영한 뒤에만 수정 UI를 연다.
  // 같은 snapshot에서 사용자가 입력 중이면 query 객체가 바뀌어도 초안을 덮어쓰지 않는다.
  useEffect(() => {
    if (!member || !profileSourceKey) {
      setHydratedProfileSourceKey(null);
      setPickedDataUrl(null);
      return;
    }
    if (hydratedProfileSourceKey === profileSourceKey) return;
    setName(member.name || "");
    setBirthday(toDateFieldValue(member.birthdate));
    setPhone(formatPhoneDisplay(member.phone));
    setPickedDataUrl(null);
    setHydratedProfileSourceKey(profileSourceKey);
  }, [hydratedProfileSourceKey, member, profileSourceKey]);

  const isPrimary = family?.isPrimaryParent ?? false;
  const busy = uploadPhoto.isPending || saveProfile.isPending;
  const age = ageFromBirthdate(birthday, now); // 폼의 현재 생일로 즉시 계산.
  // 미리보기: 방금 고른 사진 > 저장된 사진(proxy URL) > 없음(카메라 placeholder).
  const savedPhoto = member?.photo_url && member.photo_url.startsWith("http") ? member.photo_url : null;
  const previewSrc = pickedDataUrl ?? savedPhoto;
  const retryProfileEdit = async (): Promise<void> => {
    await familyQuery.refetch();
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
    if (!profileFormReady) {
      show("현재 아이의 프로필을 불러온 뒤 다시 시도해 주세요", "⚠️");
      return;
    }
    if (!isPrimary) {
      show("주 보호자만 사진을 바꿀 수 있어요", "🔒");
      return;
    }
    setProcessing(true);
    try {
      const dataUrl = await resizeImageFileSafe(file, { maxEdge: 1280, quality: 0.8 });
      if (!dataUrl) {
        show("사진을 불러오지 못했어요", "⚠️");
        return;
      }
      setPickedDataUrl(dataUrl);
    } finally {
      setProcessing(false);
    }
  };

  const onSave = async () => {
    if (busy) return;
    if (!profileFormReady) {
      show("현재 아이의 프로필을 불러온 뒤 다시 시도해 주세요", "⚠️");
      return;
    }
    if (!member) {
      show("아이 정보를 찾지 못했어요", "⚠️");
      return;
    }
    if (!name.trim()) {
      show("이름을 입력해주세요", "✏️");
      return;
    }
    if (!isPrimary) {
      show("주 보호자만 아이 프로필을 수정할 수 있어요", "🔒");
      return;
    }

    // 생일은 AI 친구의 연령대 맞춤 답변 기준이라 부모 화면에서는 비워서 저장하지 않는다.
    const birthdateToSave = normalizeRequiredChildBirthdate(birthday);
    if (!birthdateToSave) {
      show(birthday.trim() ? "생일을 올바르게 입력해주세요" : "생일을 입력해주세요", "🎂");
      return;
    }

    // 전화: 빈 값이면 null(지움), 값이 있으면 저장형으로 정규화(형식 오류 시 차단).
    let phoneToSave: string | null = null;
    if (phone.replace(/\D/g, "")) {
      try {
        phoneToSave = normalizePhoneForStorage(phone);
      } catch (e) {
        show(e instanceof Error ? e.message : "전화번호를 확인해주세요", "📱");
        return;
      }
    }

    try {
      if (pickedDataUrl) {
        await uploadPhoto.mutateAsync({ memberId: member.id, dataUrl: pickedDataUrl });
      }
      await saveProfile.mutateAsync({
        memberId: member.id,
        name: name.trim(),
        colorHex: normalizeHex(member.color_hex),
        colorIndex,
        birthdate: birthdateToSave,
        phone: phoneToSave,
      });
      show("저장했어요. 아이 기기에 실시간으로 반영돼요", "✅");
      navigate(-1);
    } catch (e) {
      show(e instanceof Error ? e.message : "저장에 실패했어요", "⚠️");
    }
  };

  if (profileQueryState === "loading" || profileFormHydrating) {
    return (
      <ScreenQueryState
        screenTitle="프로필 편집"
        state="loading"
        heading="아이 정보를 불러오고 있어요"
        description="수정할 아이의 최신 프로필을 확인하는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (profileQueryState === "error") {
    return (
      <ScreenQueryState
        screenTitle="프로필 편집"
        state="error"
        heading="아이 정보를 불러오지 못했어요"
        description="기존 프로필을 확인하지 못한 상태에서는 덮어쓰지 않아요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryProfileEdit()}
        retrying={familyQuery.isFetching}
      />
    );
  }

  if (!member) {
    return (
      <ScreenQueryState
        screenTitle="프로필 편집"
        state="empty"
        heading="수정할 아이를 찾지 못했어요"
        description="아이 선택 상태나 가족 연결을 다시 확인해 주세요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryProfileEdit()}
        retrying={familyQuery.isFetching}
        retryLabel="아이 정보 다시 확인"
      />
    );
  }

  return (
    <div className="pe-root">
      <header className="pe-header">
        <button type="button" className="hy-iconbtn hy-press pe-back" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="pe-title">프로필 편집</span>
      </header>

      <div className="pe-content">
        {member && (
          <>
            {/* 사진 등록 + 미리보기 */}
            <div className="pe-photo-wrap">
              <button
                type="button"
                className="pe-photo hy-press"
                onClick={() => fileRef.current?.click()}
                disabled={!profileFormReady || !isPrimary || processing}
                aria-label="사진 선택"
              >
                {previewSrc ? (
                  <img src={previewSrc} alt="" loading="eager" decoding="async" />
                ) : (
                  <span className="pe-photo__empty">
                    <Camera size={30} strokeWidth={2} />
                    <span>사진 추가</span>
                  </span>
                )}
                <span className="pe-photo__edit" aria-hidden="true">
                  <Camera size={15} strokeWidth={2.4} color="#fff" />
                </span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden disabled={!profileFormReady} onChange={onPickFile} />
              <div className="pe-photo-name">{name.trim() || member.name || "아이"}</div>
              <p className="pe-hint">{processing ? "사진 처리 중…" : "얼굴이 잘 보이는 사진이 좋아요."}</p>
            </div>

            {/* 이름 */}
            <div className="pe-field">
              <div className="pe-label pe-label--sm">이름</div>
              <input
                className="pe-input"
                aria-label="이름"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름"
                maxLength={20}
                disabled={!profileFormReady || !isPrimary}
              />
            </div>

            {/* 생일(input type=date) + 나이 자동표시 */}
            <div className="pe-field">
              <div className="pe-label pe-label--sm pe-label--row">
                <span>생일 *</span>
                {age != null && <span className="pe-age">만 {age}세</span>}
              </div>
              <input
                className="pe-input pe-input--date"
                type="date"
                aria-label="생일"
                value={birthday}
                max={todayStr}
                onChange={(e) => setBirthday(e.target.value)}
                disabled={!profileFormReady || !isPrimary}
              />
              <p className="pe-hint">AI 친구가 아이 나이에 맞게 말하도록 꼭 필요해요.</p>
            </div>

            {/* 전화번호 */}
            <div className="pe-field">
              <div className="pe-label pe-label--sm">전화번호</div>
              <input
                className="pe-input"
                type="tel"
                aria-label="전화번호"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(formatPhoneDisplay(e.target.value))}
                placeholder="010-0000-0000"
                maxLength={13}
                disabled={!profileFormReady || !isPrimary}
              />
              <p className="pe-hint">아이 기기가 없어도 연락할 번호예요.</p>
            </div>

            {!isPrimary && <p className="pe-hint pe-hint--warn">주 보호자만 아이 프로필을 저장할 수 있어요.</p>}

            <button
              type="button"
              className="pe-save hy-press"
              onClick={onSave}
              disabled={!profileFormReady || busy || !isPrimary}
            >
              {busy ? "저장 중…" : "저장하기"}
            </button>
            {isPrimary && (
              <p className="pe-hint pe-hint--center">변경한 내용은 아이 기기에 실시간으로 반영돼요.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
