import { useIntl } from "react-intl";
import { useActiveChild } from "@/app/activeChild";
import { useAuth } from "@/auth/AuthContext";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { selectionHaptic } from "@/lib/haptics";
import "./ChildSwitcher.css";

function avatarSrc(path: string): string {
  return path.startsWith("http") || path.startsWith("blob:") ? path : asset(path);
}

/**
 * 다자녀 가족의 "지금 보고 있는 아이" 전환 알약.
 *
 * 선택 상태는 전역 활성 아이 하나뿐이다(`useActiveChild`). 부모 홈 상단이 정본 자리이고,
 * 아이 단위로 읽는 위치·대화 탭에도 같은 컴포넌트를 둬서 홈으로 돌아가지 않고 바꿀 수 있게 한다.
 * 누르면 화면 이동 없이 선택만 바뀐다(상세 화면은 홈의 아이 현황 카드가 연다).
 * 아이가 한 명이면 고를 것이 없으므로 아무것도 그리지 않는다.
 */
export function ChildSwitcher({
  className,
  onChange,
  selectedId,
  unreadIds,
}: {
  className?: string;
  onChange?: (memberId: string) => void;
  /** 안 읽은 메시지가 있는 아이(member id) — 고르지 않은 알약에 점으로 알린다(대화 화면). */
  unreadIds?: ReadonlySet<string>;
  /** 알림 딥링크처럼 화면이 전역 선택과 다른 아이를 보여 줄 때 그 아이(member id). */
  selectedId?: string | null;
}) {
  const intl = useIntl();
  const { role } = useAuth();
  const { childMembers, activeChild, setActiveChildId } = useActiveChild();
  // 아이 세션은 자기 자신만 본다 — 형제가 있어도 전환 알약을 그리지 않는다.
  if (role === "child" || childMembers.length < 2) return null;
  return (
    <div
      className={["hy-kidswitch", className].filter(Boolean).join(" ")}
      role="radiogroup"
      aria-label={intl.formatMessage({ id: "shared.childSwitcher.label" })}
    >
      {childMembers.map((child) => {
        const selected = child.id === (selectedId ?? activeChild?.id);
        const name = child.name || intl.formatMessage({ id: "shared.childSwitcher.fallbackName" });
        const unread = !selected && unreadIds?.has(child.id) === true;
        return (
          <button
            key={child.id}
            type="button"
            role="radio"
            aria-checked={selected}
            data-selected={selected ? "true" : "false"}
            className="hy-kidswitch__item hy-press"
            onClick={() => {
              if (selected) return;
              selectionHaptic();
              setActiveChildId(child.id);
              onChange?.(child.id);
            }}
          >
            <span className="hy-kidswitch__avatar" data-photo={childAvatarPath(child.photo_url) === "mascot/wave.webp" ? "false" : "true"}>
              <img src={avatarSrc(childAvatarPath(child.photo_url))} alt="" loading="eager" decoding="async" />
            </span>
            <span className="hy-kidswitch__name">{name}</span>
            {unread && (
              <span className="hy-kidswitch__dot">
                <span className="hy-kidswitch__sr">{intl.formatMessage({ id: "shared.childSwitcher.unread" })}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
