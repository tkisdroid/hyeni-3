import type { ReactNode } from "react";

type Point = Readonly<{ x: number; y: number; id?: string }>;

function record(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function points(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    return item && typeof item.x === "number" && typeof item.y === "number"
      ? [{ x: item.x, y: item.y, ...(typeof item.id === "string" ? { id: item.id } : {}) }]
      : [];
  });
}

function VisualSvg({ children, ariaLabel }: Readonly<{ children: ReactNode; ariaLabel: string }>) {
  return <svg className="study-svg-visual" viewBox="0 0 320 220" role="img" aria-label={ariaLabel}>{children}</svg>;
}

function TableVisual({ visual, ariaLabel }: Readonly<{ visual: Readonly<Record<string, unknown>>; ariaLabel: string }>) {
  const columns = Array.isArray(visual.columns) ? visual.columns.map(String).slice(0, 32) : [];
  const rows = Array.isArray(visual.rows) ? visual.rows.slice(0, 64) : [];
  return (
    <div className="study-table-wrap" role="group" aria-label={ariaLabel}>
      {typeof visual.title === "string" && <strong>{visual.title}</strong>}
      <table>
        <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{rows.map((entry, rowIndex) => {
          const cells = record(entry)?.cells;
          return <tr key={rowIndex}>{(Array.isArray(cells) ? cells : []).map((cell, index) => <td key={index}>{String(cell)}</td>)}</tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function ChartVisual({ visual, ariaLabel }: Readonly<{ visual: Readonly<Record<string, unknown>>; ariaLabel: string }>) {
  const labels = Array.isArray(visual.labels) ? visual.labels.map(String) : [];
  const values = Array.isArray(visual.values) ? visual.values.map(Number) : [];
  const maximum = Math.max(1, ...values.filter(Number.isFinite));
  return (
    <div className="study-chart" role="img" aria-label={ariaLabel}>
      {labels.map((label, index) => {
        const value = Number.isFinite(values[index]) ? values[index]! : 0;
        return <div key={`${label}-${index}`} className="study-chart-row"><span>{label}</span><i style={{ width: `${Math.max(2, value / maximum * 100)}%` }} /><b>{value}</b></div>;
      })}
    </div>
  );
}

function PictureGraphVisual({ visual, ariaLabel }: Readonly<{ visual: Readonly<Record<string, unknown>>; ariaLabel: string }>) {
  const rows = Array.isArray(visual.rows) ? visual.rows : [];
  const icon = typeof visual.icon === "string" ? visual.icon : "●";
  return (
    <ul className="study-picture-graph" aria-label={ariaLabel}>
      {rows.map((entry, index) => {
        const row = record(entry);
        const count = row && Number.isSafeInteger(row.iconCount) ? Math.max(0, Math.min(24, Number(row.iconCount))) : 0;
        return <li key={index}><strong>{String(row?.label ?? "")}</strong><span aria-hidden="true">{Array.from({ length: count }, () => icon).join(" ")}</span><em>{count}</em></li>;
      })}
    </ul>
  );
}

function AngleVisual({ visual, ariaLabel }: Readonly<{ visual: Readonly<Record<string, unknown>>; ariaLabel: string }>) {
  const degree = typeof visual.degree === "number" ? Math.max(0, Math.min(180, visual.degree)) : 45;
  const radians = degree * Math.PI / 180;
  const endX = 150 + Math.cos(radians) * 110;
  const endY = 170 - Math.sin(radians) * 110;
  return <VisualSvg ariaLabel={ariaLabel}><line x1="150" y1="170" x2="280" y2="170" className="study-visual-line" /><line x1="150" y1="170" x2={endX} y2={endY} className="study-visual-line" /><path d="M190 170 A40 40 0 0 0 185 145" className="study-visual-arc" />{visual.showMeasure === true && <text x="198" y="143">{degree}°</text>}</VisualSvg>;
}

function CoordinateVisual({ visual, ariaLabel }: Readonly<{ visual: Readonly<Record<string, unknown>>; ariaLabel: string }>) {
  const visualPoints = points(visual.points);
  const xMax = typeof visual.xMax === "number" && visual.xMax > 0 ? visual.xMax : 10;
  const yMax = typeof visual.yMax === "number" && visual.yMax > 0 ? visual.yMax : 10;
  return <VisualSvg ariaLabel={ariaLabel}><line x1="30" y1="190" x2="300" y2="190" className="study-visual-line" /><line x1="30" y1="190" x2="30" y2="18" className="study-visual-line" />{visualPoints.map((point, index) => { const x = 30 + point.x / xMax * 260; const y = 190 - point.y / yMax * 160; return <g key={index}><circle cx={x} cy={y} r="6" className="study-visual-point" />{point.id && <text x={x + 9} y={y - 8}>{point.id}</text>}</g>; })}</VisualSvg>;
}

function PolygonVisual({ visual, ariaLabel }: Readonly<{ visual: Readonly<Record<string, unknown>>; ariaLabel: string }>) {
  const visualPoints = points(visual.points);
  const maxX = Math.max(1, ...visualPoints.map((point) => point.x));
  const maxY = Math.max(1, ...visualPoints.map((point) => point.y));
  const coordinates = visualPoints.map((point) => `${30 + point.x / maxX * 250},${20 + point.y / maxY * 175}`).join(" ");
  return <VisualSvg ariaLabel={ariaLabel}><polygon points={coordinates} className="study-visual-shape" /></VisualSvg>;
}

function GridVisual({ visual, ariaLabel }: Readonly<{ visual: Readonly<Record<string, unknown>>; ariaLabel: string }>) {
  const rows = typeof visual.rows === "number" ? Math.max(1, Math.min(12, visual.rows)) : 4;
  const columns = typeof visual.columns === "number" ? Math.max(1, Math.min(12, visual.columns)) : 4;
  const width = 240 / columns;
  const height = 160 / rows;
  return <VisualSvg ariaLabel={ariaLabel}>{Array.from({ length: rows * columns }, (_, index) => <rect key={index} x={40 + index % columns * width} y={25 + Math.floor(index / columns) * height} width={width} height={height} className="study-visual-grid-cell" />)}</VisualSvg>;
}

function CircleVisual({ visual, ariaLabel }: Readonly<{ visual: Readonly<Record<string, unknown>>; ariaLabel: string }>) {
  const centerId = record(visual.center)?.id;
  return <VisualSvg ariaLabel={ariaLabel}><circle cx="160" cy="110" r="76" className="study-visual-shape" /><circle cx="160" cy="110" r="5" className="study-visual-point" /><line x1="160" y1="110" x2="236" y2="110" className="study-visual-line" />{typeof centerId === "string" && <text x="146" y="105">{centerId}</text>}</VisualSvg>;
}

function SolidVisual({ visual, ariaLabel }: Readonly<{ visual: Readonly<Record<string, unknown>>; ariaLabel: string }>) {
  const label = typeof visual.solidType === "string" ? visual.solidType : visual.kind === "net" ? "net" : "solid";
  return <VisualSvg ariaLabel={ariaLabel}><rect x="70" y="65" width="150" height="105" className="study-visual-shape" /><polygon points="70,65 120,30 270,30 220,65" className="study-visual-shape-alt" /><polygon points="220,65 270,30 270,135 220,170" className="study-visual-shape-alt" /><text x="145" y="205" textAnchor="middle">{label}</text></VisualSvg>;
}

export function GenericStudyVisual({
  visual,
  ariaLabel,
}: Readonly<{ visual: Readonly<Record<string, unknown>>; ariaLabel: string }>) {
  switch (visual.kind) {
    case "table": return <TableVisual visual={visual} ariaLabel={ariaLabel} />;
    case "chart": return <ChartVisual visual={visual} ariaLabel={ariaLabel} />;
    case "picture_graph": return <PictureGraphVisual visual={visual} ariaLabel={ariaLabel} />;
    case "angle":
    case "protractor": return <AngleVisual visual={visual} ariaLabel={ariaLabel} />;
    case "coordinate_plane": return <CoordinateVisual visual={visual} ariaLabel={ariaLabel} />;
    case "polygon": return <PolygonVisual visual={visual} ariaLabel={ariaLabel} />;
    case "circle": return <CircleVisual visual={visual} ariaLabel={ariaLabel} />;
    case "partial_grid":
    case "orthographic_views":
    case "tiling": return <GridVisual visual={visual} ariaLabel={ariaLabel} />;
    case "net":
    case "solid": return <SolidVisual visual={visual} ariaLabel={ariaLabel} />;
    default: return null;
  }
}
