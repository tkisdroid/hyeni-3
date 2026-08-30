import { useIntl } from "react-intl";
import type { StudyMissionItemDto } from "../contracts";
import type { StudyAnswerDraft } from "./studyPlayerState";

export function initialStudyAnswer(item: StudyMissionItemDto): StudyAnswerDraft {
  const input = item.input;
  switch (input.kind) {
    case "single_choice": return { kind: "single_choice", choiceId: "" };
    case "multiple_choice": return { kind: "multiple_choice", choiceIds: [] };
    case "integer_input": return { kind: "integer_input", value: "" };
    case "decimal_input": return { kind: "decimal_input", value: "" };
    case "fraction_input": return { kind: "fraction_input", numerator: "", denominator: "" };
    case "measurement_input": {
      const units = Array.isArray(input.units) ? input.units.filter((unit): unit is string => typeof unit === "string") : [];
      return { kind: "measurement_input", value: "", unit: units[0] ?? "" };
    }
    case "ordering": {
      const items = Array.isArray(input.items) ? input.items.filter((entry): entry is string => typeof entry === "string") : [];
      return { kind: "ordering", items };
    }
    case "coordinate_input": return { kind: "coordinate_input", x: "", y: "" };
    case "true_false": return { kind: "true_false", value: null };
    case "text_input": return { kind: "text_input", text: "" };
    case "self_check": return { kind: "self_check", selectedIds: [] };
  }
}

type Props = Readonly<{
  item: StudyMissionItemDto;
  value: StudyAnswerDraft;
  onChange: (draft: StudyAnswerDraft) => void;
  disabled?: boolean;
}>;

function valueFor<T extends StudyAnswerDraft["kind"]>(
  item: StudyMissionItemDto,
  value: StudyAnswerDraft,
  kind: T,
): Extract<StudyAnswerDraft, { kind: T }> {
  return (value.kind === kind ? value : initialStudyAnswer(item)) as Extract<StudyAnswerDraft, { kind: T }>;
}

