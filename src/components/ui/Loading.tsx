import "./Loading.css";
import { useIntl } from "react-intl";
import { LoaderMark } from "./LoaderMark";

/**
 * 소형 로딩 인디케이터 — 데이터 로딩 중 화면 안에 표시(공용 로딩 마크 + 한 줄 안내).
 * 풀스크린 스플래시(Splash)는 콜드스타트 브랜드 연출 전용이고,
 * 화면 내부의 "불러오는 중" 상태는 이 소형 컴포넌트로 분리한다.
 *
 * compact 는 대화·목록처럼 세로 여유가 적은 자리에서 마크만 줄인다(문구·정렬은 동일).
 */
export function Loading({ label, compact = false }: { label?: string; compact?: boolean }) {
  const intl = useIntl();
  return (
    <div
      className={compact ? "hy-loading hy-loading--compact" : "hy-loading"}
      role="status"
      aria-live="polite"
      aria-label={label ?? intl.formatMessage({ id: "core.state.loading" })}
    >
      <LoaderMark />
      {label && <span className="hy-loading__label">{label}</span>}
    </div>
  );
}
