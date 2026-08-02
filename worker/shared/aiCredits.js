// Shared AI credit policy helpers.
// Pure functions only; database reads/writes stay in the caller.
import { isPremiumSubscriptionState } from "./subscriptionEntitlement.js";

function numberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function todayKey() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
}

export const FREE_AI_DAILY_INCLUDED_CREDITS = 5;
export const PREMIUM_AI_DAILY_INCLUDED_CREDITS = 20;

/**
 * @param {string | null | undefined} status
 * @param {string | null | undefined} trialEndsAt
 * @param {string | null | undefined} currentPeriodEnd
 * @param {Date} now
 */
export function isPremiumAiSubscriptionStatus(
    status,
    trialEndsAt = null,
    currentPeriodEnd = null,
    now = new Date(),
) {
    return isPremiumSubscriptionState(status, trialEndsAt, currentPeriodEnd, now);
}

// 상업 포함량과 부모 안전 상한은 서로 다른 정책이다. 부모 상한은
// applyParentDailyChatLimit에서 더 낮게 제한할 뿐, 구독 포함량을 늘리지 않는다.
export function resolveIncludedDailyLimit({ isPremium = false } = {}) {
    return isPremium ? PREMIUM_AI_DAILY_INCLUDED_CREDITS : FREE_AI_DAILY_INCLUDED_CREDITS;
}

export function buildPremiumAiCreditBalanceRow({
    familyId,
    childUserId,
    parentId = null,
    today = todayKey(),
    parentDailyLimit = null,
} = {}) {
    return buildAiCreditBalanceRow({
        familyId,
        childUserId,
        parentId,
        today,
        isPremium: true,
        parentDailyLimit,
    });
}

export function buildAiCreditBalanceRow({
    familyId,
    childUserId,
    parentId = null,
    today = todayKey(),
    isPremium = false,
    parentDailyLimit = null,
} = {}) {
    return {
        family_id: familyId || null,
        child_user_id: childUserId || null,
        parent_id: parentId || null,
        is_premium: !!isPremium,
        daily_included_limit: resolveIncludedDailyLimit({ isPremium, parentDailyLimit }),
        daily_included_used: 0,
        daily_reset_date: today,
        purchased_credits: 0,
    };
}

export function buildPremiumAiCreditBalanceSyncPatch(row = {}, { today = todayKey(), parentDailyLimit = null } = {}) {
    const balance = normalizeBalance(row, today);
    const includedLimit = resolveIncludedDailyLimit({ isPremium: true, parentDailyLimit });
    return {
        is_premium: true,
        daily_included_limit: includedLimit,
        daily_included_used: Math.min(balance.daily_included_used, includedLimit),
        daily_reset_date: today,
        updated_at: new Date().toISOString(),
    };
}

export function buildAiCreditBalanceSubscriptionSyncPatch(row = {}, {
    today = todayKey(),
    isPremium = false,
    parentDailyLimit = null,
} = {}) {
    if (isPremium) {
        return buildPremiumAiCreditBalanceSyncPatch(row, { today, parentDailyLimit });
    }
    const balance = normalizeBalance(row, today);
    return {
        is_premium: false,
        daily_included_limit: FREE_AI_DAILY_INCLUDED_CREDITS,
        daily_included_used: Math.min(balance.daily_included_used, FREE_AI_DAILY_INCLUDED_CREDITS),
        daily_reset_date: today,
        updated_at: new Date().toISOString(),
    };
}

function normalizeBalance(row = {}, today = todayKey()) {
    const resetDate = row.daily_reset_date === today ? row.daily_reset_date : today;
    const used = row.daily_reset_date === today
        ? Math.max(0, numberOr(row.daily_included_used, 0))
        : 0;
    return {
        family_id: row.family_id || null,
        child_user_id: row.child_user_id || null,
        parent_id: row.parent_id || null,
        is_premium: !!row.is_premium,
        daily_included_limit: Math.max(0, numberOr(row.daily_included_limit, FREE_AI_DAILY_INCLUDED_CREDITS)),
        daily_included_used: used,
        daily_reset_date: resetDate,
        purchased_credits: Math.max(0, numberOr(row.purchased_credits, 0)),
    };
}

export function getAiCreditStatus(row = {}, today = todayKey()) {
    const balance = normalizeBalance(row, today);
    const dailyIncludedLimit = balance.daily_included_limit;
    const dailyIncludedUsed = Math.min(balance.daily_included_used, dailyIncludedLimit);
    const dailyIncludedRemaining = Math.max(0, dailyIncludedLimit - dailyIncludedUsed);
    const purchasedCredits = balance.purchased_credits;

    return {
        canChat: dailyIncludedRemaining > 0 || purchasedCredits > 0,
        isPremium: balance.is_premium,
        dailyIncludedLimit,
        dailyIncludedUsed,
        dailyIncludedRemaining,
        dailyResetDate: balance.daily_reset_date,
        purchasedCredits,
    };
}

export function applyParentDailyChatLimit(status = {}, parentDailyLimit = null, dailyChargedCount = null) {
    const rawLimit = Number(parentDailyLimit);
    if (!Number.isFinite(rawLimit)) return status;

    const parentLimit = Math.max(0, Math.min(100, Math.round(rawLimit)));
    const fallbackUsed = numberOr(status.dailyIncludedUsed, 0);
    const parentUsed = Math.max(0, numberOr(dailyChargedCount, fallbackUsed));
    const parentRemaining = Math.max(0, parentLimit - parentUsed);
    const dailyIncludedRemaining = Math.min(
        Math.max(0, numberOr(status.dailyIncludedRemaining, 0)),
        parentRemaining,
    );
    const purchasedCredits = Math.max(0, numberOr(status.purchasedCredits, 0));

    return {
        ...status,
        canChat: parentRemaining > 0 && (dailyIncludedRemaining > 0 || purchasedCredits > 0),
        dailyIncludedRemaining,
        parentDailyLimit: parentLimit,
        parentDailyUsed: parentUsed,
        parentDailyRemaining: parentRemaining,
    };
}

export function consumeAiCredit(row = {}, {
    today = todayKey(),
    reason = "chat_response",
    messageId = null,
    transactionId = null,
} = {}) {
    const balance = normalizeBalance(row, today);
    const status = getAiCreditStatus(balance, today);

    if (!status.canChat) {
        return {
            ok: false,
            error: "insufficient_ai_credits",
            status,
        };
    }

    const usesDailyIncluded = status.dailyIncludedRemaining > 0;
    const source = usesDailyIncluded ? "daily_included" : "purchased_credit";
    const nextPurchasedCredits = usesDailyIncluded
        ? balance.purchased_credits
        : Math.max(0, balance.purchased_credits - 1);
    const nextDailyUsed = usesDailyIncluded
        ? status.dailyIncludedUsed + 1
        : status.dailyIncludedUsed;

    const balancePatch = {
        daily_included_used: nextDailyUsed,
        daily_reset_date: today,
        purchased_credits: nextPurchasedCredits,
        updated_at: new Date().toISOString(),
    };

    const ledgerEntry = {
        family_id: balance.family_id,
        child_user_id: balance.child_user_id,
        parent_id: balance.parent_id,
        delta: usesDailyIncluded ? 0 : -1,
        reason,
        source,
        message_id: messageId,
        transaction_id: transactionId,
    };

    return {
        ok: true,
        source,
        balancePatch,
        ledgerEntry,
        status: getAiCreditStatus({ ...balance, ...balancePatch }, today),
    };
}
