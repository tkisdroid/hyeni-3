export interface DeviceLabelSource {
  deviceLabel?: string | null;
  manufacturer?: string | null;
  model?: string | null;
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized || null;
}

function formatModel(model: string): string {
  if (/^SM-/i.test(model)) return `삼성 ${model}`;
  return model;
}

/**
 * 부모 화면의 기기명은 마지막 네이티브 상태 보고에 담긴 실제 모델을 우선한다.
 * 기기 교체·테스트 뒤 남을 수 있는 오래된 device_label을 최신 상태보다 앞세우지 않는다.
 */
export function resolveDeviceLabel(source: DeviceLabelSource): string | null {
  const model = clean(source.model);
  if (model) return formatModel(model);
  return clean(source.deviceLabel);
}
