/**
 * 네이티브(Android/Capacitor) 전용 초기화 — 인증 상태에 맞춰 딥링크·푸시·백그라운드위치.
 * 웹(PWA)에선 전부 no-op(isNativePlatform 가드). App 하위(AuthProvider 안)에 1회 마운트.
 * ToastProvider 순서에 의존하지 않도록 useToast 미사용(실패는 콘솔 로깅).
 */
import { useEffect } from "react";
import { useAuth } from "@/auth/AuthContext";
import { isNativePlatform } from "@/lib/native/plugins";
import { initOAuthDeepLink } from "@/lib/native/oauthDeepLink";
import { initPush, disposePush } from "@/lib/native/push";
import {
  adoptNativeLocationSessionTokens,
  startLocationTracking,
  stopLocationTracking,
  syncNativeLocationToken,
} from "@/lib/native/location";
import { collectDeviceHealth, attachBatteryChange } from "@/lib/native/deviceStatus";
import { detectDeviceLabel } from "@/lib/native/deviceName";
import { reportDeviceStatus, reportDeviceLabel } from "@/lib/api/endpoints/family";
import { fetchLocationPreferences } from "@/lib/api/endpoints/location";

// 아이 기기 상태 리포트 주기(ms). 부모 '안전 지표'가 이 주기로 갱신된다.
const DEVICE_REPORT_INTERVAL_MS = 120_000;
const LOCATION_PREF_SYNC_INTERVAL_MS = 60_000;

export function NativeBootstrap() {
  const { status, userId, familyId, role, syncFromSession } = useAuth();

  // OAuth 딥링크(hyenicalendar://auth-callback) 리스너 — 1회 등록. 성공 시 role 홈 이동은 내장.
  useEffect(() => {
    if (!isNativePlatform()) return;
    return initOAuthDeepLink((r) => {
      if (!r.ok) console.error("OAuth 딥링크 처리 실패:", r.error);
    });
  }, []);

  // 인증 확정 → FCM 푸시 등록. 로그아웃 → 정리.
  useEffect(() => {
    if (!isNativePlatform()) return;
    if (status === "authenticated" && familyId && userId) {
      void (async () => {
        if (await adoptNativeLocationSessionTokens()) syncFromSession();
        await syncNativeLocationToken();
        await initPush({ userId, familyId, role: role ?? undefined });
      })();
    } else {
      void (async () => {
        if (await adoptNativeLocationSessionTokens()) {
          syncFromSession();
          return;
        }
        await disposePush();
        await stopLocationTracking();
      })();
    }
  }, [status, userId, familyId, role, syncFromSession]);

  // 아이 네이티브 위치 서비스 — 부모가 저장한 가족 위치 주기 설정을 읽어 반영한다.
  useEffect(() => {
    if (!isNativePlatform()) return;
    if (status !== "authenticated" || role !== "child" || !familyId || !userId) {
      void (async () => {
        if (await adoptNativeLocationSessionTokens()) {
          syncFromSession();
          return;
        }
        await stopLocationTracking();
      })();
      return;
    }

    let cancelled = false;
    const syncPrefsAndService = () => {
      void (async () => {
        try {
          if (await adoptNativeLocationSessionTokens()) syncFromSession();
          const prefs = await fetchLocationPreferences(familyId);
          if (cancelled) return;
          if (!prefs.background_enabled) {
            await stopLocationTracking();
            return;
          }
          await startLocationTracking({
            familyId,
            userId,
            intervalMode: prefs.interval_mode,
          });
        } catch (error) {
          console.error("위치 전송 설정 동기화 실패:", error);
          if (!cancelled) {
            await startLocationTracking({ familyId, userId, intervalMode: "balanced" });
          }
        }
      })();
    };

    syncPrefsAndService();
    const timer = window.setInterval(syncPrefsAndService, LOCATION_PREF_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status, role, familyId, userId, syncFromSession]);

  // 아이 기기 상태(배터리·충전·네트워크) 리포트 → 부모 '안전 지표' 실데이터원.
  // 웹(PWA) 자녀 전용: Web API(getBattery/onLine/connection)로 배터리·네트워크만 리포트.
  // ⚠️ 네이티브(Android)에서는 하지 않는다 — LocationService(백그라운드 위치 서비스)가
  //    배터리·네트워크·화면시간·최근 사용앱까지 리치한 device_health 를 이미 publish 하므로,
  //    web 부분집합으로 덮어쓰면 최근앱/화면시간이 사라진다(사용자 리포트 버그).
  // 아이 세션 + 웹에서만: 마운트 1회 + 120초 주기 + online/offline·배터리 변화 이벤트에 리포트.
  useEffect(() => {
    if (status !== "authenticated" || role !== "child" || !familyId || !userId) return;
    if (isNativePlatform()) return; // 네이티브는 LocationService 가 리치 리포트 담당

    let cancelled = false;
    let detachBattery: (() => void) | null = null;

    const send = () => {
      void (async () => {
        try {
          const health = await collectDeviceHealth(Date.now());
          if (cancelled) return;
          await reportDeviceStatus(familyId, health);
        } catch (error) {
          console.error("아이 기기 상태 리포트 실패:", error);
        }
      })();
    };

    send(); // 마운트 즉시 1회(부모가 곧바로 실데이터를 보게)
    const timer = window.setInterval(send, DEVICE_REPORT_INTERVAL_MS);
    window.addEventListener("online", send);
    window.addEventListener("offline", send);
    void attachBatteryChange(send).then((detach) => {
      if (cancelled) detach?.(); // 이미 정리됐으면 즉시 해제
      else detachBattery = detach;
    });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", send);
      window.removeEventListener("offline", send);
      detachBattery?.();
    };
  }, [status, role, familyId, userId]);

  // 아이 기기명(device_label) 1회 리포트 → 부모 '아이 관리/현황'에 기기명 표시.
  // 네이티브·웹 아이 세션 공통(플랫폼 무관). device_health 를 건드리지 않는 라벨 단독 PATCH 라
  // 네이티브 LocationService 의 리치 리포트와 독립적이다(UA 기반이라 기기 재부팅에도 안정).
  useEffect(() => {
    if (status !== "authenticated" || role !== "child" || !familyId) return;
    const label = detectDeviceLabel();
    if (!label) return;
    void reportDeviceLabel(familyId, label).catch((error) => {
      console.error("기기명 리포트 실패:", error);
    });
  }, [status, role, familyId]);

  return null;
}
