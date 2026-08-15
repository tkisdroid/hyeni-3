import { catalogLoaders } from "./generated/catalogLoaders.ts";
import type {
  CatalogMessages,
  MessageNamespace,
} from "./generated/messageIds";
import { localeFallbackChain, type SupportedLocale } from "./locale.ts";

export interface LoadedNamespace {
  namespace: MessageNamespace;
  resolvedLocale: SupportedLocale;
  messages: CatalogMessages;
}

export type NamespaceLoader = (
  locale: SupportedLocale,
  namespace: MessageNamespace,
) => Promise<CatalogMessages>;

async function loadGeneratedNamespace(
  locale: SupportedLocale,
  namespace: MessageNamespace,
): Promise<CatalogMessages> {
  const module = await catalogLoaders[locale][namespace]();
  return module.default;
}

export async function loadNamespaceAtomically(args: {
  locale: SupportedLocale;
  namespace: MessageNamespace;
  load?: NamespaceLoader;
}): Promise<LoadedNamespace> {
  const load = args.load ?? loadGeneratedNamespace;
  let lastError: unknown;

  for (const candidate of localeFallbackChain(args.locale)) {
    try {
      const messages = await load(candidate, args.namespace);
      return {
        namespace: args.namespace,
        resolvedLocale: candidate,
        messages,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${args.locale}/${args.namespace} 카탈로그를 불러오지 못했습니다.`);
}
