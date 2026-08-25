import type { IntlShape } from "react-intl";
import type { MessageId } from "../i18n/generated/messageIds.ts";
import { withDefaultIntl } from "../i18n/defaultIntl.ts";

export interface DeviceLabelSource {
  deviceLabel?: string | null;
  manufacturer?: string | null;
  model?: string | null;
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized || null;
}

function formatModel(model: string, intl: IntlShape): string {
  if (/^SM-/i.test(model)) {
    return intl.formatMessage({ id: "shared.device.manufacturer.samsung" as MessageId }, { model });
  }
  return model;
}

/**
 * 부모 화면의 기기명은 마지막 네이티브 상태 보고에 담긴 실제 모델을 우선한다.
 * 기기 교체·테스트 뒤 남을 수 있는 오래된 device_label을 최신 상태보다 앞세우지 않는다.
 */
export function resolveDeviceLabel(
  source: DeviceLabelSource,
  providedIntl?: IntlShape,
): string | null {
  const intl = withDefaultIntl(providedIntl);
  const model = clean(source.model);
  if (model) return formatModel(model, intl);
  return clean(source.deviceLabel);
}
