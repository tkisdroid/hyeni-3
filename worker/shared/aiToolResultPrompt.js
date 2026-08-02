export function sanitizeAiToolResultForPrompt(result) {
    if (!result) return null;

    if (result.toolName === "callParent" && result.ok) {
        return {
            ok: true,
            toolName: "callParent",
            parentRole: result.parentRole,
            displayName: result.displayName,
            contactReady: true,
            confirmationRequired: true,
        };
    }

    const sanitized = { ...result };
    delete sanitized.confirmationToken;
    return sanitized;
}
