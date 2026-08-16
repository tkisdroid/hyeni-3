// 아이 AI 가 준비물·숙제를 기존 daily_supplies compact JSON 행에 병합한다.
// 클라이언트 encodeSupplyItems({i,t,d}) 계약과 같은 형태만 만든다.

const MAX_ITEMS = 8;
const MAX_LABEL = 24;
const SAFE_LEN = 460;

function newItemId() {
    return Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 4);
}

function normalizeLabel(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function decodeDailyChecklist(text) {
    const raw = String(text ?? "").trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error("not_array");
        return parsed
            .filter((row) => row && typeof row === "object")
            .map((row) => ({
                i: typeof row.i === "string" && row.i ? row.i : newItemId(),
                t: String(row.t ?? "").slice(0, MAX_LABEL),
                d: row.d === 1 || row.d === true ? 1 : 0,
            }))
            .filter((row) => row.t);
    } catch {
        return raw
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
            .map((label) => ({ i: newItemId(), t: label.slice(0, MAX_LABEL), d: 0 }));
    }
}

export function encodeDailyChecklist(items) {
    let bounded = (Array.isArray(items) ? items : []).slice(0, MAX_ITEMS).map((item) => ({
        i: item.i,
        t: String(item.t ?? "").slice(0, MAX_LABEL),
        d: item.d ? 1 : 0,
    }));
    if (bounded.length === 0) return "";
    let out = JSON.stringify(bounded);
    while (out.length > SAFE_LEN && bounded.length > 1) {
        bounded = bounded.slice(0, bounded.length - 1);
        out = JSON.stringify(bounded);
    }
    return out;
}

export function mergeDailyChecklistItem(existingText, label) {
    const clean = String(label || "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
    if (!clean) return { ok: false, error: "missing_label", items: decodeDailyChecklist(existingText) };
    const items = decodeDailyChecklist(existingText);
    const key = normalizeLabel(clean);
    if (items.some((item) => normalizeLabel(item.t) === key)) {
        return { ok: true, added: false, duplicate: true, items, label: clean };
    }
    if (items.length >= MAX_ITEMS) {
        return { ok: false, error: "daily_supply_limit_exceeded", items, label: clean };
    }
    items.push({ i: newItemId(), t: clean, d: 0 });
    return { ok: true, added: true, duplicate: false, items, label: clean };
}

export function dailyItemKindFromText(text) {
    return /숙제|숙제장|숙제물/.test(String(text || "")) ? "hw" : "prep";
}
