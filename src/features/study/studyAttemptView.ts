import type { StudyHistoryAnswer } from "./learningExtrasContracts";

type AnswerView = Readonly<{
  answer: StudyHistoryAnswer | null; skipped: boolean;
  problem: { choices?: readonly { id: string; text: string }[]; input: Readonly<Record<string, unknown>> } | null;
}>;

export function studyAttemptAnswerText(item: AnswerView, labels: { missing: string; skipped: string; true: string; false: string }): string {
  if (item.skipped) return labels.skipped;
  const answer = item.answer;
  if (answer === null) return labels.missing;
  const choice = (id: string) => item.problem?.choices?.find(option => option.id === id)?.text ?? labels.missing;
  switch (answer.kind) {
    case "single_choice": return choice(answer.value);
    case "multiple_choice": return answer.values.map(choice).join(", ");
    case "fraction": return `${answer.numerator}/${answer.denominator}`;
    case "measurement": return `${answer.value} ${answer.unit}`;
    case "ordering": return answer.values.join(" → ");
    case "coordinate": return `(${answer.x}, ${answer.y})`;
    case "boolean": return answer.value ? labels.true : labels.false;
    case "self_check": {
      const items = item.problem?.input.items;
      return answer.selections.map(id => {
        if (!Array.isArray(items)) return labels.missing;
        const option: unknown = items.find((value: unknown) => !!value && typeof value === "object" && "id" in value && value.id === id);
        return option && typeof option === "object" && "text" in option && typeof option.text === "string" ? option.text : labels.missing;
      }).join(", ");
    }
    default: return answer.value;
  }
}
