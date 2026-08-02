// supabase/functions/_shared/kakaoReverseGeocode.js
// Server-side (Deno) reverse geocoding: coordinate → "○○동 건물명" label via the
// Kakao Local REST API. The client uses the Kakao Maps JS SDK (window.kakao,
// src/lib/reverseGeocode.js) which the edge cannot use, so this calls the dapi REST
// endpoint directly. The label parser is a faithful port of src/lib/placeFormat.js
// (buildCompactAddressLabel / extractNeighborhoodLabel / formatCompactPlaceName) so
// server labels read identically to the app's. Pure parser + thin fetch wrapper.

// ── label parser (port of src/lib/placeFormat.js) ───────────────────────────
export function extractNeighborhoodLabel(label, source = {}) {
    const directLabel = [
        source?.region_3depth_h_name,
        source?.region_3depth_name,
        source?.region_2depth_name,
    ].find((value) => String(value || "").trim());
    if (directLabel) return String(directLabel).trim();

    const text = String(label || "").trim();
    if (!text || text.startsWith("좌표")) return "";

    const tokens = text
        .split(/\s+/)
        .map((part) => part.replace(/[(),]/g, "").trim())
        .filter(Boolean);
    const neighborhood = tokens.find((part) => /(동|읍|면|리)$/.test(part));
    if (neighborhood) return neighborhood;

    return tokens.find((part) => /(구|군|시)$/.test(part)) || "";
}

export function formatCompactPlaceName(value) {
    return String(value || "")
        .replace(/([가-힣])(\d+차)/g, "$1 $2")
        .replace(/\s*\d+\s*동(?=\s|$)/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// resultItem = Kakao coord2address documents[0] = { road_address, address }.
export function buildCompactAddressLabel(resultItem) {
    const road = resultItem?.road_address || null;
    const lot = resultItem?.address || null;
    const neighborhood = extractNeighborhoodLabel("", lot)
        || extractNeighborhoodLabel("", road)
        || extractNeighborhoodLabel(lot?.address_name)
        || extractNeighborhoodLabel(road?.address_name);
    const buildingName = formatCompactPlaceName(road?.building_name);

    if (neighborhood && buildingName) return `${neighborhood} ${buildingName}`;
    if (neighborhood && road?.road_name) return `${neighborhood} ${formatCompactPlaceName(road.road_name)}`;
    if (neighborhood) return neighborhood;
    return formatCompactPlaceName(road?.address_name || lot?.address_name || "");
}

// ── REST fetch ──────────────────────────────────────────────────────────────
// GET https://dapi.kakao.com/v2/local/geo/coord2address.json?x=<lng>&y=<lat>
// Header: Authorization: KakaoAK <REST key>. NOTE x=lng, y=lat (Kakao order).
// Returns documents[0] ({road_address, address}) or null on any failure (caller
// falls back to a coordinate label so the alert still fires).
export async function fetchKakaoCoord2Address(lat, lng, restKey, fetchImpl = fetch) {
    if (!restKey || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    try {
        const url = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${encodeURIComponent(lng)}&y=${encodeURIComponent(lat)}`;
        const res = await fetchImpl(url, { headers: { Authorization: `KakaoAK ${restKey}` } });
        if (!res.ok) {
            console.error("[kakao] coord2address failed");
            return null;
        }
        const body = await res.json();
        const doc = Array.isArray(body?.documents) ? body.documents[0] : null;
        return doc || null;
    } catch (err) {
        console.error("[kakao] coord2address error");
        return null;
    }
}

// High-level: coordinate → "○○동 건물명" label, or null if unavailable.
export async function reverseGeocodeAreaLabel(lat, lng, restKey, fetchImpl = fetch) {
    const doc = await fetchKakaoCoord2Address(lat, lng, restKey, fetchImpl);
    if (!doc) return null;
    const label = buildCompactAddressLabel(doc);
    return label && label.trim() ? label.trim() : null;
}
