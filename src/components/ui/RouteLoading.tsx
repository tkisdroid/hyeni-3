import "./RouteLoading.css";

export function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite" aria-label="화면을 불러오는 중">
      <span className="route-loading__visual" aria-hidden="true">
        <span className="route-loading__shimmer" />
      </span>
      <span className="route-loading__label">화면을 불러오는 중…</span>
    </div>
  );
}
