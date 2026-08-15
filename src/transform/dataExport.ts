export interface DataExportSectionUnavailable {
  section: string;
  unavailable: true;
}

export function dataExportSectionUnavailable(section: string): DataExportSectionUnavailable {
  return { section, unavailable: true };
}

export interface DataExportSectionLoaders<Events, SavedPlaces, DangerZones, Academies> {
  events(): Promise<Events[]>;
  savedPlaces(): Promise<SavedPlaces[]>;
  dangerZones(): Promise<DangerZones[]>;
  academies(): Promise<Academies[]>;
}

export interface CollectedDataExportSections<Events, SavedPlaces, DangerZones, Academies> {
  values: {
    events: Events[];
    savedPlaces: SavedPlaces[];
    dangerZones: DangerZones[];
    academies: Academies[];
  };
  errors: DataExportSectionUnavailable[];
}

/** production builder와 테스트가 함께 쓰는 부분 실패 수집 경계. */
export async function collectDataExportSections<Events, SavedPlaces, DangerZones, Academies>(
  loaders: DataExportSectionLoaders<Events, SavedPlaces, DangerZones, Academies>,
): Promise<CollectedDataExportSections<Events, SavedPlaces, DangerZones, Academies>> {
  const errors: DataExportSectionUnavailable[] = [];
  const safe = async <T>(section: string, load: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await load();
    } catch {
      errors.push(dataExportSectionUnavailable(section));
      return [];
    }
  };
  const events = await safe("events", loaders.events);
  const savedPlaces = await safe("savedPlaces", loaders.savedPlaces);
  const dangerZones = await safe("dangerZones", loaders.dangerZones);
  const academies = await safe("academies", loaders.academies);
  return {
    values: { events, savedPlaces, dangerZones, academies },
    errors,
  };
}

export function serializePublicDataExport(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
