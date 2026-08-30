type DiagramPoint = Readonly<{ x: number; y: number; label?: string }>;

function diagramPoint(value: unknown, fallbackX: number): DiagramPoint {
  if (!value || typeof value !== "object") return { x: fallbackX, y: 2 };
  const point = value as Record<string, unknown>;
  return {
    x: typeof point.x === "number" ? point.x : fallbackX,
    y: typeof point.y === "number" ? point.y : 2,
    ...(typeof point.label === "string" ? { label: point.label } : {}),
  };
}

export function BarModelVisual({
  visual,
  ariaLabel,
}: Readonly<{ visual: Readonly<Record<string, unknown>>; ariaLabel: string }>) {
  const start = diagramPoint(visual.start, 1);
  const end = diagramPoint(visual.end, 7);
  const scaleX = (value: number) => 30 + value * 32;
  const scaleY = (value: number) => 20 + value * 24;
  return (
    <svg className="study-svg-visual" viewBox="0 0 320 120" role="img" aria-label={ariaLabel}>
      <line
        x1={scaleX(start.x)}
        y1={scaleY(start.y)}
        x2={scaleX(end.x)}
        y2={scaleY(end.y)}
        className="study-visual-line study-visual-line-strong"
      />
      {[start, end].map((point, index) => (
        <g key={index}>
          <circle cx={scaleX(point.x)} cy={scaleY(point.y)} r="6" className="study-visual-point" />
          {point.label && <text x={scaleX(point.x)} y={scaleY(point.y) - 14} textAnchor="middle">{point.label}</text>}
        </g>
      ))}
    </svg>
  );
}
