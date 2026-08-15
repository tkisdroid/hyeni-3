export const messageNamespaces = [
  "core",
  "onboarding",
  "parent",
  "child",
  "shared",
  "billing",
  "reports",
  "notifications",
  "android"
] as const;

export type MessageNamespace = (typeof messageNamespaces)[number];

export const messageIds = [
  "core.action.back",
  "core.action.retry",
  "core.brand.name",
  "core.error.unknown",
  "core.state.loading"
] as const;

export type MessageId = (typeof messageIds)[number];

export type CatalogMessages = Readonly<Record<string, string>>;

export interface CatalogModule {
  default: CatalogMessages;
}
