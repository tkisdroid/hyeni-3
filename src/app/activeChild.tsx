/**
 * 전역 "활성 아이" 선택 컨텍스트 — 다자녀 스위치는 부모 홈에서만.
 *
 * 부모 홈의 아이 카드 탭이 유일한 스위치이고, 다른 화면(안전지표·위치·대화·주변소리·스티커)은
 * 전부 이 선택을 따른다(화면마다 중복 전환 UI 금지 — TK 결정). 선택은 가족별로
 * localStorage 에 지속되어 재실행에도 유지된다. 알림/SOS 딥링크(?child=)는 화면 단위로
 * 이 선택을 일시 오버라이드할 수 있다(위급 아이 우선 — 안전 규칙).
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "@/queries/useFamily";
import type { FamilyMember } from "@/lib/api/endpoints/family";

interface ActiveChildValue {
  /** 선택된 아이 family_members.id (아이 없으면 null). */
  activeChildId: string | null;
  /** 홈 카드 스위치 전용 — 다른 화면에서 호출 금지(부모 홈 + 아이 상세 진입만 예외). */
  setActiveChildId: (memberId: string) => void;
  /** 검증된 활성 아이 멤버(저장값이 무효면 첫 아이로 폴백). */
  activeChild: FamilyMember | null;
  /** 저장된 선택이 현재 활성 자녀와 정확히 일치할 때만 값이 있다(Study 등 fallback 금지 화면용). */
  selectedActiveChild: FamilyMember | null;
  /** role=child 멤버 목록(정렬: child_order → 원순서). */
  childMembers: FamilyMember[];
  /**
   * 가족 조회가 아직 진행 중인가.
   * activeChild 는 조회 중에도 null 이므로, 이 값 없이는 화면이
   * "아이 없음"을 미리 단정해 버린다(진행 표시자도 못 띄운다).
   */
  familyLoading: boolean;
}

const ActiveChildContext = createContext<ActiveChildValue | null>(null);

function storageKey(familyId: string | null): string {
  return `hy-active-child:${familyId ?? "none"}`;
}

function readStored(familyId: string | null): string | null {
  try {
    return window.localStorage.getItem(storageKey(familyId));
  } catch {
    return null;
  }
}

export function ActiveChildProvider({ children }: { children: ReactNode }) {
  const { familyId } = useAuth();
  const { data: family, isLoading: familyLoading } = useMyFamily();

  const childMembers = useMemo(() => {
    const kids = (family?.members ?? []).filter((m) => m.role === "child");
    return [...kids].sort((a, b) => (a.child_order ?? 99) - (b.child_order ?? 99));
  }, [family]);

  // 가족별 저장값으로 초기화(가족 전환 시 재로드).
  const [storedId, setStoredId] = useState<string | null>(() => readStored(familyId));
  useEffect(() => {
    setStoredId(readStored(familyId));
  }, [familyId]);

  const setActiveChildId = (memberId: string) => {
    setStoredId(memberId);
    try {
      window.localStorage.setItem(storageKey(familyId), memberId);
    } catch {
      // 저장 실패(프라이빗 모드 등)는 세션 내 선택만 유지
    }
  };

  // 저장값 검증: 현재 가족의 아이가 아니면 첫 아이 폴백(삭제·가족변경 대응).
  const activeChild = useMemo(
    () => childMembers.find((m) => m.id === storedId) ?? childMembers[0] ?? null,
    [childMembers, storedId],
  );
  const selectedActiveChild = useMemo(
    () => childMembers.find((member) => member.id === storedId) ?? null,
    [childMembers, storedId],
  );

  const value = useMemo<ActiveChildValue>(
    () => ({
      activeChildId: activeChild?.id ?? null,
      setActiveChildId,
      activeChild,
      selectedActiveChild,
      childMembers,
      familyLoading,
    }),
    // setActiveChildId 는 familyId 클로저만 가진 안정 함수 취급(재생성 무해)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeChild, selectedActiveChild, childMembers, familyId, familyLoading],
  );

  return <ActiveChildContext.Provider value={value}>{children}</ActiveChildContext.Provider>;
}

/** 활성 아이 컨텍스트. Provider 밖에서 호출하면 즉시 오류(배선 실수 조기 발견). */
export function useActiveChild(): ActiveChildValue {
  const ctx = useContext(ActiveChildContext);
  if (!ctx) throw new Error("useActiveChild 는 ActiveChildProvider 안에서만 사용할 수 있어요");
  return ctx;
}
