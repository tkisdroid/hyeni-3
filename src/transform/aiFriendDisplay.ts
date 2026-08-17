import type { IntlShape } from "react-intl";

export type AiFriendPersonaKey = "rabbit" | "cat" | "fox" | "dog" | "bear" | "panda";
export type AiFriendPersonaDisplayField = "species" | "tone" | "greeting" | "intro";

export function aiFriendPersonaMessageId(
  key: AiFriendPersonaKey,
  field: AiFriendPersonaDisplayField,
): `child.aiPersona.${AiFriendPersonaKey}.${AiFriendPersonaDisplayField}` {
  return `child.aiPersona.${key}.${field}`;
}

type GreetingContext =
  | Readonly<{ supplyLabel: string }>
  | Readonly<{ eventTitle: string; eventTime?: string | null }>
  | null;

export function resolveAiFriendClientGreeting(
  intl: IntlShape,
  personaKey: AiFriendPersonaKey,
  context: GreetingContext = null,
): string {
  if (!context) {
    return intl.formatMessage({ id: aiFriendPersonaMessageId(personaKey, "greeting") });
  }
  const intro = intl.formatMessage({ id: aiFriendPersonaMessageId(personaKey, "intro") });
  if ("supplyLabel" in context) {
    return intl.formatMessage(
      { id: "child.aiChat.greeting.supply" },
      { intro, supplyLabel: context.supplyLabel },
    );
  }
  return intl.formatMessage(
    { id: "child.aiChat.greeting.event" },
    {
      intro,
      eventTitle: context.eventTitle,
      eventTime: context.eventTime || "none",
    },
  );
}
