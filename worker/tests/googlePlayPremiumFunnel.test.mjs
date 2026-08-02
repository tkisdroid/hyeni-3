import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const typeScriptResolutionHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
after(() => typeScriptResolutionHook.deregister());

const { classifyGooglePlayPremiumFunnelTransition } = await import(
  pathToFileURL(resolve(workerDir, "lib/googlePlayPremiumFunnel.ts")).href
);

const NOW = new Date("2026-08-01T12:00:00.000Z");
const CURRENT_END = "2026-08-31T12:00:00.000Z";
const NEXT_END = "2026-09-30T12:00:00.000Z";

function verified(overrides = {}) {
  return {
    status: "active",
    basePlanId: "monthly-2900",
    currentPeriodEnd: CURRENT_END,
    trialEndsAt: null,
    ...overrides,
  };
}

function previous(overrides = {}) {
  return {
    status: "active",
    provider: "google_play",
    basePlanId: "monthly-2900",
    currentPeriodEnd: CURRENT_END,
    trialEndsAt: null,
    ...overrides,
  };
}

test("Google Play 신규 체험과 최초 유료 활성화만 확정 이벤트로 분류한다", () => {
  assert.deepEqual(classifyGooglePlayPremiumFunnelTransition({
    previous: null,
    verified: verified({
      status: "trial",
      currentPeriodEnd: "2026-08-08T12:00:00.000Z",
      trialEndsAt: "2026-08-08T12:00:00.000Z",
    }),
    notificationType: null,
    now: NOW,
  }), { event: "trial_start", plan: "month" });

  assert.deepEqual(classifyGooglePlayPremiumFunnelTransition({
    previous: null,
    verified: verified(),
    notificationType: null,
    now: NOW,
  }), { event: "entitlement_activated", plan: "month" });

  assert.deepEqual(classifyGooglePlayPremiumFunnelTransition({
    previous: previous({
      status: "trial",
      currentPeriodEnd: "2026-08-08T12:00:00.000Z",
      trialEndsAt: "2026-08-08T12:00:00.000Z",
    }),
    verified: verified(),
    notificationType: 2,
    now: NOW,
  }), { event: "entitlement_activated", plan: "month" });
});

test("동일 기간 재검증은 무시하고 실제 Google Play 기간 연장만 renewal이다", () => {
  assert.equal(classifyGooglePlayPremiumFunnelTransition({
    previous: previous(),
    verified: verified(),
    notificationType: 2,
    now: NOW,
  }), null);

  assert.deepEqual(classifyGooglePlayPremiumFunnelTransition({
    previous: previous(),
    verified: verified({ currentPeriodEnd: NEXT_END }),
    notificationType: 2,
    now: NOW,
  }), { event: "renewal", plan: "month" });

  assert.equal(classifyGooglePlayPremiumFunnelTransition({
    previous: previous({ provider: "toss_payments" }),
    verified: verified({ currentPeriodEnd: NEXT_END }),
    notificationType: 2,
    now: NOW,
  }), null);
});

test("refund는 RTDN revoke와 재검증된 expired가 함께 확인될 때만 분류한다", () => {
  const expired = verified({
    status: "expired",
    currentPeriodEnd: "2026-08-01T11:59:59.000Z",
  });
  assert.deepEqual(classifyGooglePlayPremiumFunnelTransition({
    previous: previous(),
    verified: expired,
    notificationType: 12,
    now: NOW,
  }), { event: "refund", plan: "month" });

  assert.equal(classifyGooglePlayPremiumFunnelTransition({
    previous: previous(),
    verified: expired,
    notificationType: 13,
    now: NOW,
  }), null);
  assert.equal(classifyGooglePlayPremiumFunnelTransition({
    previous: previous(),
    verified: verified(),
    notificationType: 12,
    now: NOW,
  }), null);
});

test("미확정 상태와 허용되지 않은 base plan은 퍼널 이벤트를 만들지 않는다", () => {
  for (const candidate of [
    verified({ status: "grace" }),
    verified({ status: "cancelled" }),
    verified({ status: "expired" }),
    verified({ basePlanId: "untrusted-plan" }),
  ]) {
    assert.equal(classifyGooglePlayPremiumFunnelTransition({
      previous: null,
      verified: candidate,
      notificationType: null,
      now: NOW,
    }), null);
  }

  assert.deepEqual(classifyGooglePlayPremiumFunnelTransition({
    previous: null,
    verified: verified({ basePlanId: "annual-27840" }),
    notificationType: null,
    now: NOW,
  }), { event: "entitlement_activated", plan: "year" });
});
