import { useIntl } from "react-intl";
import type { VocabularyLevel } from "./learningExtrasContracts";

export const VOCABULARY_LEVEL_IDS: Record<VocabularyLevel, string> = {
  1: "study.vocabulary.level1", 2: "study.vocabulary.level2", 3: "study.vocabulary.level3",
  4: "study.vocabulary.level4", 5: "study.vocabulary.level5",
};

export function VocabularySources() {
  const intl = useIntl();
  return <details className="vocabulary-sources">
    <summary>{intl.formatMessage({ id: "study.vocabulary.sources" })}</summary>
    <p>{intl.formatMessage({ id: "study.vocabulary.sourceNote" })}</p>
    <a href="https://ko.wiktionary.org/wiki/위키낱말사전:저작권" target="_blank" rel="noopener noreferrer">{intl.formatMessage({ id: "study.vocabulary.wiktionarySource" })}</a>
    <a href="https://www.cefr-j.org/download.html" target="_blank" rel="noopener noreferrer">{intl.formatMessage({ id: "study.vocabulary.cefrSource" })}</a>
    <a href="/learning/vocabulary-catalog.json" download>{intl.formatMessage({ id: "study.vocabulary.download" })}</a>
    <a href="/learning/VOCABULARY-ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">{intl.formatMessage({ id: "study.vocabulary.licenseDetails" })}</a>
  </details>;
}
