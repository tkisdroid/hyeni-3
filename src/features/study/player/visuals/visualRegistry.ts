export const ACTIVE_STUDY_VISUAL_KINDS = [
  "angle",
  "chart",
  "circle",
  "coordinate_plane",
  "fraction_bar",
  "line_diagram",
  "net",
  "number_line",
  "orthographic_views",
  "partial_grid",
  "picture_graph",
  "polygon",
  "protractor",
  "solid",
  "table",
  "tiling",
] as const;

export type ActiveStudyVisualKind = (typeof ACTIVE_STUDY_VISUAL_KINDS)[number];
const VISUAL_KIND_SET = new Set<string>(ACTIVE_STUDY_VISUAL_KINDS);

export function supportsStudyVisual(value: unknown): value is Readonly<Record<string, unknown> & { kind: ActiveStudyVisualKind }> {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && VISUAL_KIND_SET.has(String((value as { kind?: unknown }).kind));
}