export function StudyAnswerInput({ item, value, onChange, disabled = false }: Props) {
  const intl = useIntl();
  const input = item.input;
  const label = intl.formatMessage({ id: `study.answer.${input.kind}.label` });

  if (input.kind === "single_choice" || input.kind === "multiple_choice") {
    const single = input.kind === "single_choice" ? valueFor(item, value, "single_choice") : null;
    const multiple = input.kind === "multiple_choice" ? valueFor(item, value, "multiple_choice") : null;
    return (
      <fieldset className="study-answer-group" disabled={disabled}>
        <legend>{label}</legend>
        <div className="study-choice-list">
          {(item.choices ?? []).map((choice) => {
            const checked = single ? single.choiceId === choice.id : multiple?.choiceIds.includes(choice.id) === true;
            return (
              <label key={choice.id} className={checked ? "study-choice is-selected" : "study-choice"}>
                <input
                  type={single ? "radio" : "checkbox"}
                  name={`study-answer-${item.problemId}`}
                  checked={checked}
                  onChange={() => {
                    if (single) onChange({ kind: "single_choice", choiceId: choice.id });
                    else {
                      const selected = multiple?.choiceIds ?? [];
                      onChange({
                        kind: "multiple_choice",
                        choiceIds: checked ? selected.filter((id) => id !== choice.id) : [...selected, choice.id],
                      });
                    }
                  }}
                />
                <span>{choice.text}</span>
                {checked && <b>{intl.formatMessage({ id: "study.answer.selected" })}</b>}
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (input.kind === "fraction_input") {
    const draft = valueFor(item, value, "fraction_input");
    return (
      <fieldset className="study-answer-group" disabled={disabled}>
        <legend>{label}</legend>
        <div className="study-fraction-input">
          <label>{intl.formatMessage({ id: "study.answer.numerator" })}<input inputMode="numeric" value={draft.numerator} onChange={(event) => onChange({ ...draft, numerator: event.currentTarget.value })} /></label>
          <span aria-hidden="true">/</span>
          <label>{intl.formatMessage({ id: "study.answer.denominator" })}<input inputMode="numeric" value={draft.denominator} onChange={(event) => onChange({ ...draft, denominator: event.currentTarget.value })} /></label>
        </div>
      </fieldset>
    );
  }

  if (input.kind === "measurement_input") {
    const draft = valueFor(item, value, "measurement_input");
    const units = Array.isArray(input.units) ? input.units.filter((unit): unit is string => typeof unit === "string") : [];
    return (
      <fieldset className="study-answer-group" disabled={disabled}>
        <legend>{label}</legend>
        <div className="study-measurement-input">
          <input aria-label={label} inputMode="decimal" value={draft.value} onChange={(event) => onChange({ ...draft, value: event.currentTarget.value })} />
          <select aria-label={intl.formatMessage({ id: "study.answer.unit" })} value={draft.unit} onChange={(event) => onChange({ ...draft, unit: event.currentTarget.value })}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select>
        </div>
      </fieldset>
    );
  }

  if (input.kind === "ordering") {
    const draft = valueFor(item, value, "ordering");
    const move = (index: number, offset: -1 | 1) => {
      const target = index + offset;
      if (target < 0 || target >= draft.items.length) return;
      const items = [...draft.items];
      [items[index], items[target]] = [items[target]!, items[index]!];
      onChange({ kind: "ordering", items });
    };
    return (
      <fieldset className="study-answer-group" disabled={disabled}>
        <legend>{label}</legend>
        <ol className="study-order-list">{draft.items.map((entry, index) => <li key={entry}><span>{index + 1}. {entry}</span><button type="button" aria-label={intl.formatMessage({ id: "study.answer.moveUp" }, { item: entry })} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={intl.formatMessage({ id: "study.answer.moveDown" }, { item: entry })} disabled={index === draft.items.length - 1} onClick={() => move(index, 1)}>↓</button></li>)}</ol>
      </fieldset>
    );
  }

  if (input.kind === "coordinate_input") {
    const draft = valueFor(item, value, "coordinate_input");
    return (
      <fieldset className="study-answer-group" disabled={disabled}>
        <legend>{label}</legend>
        <div className="study-coordinate-input"><label>x<input inputMode="numeric" value={draft.x} onChange={(event) => onChange({ ...draft, x: event.currentTarget.value })} /></label><label>y<input inputMode="numeric" value={draft.y} onChange={(event) => onChange({ ...draft, y: event.currentTarget.value })} /></label></div>
      </fieldset>
    );
  }

  if (input.kind === "true_false") {
    const draft = valueFor(item, value, "true_false");
    return (
      <fieldset className="study-answer-group" disabled={disabled}>
        <legend>{label}</legend>
        <div className="study-boolean-input">{([true, false] as const).map((option) => <label key={String(option)} className={draft.value === option ? "study-choice is-selected" : "study-choice"}><input type="radio" name={`study-answer-${item.problemId}`} checked={draft.value === option} onChange={() => onChange({ kind: "true_false", value: option })} /><span>{intl.formatMessage({ id: option ? "study.answer.true" : "study.answer.false" })}</span></label>)}</div>
      </fieldset>
    );
  }

  if (input.kind === "self_check") {
    const draft = valueFor(item, value, "self_check");
    const items = Array.isArray(input.items) ? input.items : [];
    return (
      <fieldset className="study-answer-group" disabled={disabled}>
        <legend>{label}</legend>
        <div className="study-choice-list">{items.map((entry) => {
          const itemRecord = entry as Readonly<{ id?: unknown; text?: unknown }>;
          const id = String(itemRecord.id ?? "");
          const checked = draft.selectedIds.includes(id);
          return <label key={id} className={checked ? "study-choice is-selected" : "study-choice"}><input type="checkbox" checked={checked} onChange={() => onChange({ kind: "self_check", selectedIds: checked ? draft.selectedIds.filter((value) => value !== id) : [...draft.selectedIds, id] })} /><span>{String(itemRecord.text ?? "")}</span></label>;
        })}</div>
      </fieldset>
    );
  }

  if (input.kind === "text_input") {
    const draft = valueFor(item, value, "text_input");
    return <label className="study-answer-group">{label}<textarea disabled={disabled} maxLength={2_000} value={draft.text} onChange={(event) => onChange({ kind: "text_input", text: event.currentTarget.value })} /></label>;
  }

  const numericKind = input.kind === "integer_input" ? "integer_input" : "decimal_input";
  const draft = valueFor(item, value, numericKind);
  return <label className="study-answer-group">{label}<input disabled={disabled} inputMode={numericKind === "integer_input" ? "numeric" : "decimal"} value={draft.value} onChange={(event) => onChange({ kind: numericKind, value: event.currentTarget.value })} /></label>;
}
