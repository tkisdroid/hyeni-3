import { useState } from "react";
import type { EphemeralMapSearchCandidate, MapProvider } from "@/lib/api/endpoints/maps";
import { MapAttribution } from "./MapAttribution";

export interface MapSearchResultsState {
  provider: MapProvider;
  sessionHandle: string;
  candidates: EphemeralMapSearchCandidate[];
}

export function MapSearchResults({
  result,
  onSelect,
}: {
  result: MapSearchResultsState | null;
  onSelect: (candidate: EphemeralMapSearchCandidate) => Promise<void>;
}) {
  const [selectingId, setSelectingId] = useState<string | null>(null);
  if (!result || result.candidates.length === 0) return null;
  return (
    <div className="fm-search-results">
      <ul>
        {result.candidates.map((candidate) => (
          <li key={candidate.providerPlaceId}>
            <button
              type="button"
              disabled={selectingId !== null}
              aria-busy={selectingId === candidate.providerPlaceId}
              onClick={async () => {
                setSelectingId(candidate.providerPlaceId);
                try { await onSelect(candidate); } finally { setSelectingId(null); }
              }}
            >
              <strong>{candidate.primaryText}</strong>
              {candidate.secondaryText && <span>{candidate.secondaryText}</span>}
            </button>
          </li>
        ))}
      </ul>
      <MapAttribution provider={result.provider} />
    </div>
  );
}
