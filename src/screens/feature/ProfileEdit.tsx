import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft, Camera } from "lucide-react";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useActiveChild } from "@/app/activeChild";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { useMyFamily, useSetChildProfile, useUploadChildPhoto } from "@/queries/useFamily";
import { resizeImageFileSafe } from "@/lib/imageResize";
import { normalizeRequiredChildBirthdate } from "@/transform/childProfileRequirements";
import { normalizePhoneForStorage } from "@/transform/phone";
import { formatPhoneDisplay } from "@/transform/phoneFormat";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "./ProfileEdit.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

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

/**
 * 프로필 편집 (P-03 → 편집). 대상 아이(location.state.childId)의 전 정보를 실제 저장한다.
 * - 사진: 파일 선택 → 리사이즈 → R2 업로드(주 보호자만).
 * - 이름·생일·전화: 서버 member/profile(주 보호자만). 저장 시 notifyPg 로 아이 기기 실시간 반영.
 * 대상 = location.state.childId > 전역 활성 아이. 둘 다 없으면 닫고 첫 자녀로 대체하지 않는다.
 */
export function ProfileEdit() {
  const intl = useIntl();
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
  // 미리보기: 방금 고른 사진 > 저장된 사진(blob URL) > 없음(카메라 placeholder).
  const savedPhoto = member?.photo_url
    && (member.photo_url.startsWith("http") || member.photo_url.startsWith("blob:"))
    ? member.photo_url
    : null;
  const previewSrc = pickedDataUrl ?? savedPhoto;
  const retryProfileEdit = async (): Promise<void> => {
    await familyQuery.refetch();
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
    if (!profileFormReady) {
      show(intl.formatMessage({ id: "parent.profileEdit.error.notReady" }), "⚠️");
      return;
    }
    if (!isPrimary) {
      show(intl.formatMessage({ id: "parent.profileEdit.error.primaryPhotoOnly" }), "🔒");
      return;
    }
    setProcessing(true);
    try {
      const dataUrl = await resizeImageFileSafe(file, { maxEdge: 1280, quality: 0.8 });
      if (!dataUrl) {
        show(intl.formatMessage({ id: "parent.profileEdit.error.photoLoad" }), "⚠️");
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
      show(intl.formatMessage({ id: "parent.profileEdit.error.notReady" }), "⚠️");
      return;
    }
    if (!member) {
      show(intl.formatMessage({ id: "parent.profileEdit.error.childMissing" }), "⚠️");
      return;
    }
    if (!name.trim()) {
      show(intl.formatMessage({ id: "parent.profileEdit.error.nameRequired" }), "✏️");
      return;
    }
    if (!isPrimary) {
      show(intl.formatMessage({ id: "parent.profileEdit.error.primaryEditOnly" }), "🔒");
      return;
    }

    // 생일은 AI 친구의 연령대 맞춤 답변 기준이라 부모 화면에서는 비워서 저장하지 않는다.
    const birthdateToSave = normalizeRequiredChildBirthdate(birthday);
    if (!birthdateToSave) {
      show(intl.formatMessage({
        id: birthday.trim()
          ? "parent.profileEdit.error.birthdateInvalid"
          : "parent.profileEdit.error.birthdateRequired",
      }), "🎂");
      return;
    }

    // 전화: 빈 값이면 null(지움), 값이 있으면 저장형으로 정규화(형식 오류 시 차단).
    let phoneToSave: string | null = null;
    if (phone.replace(/\D/g, "")) {
      try {
        phoneToSave = normalizePhoneForStorage(phone);
      } catch (e) {
        show(localizeApiError(e, intl, "formal"), "📱");
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
      show(intl.formatMessage({ id: "parent.profileEdit.saved" }), "✅");
      navigate(-1);
    } catch (e) {
      show(localizeApiError(e, intl, "formal"), "⚠️");
    }
  };

  if (profileQueryState === "loading" || profileFormHydrating) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "parent.profileEdit.screenTitle" })}
        state="loading"
        heading={intl.formatMessage({ id: "parent.profileEdit.loading.heading" })}
        description={intl.formatMessage({ id: "parent.profileEdit.loading.description" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (profileQueryState === "error") {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "parent.profileEdit.screenTitle" })}
        state="error"
        heading={intl.formatMessage({ id: "parent.profileEdit.loadError.heading" })}
        description={intl.formatMessage({ id: "parent.profileEdit.loadError.description" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryProfileEdit()}
        retrying={familyQuery.isFetching}
      />
    );
  }

  if (!member) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "parent.profileEdit.screenTitle" })}
        state="empty"
        heading={intl.formatMessage({ id: "parent.profileEdit.empty.heading" })}
        description={intl.formatMessage({ id: "parent.profileEdit.empty.description" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryProfileEdit()}
        retrying={familyQuery.isFetching}
        retryLabel={intl.formatMessage({ id: "parent.profileEdit.empty.retry" })}
      />
    );
  }

  return (
    <div className="pe-root">
      <header className="pe-header">
        <button
          type="button"
          className="hy-iconbtn hy-press pe-back"
          aria-label={intl.formatMessage({ id: "parent.profileEdit.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="pe-title">
          {intl.formatMessage({ id: "parent.profileEdit.screenTitle" })}
        </span>
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
                aria-label={intl.formatMessage({ id: "parent.profileEdit.photo.select" })}
              >
                {previewSrc ? (
                  <img src={previewSrc} alt="" loading="eager" decoding="async" />
                ) : (
                  <span className="pe-photo__empty">
                    <Camera size={30} strokeWidth={2} />
                    <span>{intl.formatMessage({ id: "parent.profileEdit.photo.add" })}</span>
                  </span>
                )}
                <span className="pe-photo__edit" aria-hidden="true">
                  <Camera size={15} strokeWidth={2.4} color="#fff" />
                </span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden disabled={!profileFormReady} onChange={onPickFile} />
              <div className="pe-photo-name">
                {name.trim() || member.name || intl.formatMessage({ id: "parent.profileEdit.childFallback" })}
              </div>
              <p className="pe-hint hy-explain">
                {processing
                  ? intl.formatMessage({ id: "parent.profileEdit.photo.processing" })
                  : intl.formatMessage({ id: "parent.profileEdit.photo.hint" })}
              </p>
            </div>

            {/* 이름 */}
            <div className="pe-field">
              <div className="pe-label pe-label--sm">
                {intl.formatMessage({ id: "parent.profileEdit.name.label" })}
              </div>
              <input
                className="pe-input"
                aria-label={intl.formatMessage({ id: "parent.profileEdit.name.label" })}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={intl.formatMessage({ id: "parent.profileEdit.name.placeholder" })}
                maxLength={20}
                disabled={!profileFormReady || !isPrimary}
              />
            </div>

            {/* 생일(input type=date) + 나이 자동표시 */}
            <div className="pe-field">
              <div className="pe-label pe-label--sm pe-label--row">
                <span>{intl.formatMessage({ id: "parent.profileEdit.birthdate.label" })}</span>
                {age != null && (
                  <span className="pe-age">
                    {intl.formatMessage({ id: "parent.profileEdit.age" }, { age })}
                  </span>
                )}
              </div>
              <input
                className="pe-input pe-input--date"
                type="date"
                aria-label={intl.formatMessage({ id: "parent.profileEdit.birthdate.aria" })}
                value={birthday}
                max={todayStr}
                onChange={(e) => setBirthday(e.target.value)}
                disabled={!profileFormReady || !isPrimary}
              />
              <p className="pe-hint hy-explain">
                {intl.formatMessage({ id: "parent.profileEdit.birthdate.hint" })}
              </p>
            </div>

            {/* 전화번호 */}
            <div className="pe-field">
              <div className="pe-label pe-label--sm">
                {intl.formatMessage({ id: "parent.profileEdit.phone.label" })}
              </div>
              <input
                className="pe-input"
                type="tel"
                aria-label={intl.formatMessage({ id: "parent.profileEdit.phone.label" })}
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(formatPhoneDisplay(e.target.value))}
                placeholder={intl.formatMessage({ id: "parent.profileEdit.phone.placeholder" })}
                maxLength={13}
                disabled={!profileFormReady || !isPrimary}
              />
            </div>

            {!isPrimary && (
              <p className="pe-hint pe-hint--warn">
                {intl.formatMessage({ id: "parent.profileEdit.primaryWarning" })}
              </p>
            )}

            <button
              type="button"
              className="pe-save hy-press"
              onClick={onSave}
              disabled={!profileFormReady || busy || !isPrimary} aria-busy={busy}
            >
              {busy
                ? intl.formatMessage({ id: "parent.profileEdit.save.pending" })
                : intl.formatMessage({ id: "parent.profileEdit.save.button" })}
            </button>
            {isPrimary && (
              <p className="pe-hint pe-hint--center hy-explain">
                {intl.formatMessage({ id: "parent.profileEdit.realtimeHint" })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
