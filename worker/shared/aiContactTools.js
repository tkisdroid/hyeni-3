function normalizeText(value) {
    return String(value || "").trim();
}

export function normalizePhoneForTel(value) {
    const text = normalizeText(value);
    if (!text) return "";
    const normalized = text.replace(/[^\d+]/g, "");
    const digits = normalized.replace(/[^\d]/g, "");
    if (digits.length < 8 || digits.length > 15) return "";
    if (normalized.startsWith("+")) {
        return `+${digits}`;
    }
    return digits;
}

function parentLabelForRole(parentRole) {
    if (parentRole === "mom") return "엄마";
    if (parentRole === "dad") return "아빠";
    return "보호자";
}

function withPhone(member) {
    return normalizePhoneForTel(member?.phone).length > 0;
}

function matchesRequestedParentRole(member, parentRole) {
    if (member?.gender === parentRole) return true;
    const name = normalizeText(member?.name);
    return !!name && name.includes(parentLabelForRole(parentRole));
}

function toContact(member, parentRole) {
    const phone = normalizePhoneForTel(member?.phone);
    const displayName = normalizeText(member?.name) || parentLabelForRole(parentRole);
    return {
        ok: true,
        parentRole,
        displayName,
        telHref: `tel:${phone}`,
    };
}

export function selectParentContactForRole(members, parentRole = "guardian") {
    const role = ["mom", "dad", "guardian"].includes(parentRole) ? parentRole : "guardian";
    const parents = (Array.isArray(members) ? members : [])
        .filter((member) => member?.role === "parent")
        .filter(withPhone);

    if (role === "mom" || role === "dad") {
        const matched = parents.find((member) => matchesRequestedParentRole(member, role));
        if (matched) return toContact(matched, role);
        return {
            ok: false,
            error: "parent_contact_not_found",
            parentRole: role,
        };
    }

    const fallback = parents[0];
    if (fallback) return toContact(fallback, role);

    return {
        ok: false,
        error: "parent_contact_not_found",
        parentRole: role,
    };
}
