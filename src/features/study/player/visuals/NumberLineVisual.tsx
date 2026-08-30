type Point = Readonly<{ value: number; label?: string }>;

export function NumberLineVisual({
  visual,
  ariaLabel,
}: Readonly<{ visual: Readonly<Record<string, unknown>>; ariaLabel: string }>) {
  const minimum = typeof visual.min === "number" ? visual.min : 0;
  const maximum = typeof visual.max === "number" && visual.max > minimum ? visual.max : minimum + 1;
  const points = Array.isArray(visual.points)
    ? visual.points.filter((point): point is Point => !!point && typeof point === "object" && typeof point.value === "number")
    : [];
  const x = (value: number) => 20 + Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum))) * 280;
  return (
    <svg className="study-svg-visual" viewBox="0 0 320 100" role="img" aria-label={ariaLabel}>
      <line x1="20" y1="52" x2="300" y2="52" className="study-visual-line" />
      <path d="M300 52 L290 46 M300 52 L290 58" className="study-visual-line" />
      <text x="20" y="82" textAnchor="middle">{minimum}</text>
      <text x="300" y="82" textAnchor="middle">{maximum}</text>
      {points.map((point, index) => (
        <g key={`${point.value}-${index}`}>
          <circle cx={x(point.value)} cy="52" r="6" className="study-visual-point" />
          <text x={x(point.value)} y="30" textAnchor="middle">{point.label ?? point.value}</text>
        </g>
      ))}
    </svg>
  );
}
