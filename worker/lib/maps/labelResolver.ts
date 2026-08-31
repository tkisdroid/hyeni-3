import { resolveMapPolicy } from "../../../shared/mapPolicy.ts";
import type { Env } from "../../types.ts";
import { createGoogleMapAdapter } from "./google.ts";
import { createGoogleMapsTokenProvider } from "./googleOAuth.ts";
import { createKakaoMapAdapter } from "./kakao.ts";

/** 백그라운드 안전 전이는 label 실패와 분리한다. provider 원문·좌표는 저장하거나 로그하지 않는다. */
export async function resolveFamilyMapLabel(input: {
  env: Env;
  familyId: string;
  point: { lat: number; lng: number };
  locale?: string;
}): Promise<string | null> {
  try {
    const family = await input.env.DB.prepare("SELECT country_code FROM families WHERE id=? LIMIT 1")
      .bind(input.familyId)
      .first<{ country_code: string }>();
    const policy = resolveMapPolicy(family?.country_code);
    if (policy.provider === "unsupported") return null;
    const adapter = policy.provider === "kakao"
      ? createKakaoMapAdapter(input.env)
      : createGoogleMapAdapter({
          countryCode: policy.countryCode,
          tokenProvider: createGoogleMapsTokenProvider(input.env.GOOGLE_MAPS_SERVICE_ACCOUNT_JSON ?? ""),
          routesOauthVerified: false,
        });
    return await adapter.reverse(input.point, input.locale ?? "ko");
  } catch {
    return null;
  }
}
