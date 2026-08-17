/**
 * 네이티브(Android/Capacitor) 초기화와 웹·PWA foreground pending fallback.
 * App 하위(AuthProvider 안)에 1회 마운트.
 * ToastProvider 순서에 의존하지 않도록 useToast 미사용(실패는 콘솔 로깅).
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { getNativePlugin, isNativePlatform } from "@/lib/native/plugins";
import { initOAuthDeepLink } from "@/lib/native/oauthDeepLink";
import { initReferralDeepLink } from "@/lib/native/referralDeepLink";
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
import {
  fetchDevicePendingNotifications,
  fetchNotifSettings,
  fetchParentPendingNotifications,
  markPendingNotificationsDelivered,
} from "@/lib/api/endpoints/notifications";
import {
  pollParentPendingNotifications,
  presentWebPendingNotification,
  startParentPendingForegroundPolling,
  type ParentPendingDisplayResult,
  type ParentPendingPresentation,
} from "@/lib/native/parentPendingNotifications";
import { announceGlobalToast } from "@/lib/globalToast";
import { restoreGooglePlaySubscriptions } from "@/lib/native/billing";
import { qk } from "@/queries/keys";
import {
  createNativeQueryResumeCoordinator,
  resumeActiveQueriesAfterNativeForeground,
} from "@/queries/nativeQueryResume";
import { syncWebPushSessionContext, wasWebPushDisplayed } from "@/lib/webPush";
import { syncNativeNotificationQuietHours } from "@/lib/native/notificationQuietHours";
import { getApiSessionInstanceId, getApiUser } from "@/lib/api/session";
import { DEFAULT_NOTIFICATION_QUIET_HOURS } from "@/transform/notificationQuietHours";
import { parseServerTimestamp } from "@/transform/locationView";
import { useLocale } from "@/i18n/useLocale";
import type { SupportedLocale } from "@/i18n/locale";

// 아이 기기 상태 리포트 주기(ms). 부모 '안전 지표'가 이 주기로 갱신된다.
const DEVICE_REPORT_INTERVAL_MS = 120_000;
const LOCATION_PREF_SYNC_INTERVAL_MS = 60_000;
const BILLING_RESTORE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const lastBillingRestoreByFamily = new Map<string, number>();
const billingRestoreInFlight = new Set<string>();

interface NativeNotificationPlugin {
  showPending(input: ParentPendingPresentation): Promise<ParentPendingDisplayResult>;
}

interface AppLocalePlugin {
  setLocale(input: { locale: SupportedLocale }): Promise<{ locale: SupportedLocale }>;
}

function createNativeLocaleSyncScheduler(
  writeLocale: (locale: SupportedLocale) => Promise<void>,
  onError: () => void,
) {
  let pendingLocale: SupportedLocale | null = null;
  let drainPromise: Promise<void> | null = null;

  const drain = async () => {
    try {
      while (pendingLocale !== null) {
        const locale = pendingLocale;
        pendingLocale = null;
        try {
          await writeLocale(locale);
        } catch {
          onError();
        }
      }
    } finally {
      drainPromise = null;
    }
  };

  const ensureDrain = (): Promise<void> => {
    if (drainPromise) return drainPromise;
    drainPromise = drain();
    return drainPromise;
  };

  return {
    request(locale: SupportedLocale): Promise<void> {
      pendingLocale = locale;
      return ensureDrain();
    },
  };
}

const nativeAppLocaleScheduler = createNativeLocaleSyncScheduler(
  async (locale) => {
    if (!isNativePlatform()) return;
    const plugin = getNativePlugin<AppLocalePlugin>("AppLocale");
    if (!plugin) return;
    await plugin.setLocale({ locale });
  },
  () => {
    console.warn("native_locale_sync_failed");
  },
);

export function syncNativeAppLocale(locale: SupportedLocale): Promise<void> {
  return nativeAppLocaleScheduler.request(locale);
}

export function NativeBootstrap() {
  const { status, userId, familyId, role, syncFromSession } = useAuth();
  const queryClient = useQueryClient();
  const { locale } = useLocale();

  // locale runtime의 웹 전환이 끝난 뒤 Android 앱별 locale에도 알린다.
  // 플러그인이 아직 없거나 실패해도 웹 locale과 세션은 그대로 유지한다.
  useEffect(() => {
    void syncNativeAppLocale(locale);
  }, [locale]);

  // PWA service worker는 localStorage를 읽을 수 없으므로 현재 세션의 최소 대상 정보만
  // 별도 저장한다. 구독 권한 요청은 설정 화면의 사용자 버튼에서만 수행한다.
  useEffect(() => {
    if (isNativePlatform()) return;
    const context = status === "authenticated"
      && userId
      && familyId
      && (role === "parent" || role === "child")
      ? { userId, familyId, role }
      : null;
    void syncWebPushSessionContext(context);
  }, [status, userId, familyId, role]);

  // OAuth verified App Link 리스너 — 1회 등록. 성공 시 role 홈 이동은 내장.
  useEffect(() => {
    if (!isNativePlatform()) return;
    return initOAuthDeepLink((r) => {
      if (!r.ok) console.error("OAuth 딥링크 처리 실패:", r.errorCode);
    });
  }, []);

  // 친구 초대 App Link·Play 설치 추천은 OAuth 와 분리해 코드만 영속한다.
  useEffect(() => {
    if (!isNativePlatform()) return;
    return initReferralDeepLink();
  }, []);

  // Android WebView 포그라운드 조회 복구 — 브라우저 visibilitychange가 오지 않아도
  // 세션을 먼저 조정한 뒤 현재 화면의 읽기 query만 갱신한다. TanStack 전역 focus
  // 신호는 paused mutation까지 재개하므로 사용하지 않는다.
  useEffect(() => {
    if (!isNativePlatform()) return;
    let disposed = false;
    let listener: { remove(): Promise<void> } | null = null;

    const coordinator = createNativeQueryResumeCoordinator({
      resume: () => resumeActiveQueriesAfterNativeForeground({
        adoptSession: adoptNativeLocationSessionTokens,
        syncSession: syncFromSession,
        waitForAuthRender: () => new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        }),
        isDisposed: () => disposed,
        refetchActiveQueries: async () => {
          await queryClient.refetchQueries(
            { type: "active" },
            { cancelRefetch: true }
          );
        },
      }),
      onError: (error) => {
        console.warn("Android 포그라운드 활성 조회 갱신 실패:", error);
      },
    });

    const attach = async () => {
      const { App } = await import("@capacitor/app");
      const initialState = await App.getState();
      if (disposed) return;
      coordinator.initialize(initialState.isActive);

      const handle = await App.addListener("appStateChange", (state) => {
        coordinator.handleAppState(state.isActive);
      });
      if (disposed) {
        coordinator.dispose();
        await handle.remove();
        return;
      }
      listener = handle;

      const currentState = await App.getState();
      if (!disposed) coordinator.handleAppState(currentState.isActive);
    };

    void attach().catch((error: unknown) => {
      if (!disposed) console.warn("Android 앱 상태 리스너 등록 실패:", error);
    });

    return () => {
      disposed = true;
      coordinator.dispose();
      void listener?.remove();
    };
  }, [queryClient, syncFromSession]);

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

  // 서버 정본의 사용자별 조용한 시간을 Android 표시 경로에 바인딩한다. 조회가
  // 늦게 끝나는 동안 로그아웃·계정 전환이 일어나면 결과를 절대 새 세션에 쓰지 않는다.
  useEffect(() => {
    if (!isNativePlatform()) return;
    if (status !== "authenticated" || !userId) return;
    if (role !== "parent" && role !== "child") return;

    const expectedUserId = userId;
    const expectedSessionInstanceId = getApiSessionInstanceId()?.trim() ?? "";
    if (!expectedSessionInstanceId) return;

    let disposed = false;
    let listener: { remove(): Promise<void> } | null = null;

    const isCurrentSession = () => {
      if (disposed) return false;
      if (getApiUser()?.id !== expectedUserId) return false;
      if ((getApiSessionInstanceId()?.trim() ?? "") !== expectedSessionInstanceId) return false;
      return true;
    };

    const syncQuietHours = () => {
      if (!isCurrentSession()) return;
      void fetchNotifSettings()
        .then(async (settings) => {
          if (!isCurrentSession()) return;
          const quietHours = settings?.quietHours ?? DEFAULT_NOTIFICATION_QUIET_HOURS;
          const parsedUpdatedAt = quietHours.updatedAt === null
            ? 0
            : (parseServerTimestamp(quietHours.updatedAt)?.getTime() ?? Number.NaN);
          if (!Number.isFinite(parsedUpdatedAt) || parsedUpdatedAt < 0) {
            console.warn("Android 알림 시간 동기화 응답 시각이 올바르지 않아요");
            return;
          }
          // native 호출 바로 전에도 사용자와 로그인 instance를 다시 확인한다.
          if (!isCurrentSession()) return;
          const saved = await syncNativeNotificationQuietHours({
            userId: expectedUserId,
            enabled: quietHours.enabled,
            startMinute: quietHours.startMinute,
            endMinute: quietHours.endMinute,
            timeZoneId: "Asia/Seoul",
            updatedAtMs: parsedUpdatedAt,
          });
          if (isCurrentSession() && !saved) {
            console.warn("Android 알림 시간 동기화를 반영하지 못했어요");
          }
        })
        .catch((error: unknown) => {
          if (!disposed) console.warn("Android 알림 시간 조회 실패:", error);
        });
    };

    syncQuietHours();
    void import("@capacitor/app")
      .then(async ({ App }) => {
        const handle = await App.addListener("appStateChange", (state) => {
          if (state.isActive) syncQuietHours();
        });
        if (disposed) await handle.remove();
        else listener = handle;
      })
      .catch((error: unknown) => {
        if (!disposed) console.warn("Android 알림 시간 상태 리스너 등록 실패:", error);
      });

    return () => {
      disposed = true;
      void listener?.remove();
    };
  }, [status, userId, role]);

  // 부모 앱 시작·foreground 복귀 시 기존 Play 구독을 재검증한다. 자동갱신 후 서버
  // current_period_end가 첫 결제 기간에 멈춰 무료로 오강등되는 것을 막는다.
  useEffect(() => {
    if (!isNativePlatform()) return;
    if (status !== "authenticated" || role !== "parent" || !familyId || !userId) return;
    let disposed = false;
    let listener: { remove(): Promise<void> } | null = null;

    const restore = () => {
      const now = Date.now();
      const last = lastBillingRestoreByFamily.get(familyId) ?? 0;
      if (now - last < BILLING_RESTORE_INTERVAL_MS || billingRestoreInFlight.has(familyId)) return;
      billingRestoreInFlight.add(familyId);
      void restoreGooglePlaySubscriptions(familyId)
        .then(async (count) => {
          lastBillingRestoreByFamily.set(familyId, Date.now());
          if (!disposed && count > 0) {
            await queryClient.invalidateQueries({ queryKey: qk.entitlement(familyId) });
          }
        })
        .catch((error) => {
          console.warn("Google Play 구독 갱신 동기화 실패:", error);
        })
        .finally(() => {
          billingRestoreInFlight.delete(familyId);
        });
    };

    restore();
    void import("@capacitor/app").then(async ({ App }) => {
      const handle = await App.addListener("appStateChange", (state) => {
        if (state.isActive) restore();
      });
      if (disposed) await handle.remove();
      else listener = handle;
    });

    return () => {
      disposed = true;
      void listener?.remove();
    };
  }, [status, role, familyId, userId, queryClient]);

  // 부모·아이 네이티브 foreground fallback — FCM을 놓친 표시형 pending만 회수한다.
  // 네이티브 명령은 pollParentPendingNotifications에서 제외해 LocationService가 성공 후 ACK한다.
  // NativeNotification이 같은 pushId의 FCM ACK를 확인하므로 이미 본 알림은 다시 울리지 않는다.
  useEffect(() => {
    if (!isNativePlatform()) return;
    if (status !== "authenticated" || !familyId || !userId) return;
    if (role !== "parent" && role !== "child") return;
    const pendingRole = role;
    const nativeNotification = getNativePlugin<NativeNotificationPlugin>("NativeNotification");
    if (!nativeNotification) return;

    return startParentPendingForegroundPolling(async (signal) => {
      await pollParentPendingNotifications({
        familyId,
        userId,
        signal,
        fetchPending: pendingRole === "parent"
          ? fetchParentPendingNotifications
          : (targetFamilyId, targetUserId) => (
              fetchDevicePendingNotifications(targetFamilyId, targetUserId, pendingRole)
            ),
        showPending: (input) => nativeNotification.showPending(input),
        markDelivered: markPendingNotificationsDelivered,
      });
    });
  }, [status, role, familyId, userId]);

  // 웹·PWA는 Android FCM fallback 서비스가 없으므로, 부모·아이 foreground에서
  // 서버 pending을 인앱 토스트로 실제 표시한 뒤에만 delivered ACK한다.
  useEffect(() => {
    if (isNativePlatform()) return;
    if (status !== "authenticated" || !familyId || !userId) return;
    if (role !== "parent" && role !== "child") return;
    const pendingRole = role;

    return startParentPendingForegroundPolling(async (signal) => {
      await pollParentPendingNotifications({
        familyId,
        userId,
        signal,
        fetchPending: (targetFamilyId, targetUserId) => (
          fetchDevicePendingNotifications(targetFamilyId, targetUserId, pendingRole)
        ),
        showPending: async (input) => {
          if (await wasWebPushDisplayed(input.stableId, { familyId, userId })) {
            return { acknowledged: true, displayed: false };
          }
          if (signal.aborted) return { acknowledged: false, displayed: false };
          return presentWebPendingNotification(input, announceGlobalToast);
        },
        markDelivered: markPendingNotificationsDelivered,
      });
    });
  }, [status, role, familyId, userId]);

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
