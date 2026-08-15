export interface DataExportSectionUnavailable {
  section: string;
  unavailable: true;
}

export function dataExportSectionUnavailable(section: string): DataExportSectionUnavailable {
  return { section, unavailable: true };
}

export function serializePublicDataExport(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
