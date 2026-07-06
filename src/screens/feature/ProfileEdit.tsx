import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Camera } from "lucide-react";
import { useToast } from "@/app/toast";
import { useActiveChild } from "@/app/activeChild";
import { useMyFamily, useSetChildProfile, useUploadChildPhoto } from "@/queries/useFamily";
import { resizeImageFileSafe } from "@/lib/imageResize";
import { normalizeBirthdate, normalizePhoneForStorage } from "@/transform/phone";
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
  const now = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => toDateInputValue(now), [now]);

  const { data: family, isLoading } = useMyFamily();
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

  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [phone, setPhone] = useState("");
  const [pickedDataUrl, setPickedDataUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const initedFor = useRef<string | null>(null);

  // 멤버가 로드되면(비동기) 폼 값을 1회 초기화한다(이름·생일·전화 프리필).
  useEffect(() => {
    if (!member || initedFor.current === member.id) return;
    initedFor.current = member.id;
    setName(member.name || "");
    setBirthday(toDateFieldValue(member.birthdate));
    setPhone(formatPhoneDisplay(member.phone));
    setPickedDataUrl(null);
  }, [member]);

  const isPrimary = family?.isPrimaryParent ?? false;
  const busy = uploadPhoto.isPending || saveProfile.isPending;
  const age = ageFromBirthdate(birthday, now); // 폼의 현재 생일로 즉시 계산.
  // 미리보기: 방금 고른 사진 > 저장된 사진(proxy URL) > 없음(카메라 placeholder).
  const savedPhoto = member?.photo_url && member.photo_url.startsWith("http") ? member.photo_url : null;
  const previewSrc = pickedDataUrl ?? savedPhoto;

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
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

    // 생일: 빈 값이면 null(지움), 값이 있으면 유효성 검증(미래·비존재 날짜 차단).
    let birthdateToSave: string | null = null;
    if (birthday.trim()) {
      const nb = normalizeBirthdate(birthday);
      if (!nb) {
        show("생일을 올바르게 입력해주세요", "🎂");
        return;
      }
      birthdateToSave = nb;
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
        await uploadPhoto.mutateAsync({ memberId: member.id, dataUrl: pickedDataUrl, stamp: Date.now() });
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

  return (
    <div className="pe-root">
      <header className="pe-header">
        <button type="button" className="hy-iconbtn hy-press pe-back" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <span className="pe-title">프로필 편집</span>
      </header>

      <div className="pe-content">
        {isLoading && !member && <div className="pe-state">아이 정보를 불러오는 중…</div>}

        {!isLoading && !member && (
          <div className="pe-state">
            아이를 찾지 못했어요
            <button type="button" className="pe-state__btn hy-press" onClick={() => navigate(-1)}>
              돌아가기
            </button>
          </div>
        )}

        {member && (
          <>
            {/* 사진 등록 + 미리보기 */}
            <div className="pe-photo-wrap">
              <button
                type="button"
                className="pe-photo hy-press"
                onClick={() => fileRef.current?.click()}
                disabled={!isPrimary || processing}
                aria-label="사진 선택"
              >
                {previewSrc ? (
                  <img src={previewSrc} alt="" />
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
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
              <div className="pe-photo-name">{name.trim() || member.name || "아이"}</div>
              <p className="pe-hint">{processing ? "사진 처리 중…" : "얼굴이 잘 보이는 사진이 좋아요."}</p>
            </div>

            {/* 이름 */}
            <div className="pe-field">
              <div className="pe-label pe-label--sm">이름</div>
              <input
                className="pe-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름"
                maxLength={20}
                disabled={!isPrimary}
              />
            </div>

            {/* 생일(input type=date) + 나이 자동표시 */}
            <div className="pe-field">
              <div className="pe-label pe-label--sm pe-label--row">
                <span>생일</span>
                {age != null && <span className="pe-age">만 {age}세</span>}
              </div>
              <input
                className="pe-input pe-input--date"
                type="date"
                value={birthday}
                max={todayStr}
                onChange={(e) => setBirthday(e.target.value)}
                disabled={!isPrimary}
              />
            </div>

            {/* 전화번호 */}
            <div className="pe-field">
              <div className="pe-label pe-label--sm">전화번호</div>
              <input
                className="pe-input"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(formatPhoneDisplay(e.target.value))}
                placeholder="010-0000-0000"
                maxLength={13}
                disabled={!isPrimary}
              />
              <p className="pe-hint">아이 기기가 없어도 연락할 번호예요.</p>
            </div>

            {!isPrimary && <p className="pe-hint pe-hint--warn">주 보호자만 아이 프로필을 저장할 수 있어요.</p>}

            <button type="button" className="pe-save hy-press" onClick={onSave} disabled={busy || !isPrimary}>
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
