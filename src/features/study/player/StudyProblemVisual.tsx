import { useIntl } from "react-intl";
import { BarModelVisual } from "./visuals/BarModelVisual";
import { FractionVisual } from "./visuals/FractionVisual";
import { GenericStudyVisual } from "./visuals/GenericStudyVisual";
import { NumberLineVisual } from "./visuals/NumberLineVisual";
import { supportsStudyVisual } from "./visuals/visualRegistry";
import "./study-player.css";

export function StudyProblemVisual({ item, audience = "child" }: Readonly<{ audience?: "child" | "parent"; item: {
  visual?: Readonly<Record<string, unknown>>; domainLabel: string; conceptTitle: string;
} }>) {
  const intl = useIntl();
  if (!item.visual) return null;
  if (!supportsStudyVisual(item.visual)) {
    return <p className="study-content-error" role="alert">{intl.formatMessage({ id: audience === "parent" ? "study.history.unsupportedVisual" : "study.problem.unsupportedVisual" })}</p>;
  }
  const ariaLabel = intl.formatMessage(
    { id: audience === "parent" ? "study.history.visualDescription" : "study.problem.visualDescription" },
    { domain: item.domainLabel, concept: item.conceptTitle },
  );
  switch (item.visual.kind) {
    case "fraction_bar": return <FractionVisual visual={item.visual} ariaLabel={ariaLabel} />;
    case "number_line": return <NumberLineVisual visual={item.visual} ariaLabel={ariaLabel} />;
    case "line_diagram": return <BarModelVisual visual={item.visual} ariaLabel={ariaLabel} />;
    default: return <GenericStudyVisual visual={item.visual} ariaLabel={ariaLabel} />;
  }
}
