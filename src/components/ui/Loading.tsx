import "./Loading.css";

/**
 * 소형 로딩 인디케이터 — 데이터 로딩 중 화면 안에 작게 표시(점 3개 펄스).
 * 풀스크린 스플래시(Splash)는 콜드스타트 브랜드 연출 전용이고,
 * 화면 내부의 "불러오는 중" 상태는 이 소형 컴포넌트로 분리한다.
 */
export function Loading({ label, size = 8 }: { label?: string; size?: number }) {
  return (
    <div className="hy-loading" role="status" aria-live="polite" aria-label={label ?? "불러오는 중"}>
      <span className="hy-loading__dots" aria-hidden="true">
        <span className="hy-loading__dot" style={{ width: size, height: size }} />
        <span className="hy-loading__dot" style={{ width: size, height: size }} />
        <span className="hy-loading__dot" style={{ width: size, height: size }} />
      </span>
      {label && <span className="hy-loading__label">{label}</span>}
    </div>
  );
}
