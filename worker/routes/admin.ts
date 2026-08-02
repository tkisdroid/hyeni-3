// 운영자(관리자) 전용 API — 전역 설정.
//
// 여기서 바꾸는 값은 **모든 가족의 아이**에게 함께 적용된다. 그래서 접근은 Worker secret
// ADMIN_USER_IDS 화이트리스트 하나로만 열리고(lib/adminAccess.ts), secret 이 없으면 아무도
// 통과하지 못한다(fail-closed). 일반 사용자에게는 관리자 API 의 존재 자체를 알리지 않도록
// 권한 없음은 404 로 응답한다.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { isAdminUserId } from "../lib/adminAccess.ts";
import {
  AI_CHILD_OPERATOR_PROMPT_KEY,
  OPERATOR_PROMPT_MAX_LENGTH,
  normalizeOperatorPrompt,
  readGlobalSetting,
  writeGlobalSetting,
} from "../lib/globalSettings.ts";
import {
  inspectCommerceRuntimeControls,
  writeCommerceRuntimeControls,
} from "../lib/commerceRuntimeControls.ts";

export const admin = new Hono<{ Bindings: Env; Variables: Vars }>();

/**
 * GET /api/admin/me — 현재 로그인 계정이 운영자인지.
 * 앱의 숨은 라우트 가드가 쓰며, 운영자가 아니어도 200 + isAdmin:false 로 답해
 * 화면이 "권한 없음"을 조용히 보여줄 수 있게 한다.
 */
admin.get("/me", requireAuth, (c) => {
  const user = c.get("user");
  return c.json({ isAdmin: isAdminUserId(c.env, user.sub) });
});

/** GET /api/admin/ai-prompt — 아이 AI 친구 전역 운영자 지침 조회. */
admin.get("/ai-prompt", requireAuth, async (c) => {
  const user = c.get("user");
  if (!isAdminUserId(c.env, user.sub)) return c.json({ error: "not_found" }, 404);
  const record = await readGlobalSetting(c.env.DB, AI_CHILD_OPERATOR_PROMPT_KEY);
  return c.json({
    prompt: record.value,
    updatedBy: record.updatedBy,
    updatedAt: record.updatedAt,
    maxLength: OPERATOR_PROMPT_MAX_LENGTH,
  });
});

/**
 * PUT /api/admin/ai-prompt — 전역 운영자 지침 저장.
 * 빈 문자열은 "지침 없음"으로의 정상 되돌리기다(삭제 대신 빈 값 저장).
 */
admin.put("/ai-prompt", requireAuth, async (c) => {
  const user = c.get("user");
  if (!isAdminUserId(c.env, user.sub)) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<{ prompt?: unknown }>().catch(() => null);
  if (!body || !("prompt" in body)) return c.json({ error: "invalid_body" }, 400);
  if (typeof body.prompt !== "string") return c.json({ error: "invalid_prompt" }, 400);
  if (body.prompt.length > OPERATOR_PROMPT_MAX_LENGTH * 2) {
    // 정규화 전 원문이 상한의 2배를 넘으면 잘라 저장하지 않고 명시적으로 거절한다.
    return c.json({ error: "prompt_too_long", maxLength: OPERATOR_PROMPT_MAX_LENGTH }, 400);
  }

  const prompt = normalizeOperatorPrompt(body.prompt);
  try {
    const saved = await writeGlobalSetting(
      c.env.DB,
      AI_CHILD_OPERATOR_PROMPT_KEY,
      prompt,
      user.sub,
    );
    return c.json({
      prompt: saved.value,
      updatedBy: saved.updatedBy,
      updatedAt: saved.updatedAt,
      maxLength: OPERATOR_PROMPT_MAX_LENGTH,
    });
  } catch (error) {
    console.error("[admin] ai-prompt save failed");
    return c.json({ error: "save_failed" }, 503);
  }
});

/** 신규 결제만 즉시 열고 닫는 운영 제어. 기존 주문 처리·해지·환불에는 적용하지 않는다. */
admin.get("/commerce-controls", requireAuth, async (c) => {
  const user = c.get("user");
  if (!isAdminUserId(c.env, user.sub)) return c.json({ error: "not_found" }, 404);
  try {
    const state = await inspectCommerceRuntimeControls(c.env.DB);
    return c.json({ ...state.controls, configured: state.configured });
  } catch {
    console.error("[admin] commerce controls read failed");
    return c.json({ error: "commerce_controls_unavailable" }, 503);
  }
});

admin.put("/commerce-controls", requireAuth, async (c) => {
  const user = c.get("user");
  if (!isAdminUserId(c.env, user.sub)) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (
    !body
    || typeof body.webSubscriptionNewCheckoutsEnabled !== "boolean"
    || typeof body.webAiCreditNewCheckoutsEnabled !== "boolean"
  ) return c.json({ error: "invalid_commerce_controls" }, 400);
  try {
    const controls = await writeCommerceRuntimeControls(c.env.DB, {
      webSubscriptionNewCheckoutsEnabled: body.webSubscriptionNewCheckoutsEnabled,
      webAiCreditNewCheckoutsEnabled: body.webAiCreditNewCheckoutsEnabled,
    }, user.sub);
    return c.json(controls);
  } catch {
    console.error("[admin] commerce controls save failed");
    return c.json({ error: "save_failed" }, 503);
  }
});
