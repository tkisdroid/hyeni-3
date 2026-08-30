export function FractionVisual({
  visual,
  ariaLabel,
}: Readonly<{ visual: Readonly<Record<string, unknown>>; ariaLabel: string }>) {
  const total = Number.isSafeInteger(visual.totalParts) ? Math.max(1, Math.min(64, Number(visual.totalParts))) : 1;
  const highlighted = Number.isSafeInteger(visual.highlightedParts)
    ? Math.max(0, Math.min(total, Number(visual.highlightedParts)))
    : 0;
  return (
    <div className="study-fraction-visual" role="img" aria-label={ariaLabel}>
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className={index < highlighted ? "is-highlighted" : undefined} aria-hidden="true" />
      ))}
      {visual.labels === true && <span className="study-visual-caption">{highlighted}/{total}</span>}
    </div>
  );
}
