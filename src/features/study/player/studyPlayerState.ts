import type { SubmitStudyAnswerCommand } from "../contracts";

export type StudyAnswerDraft =
  | Readonly<{ kind: "single_choice"; choiceId: string }>
  | Readonly<{ kind: "multiple_choice"; choiceIds: readonly string[] }>
  | Readonly<{ kind: "integer_input"; value: string }>
  | Readonly<{ kind: "decimal_input"; value: string }>
  | Readonly<{ kind: "fraction_input"; numerator: string; denominator: string }>
  | Readonly<{ kind: "measurement_input"; value: string; unit: string }>
  | Readonly<{ kind: "ordering"; items: readonly string[] }>
  | Readonly<{ kind: "coordinate_input"; x: string; y: string }>
  | Readonly<{ kind: "true_false"; value: boolean | null }>
  | Readonly<{ kind: "text_input"; text: string }>
  | Readonly<{ kind: "self_check"; selectedIds: readonly string[] }>;

export type StudyPlayerEffect = Readonly<{
  type: "submit";
  command: SubmitStudyAnswerCommand;
}>;

export type StudyPlayerState = Readonly<{
  missionId: string;
  problemIds: readonly string[];
  index: number;
  problemId: string | null;
  phase: "ready" | "submitting" | "retryable" | "revealed" | "completed";
  draft: StudyAnswerDraft | null;
  retryCommand: SubmitStudyAnswerCommand | null;
  result: unknown;
  effects: readonly StudyPlayerEffect[];
}>;

type MissionState = Readonly<{
  missionId: string;
  status: string;
  items: readonly Readonly<{ problemId: string; resolved: boolean }>[];
}>;

export type StudyPlayerAction =
  | Readonly<{ type: "SET_DRAFT"; draft: StudyAnswerDraft }>
  | Readonly<{ type: "SUBMIT"; command: SubmitStudyAnswerCommand }>
  | Readonly<{ type: "FAILED"; retryable: boolean }>
  | Readonly<{ type: "RETRY" }>
  | Readonly<{ type: "SUCCEEDED"; result: unknown }>
  | Readonly<{ type: "NEXT" }>;

export function createStudyPlayerState(mission: MissionState): StudyPlayerState {
  const problemIds = mission.items.filter((item) => !item.resolved).map((item) => item.problemId);
  const completed = mission.status === "completed" || problemIds.length === 0;
  return {
    missionId: mission.missionId,
    problemIds,
    index: completed ? problemIds.length : 0,
    problemId: completed ? null : problemIds[0] ?? null,
    phase: completed ? "completed" : "ready",
    draft: null,
    retryCommand: null,
    result: null,
    effects: [],
  };
}

function withoutEffects(state: StudyPlayerState): StudyPlayerState {
  return state.effects.length === 0 ? state : { ...state, effects: [] };
}

export function reduceStudyPlayer(state: StudyPlayerState, action: StudyPlayerAction): StudyPlayerState {
  const current = withoutEffects(state);
  switch (action.type) {
    case "SET_DRAFT":
      return current.phase === "ready" ? { ...current, draft: action.draft } : current;
    case "SUBMIT":
      if (
        current.phase !== "ready"
        || action.command.missionId !== current.missionId
        || action.command.problemId !== current.problemId
        || action.command.answer.length === 0
      ) return current;
      return {
        ...current,
        phase: "submitting",
        retryCommand: action.command,
        effects: [{ type: "submit", command: action.command }],
      };
    case "FAILED":
      if (current.phase !== "submitting") return current;
      return {
        ...current,
        phase: action.retryable && current.retryCommand ? "retryable" : "ready",
        retryCommand: action.retryable ? current.retryCommand : null,
      };
    case "RETRY":
      if (current.phase !== "retryable" || !current.retryCommand) return current;
      return {
        ...current,
        phase: "submitting",
        effects: [{ type: "submit", command: current.retryCommand }],
      };
    case "SUCCEEDED":
      return current.phase === "submitting"
        ? { ...current, phase: "revealed", result: action.result, retryCommand: null }
        : current;
    case "NEXT": {
      if (current.phase !== "revealed") return current;
      const nextIndex = current.index + 1;
      const problemId = current.problemIds[nextIndex] ?? null;
      return problemId
        ? {
            ...current,
            index: nextIndex,
            problemId,
            phase: "ready",
            draft: null,
            retryCommand: null,
            result: null,
          }
        : {
            ...current,
            index: current.problemIds.length,
            problemId: null,
            phase: "completed",
            draft: null,
            retryCommand: null,
            result: null,
          };
    }
  }
}

export function normalizeStudyInteger(value: string): string | null {
  const compact = value.trim();
  if (!/^[+-]?\d+$/u.test(compact)) return null;
  try {
    const normalized = BigInt(compact).toString();
    return normalized === "-0" ? "0" : normalized;
  } catch {
    return null;
  }
}

export function normalizeStudyDecimal(value: string): string | null {
  const compact = value.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/u.exec(compact);
  if (!match) return null;
  const sign = match[1] === "-" ? "-" : "";
  const integer = (match[2] ?? "").replace(/^0+(?=\d)/u, "") || "0";
  const fraction = (match[3] ?? "").replace(/0+$/u, "");
  const unsigned = fraction ? `${integer}.${fraction}` : integer;
  return /^0(?:\.0+)?$/u.test(unsigned) ? "0" : sign + unsigned;
}

export function normalizeStudyFreeText(value: string): string | null {
  const normalized = value.trim().normalize("NFC");
  return normalized.length > 0 && normalized.length <= 2_000 ? normalized : null;
}

function uniqueNonEmpty(values: readonly string[]): string[] | null {
  const normalized = values.map((value) => value.trim().normalize("NFC"));
  if (normalized.length === 0 || normalized.some((value) => !value) || new Set(normalized).size !== normalized.length) return null;
  return normalized;
}

export function serializeStudyAnswer(draft: StudyAnswerDraft | null): string | null {
  if (!draft) return null;
  switch (draft.kind) {
    case "single_choice":
      return normalizeStudyFreeText(draft.choiceId);
    case "multiple_choice": {
      const values = uniqueNonEmpty(draft.choiceIds);
      return values ? JSON.stringify(values) : null;
    }
    case "integer_input":
      return normalizeStudyInteger(draft.value);
    case "decimal_input":
      return normalizeStudyDecimal(draft.value);
    case "fraction_input": {
      const numerator = normalizeStudyInteger(draft.numerator);
      const denominator = normalizeStudyInteger(draft.denominator);
      if (!numerator || !denominator || denominator === "0" || denominator.startsWith("-")) return null;
      return JSON.stringify({ numerator, denominator });
    }
    case "measurement_input": {
      const value = normalizeStudyDecimal(draft.value);
      const unit = normalizeStudyFreeText(draft.unit);
      return value && unit ? JSON.stringify({ value, unit }) : null;
    }
    case "ordering": {
      const values = uniqueNonEmpty(draft.items);
      return values && values.length >= 2 ? JSON.stringify(values) : null;
    }
    case "coordinate_input": {
      const x = normalizeStudyInteger(draft.x);
      const y = normalizeStudyInteger(draft.y);
      return x && y ? JSON.stringify({ x, y }) : null;
    }
    case "true_false":
      return draft.value === null ? null : String(draft.value);
    case "text_input":
      return normalizeStudyFreeText(draft.text);
    case "self_check": {
      const values = uniqueNonEmpty(draft.selectedIds);
      return values ? JSON.stringify(values) : null;
    }
  }
}
