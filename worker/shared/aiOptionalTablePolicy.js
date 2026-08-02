export function isRecoverableOptionalAiTableError(error) {
    if (!error) return false;
    const code = String(error.code || "");
    if (code === "42P01" || code === "PGRST205") return true;
    const message = String(error.message || "").toLowerCase();
    return message.includes("schema cache") && message.includes("public.ai_");
}
