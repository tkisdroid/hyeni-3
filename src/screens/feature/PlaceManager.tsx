import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useIntl } from "react-intl";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { PremiumUpsell } from "@/components/PremiumUpsell";
import { useSavedPlaces, useDangerZones, useDeleteDangerZone, useDeleteSavedPlace } from "@/queries/useLocation";
import { useEntitlement } from "@/queries/useEntitlement";
import {
  browserPremiumReturnIntentStorage,
  savePremiumReturnIntent,
} from "@/transform/premiumReturnIntent";
import { placeLimitFor, TIERS } from "@/transform/tierPolicy";
import { resolvePlaceVisual } from "@/transform/placeVisual";
import {
  parseTierAlertActivation,
  tierAlertActivationLabel,
} from "@/transform/tierAlertActivation";
import { Loading } from "@/components/ui/Loading";
import "./PlaceManager.css";

export function PlaceManager() {
  const intl = useIntl();
  const navigate = useNavigate();
  const { show } = useToast();
  const placesQuery = useSavedPlaces();
  const zonesQuery = useDangerZones();
  const places = placesQuery.data ?? [];
  const zones = zonesQuery.data ?? [];
  const placesLoading = placesQuery.isLoading;
  const zonesLoading = zonesQuery.isLoading;
  const placesError = placesQuery.isError;
  const zonesError = zonesQuery.isError;
  const deleteZone = useDeleteDangerZone();
  const deletePlace = useDeleteSavedPlace();
  const { tier } = useEntitlement();
  const [upsellOpen, setUpsellOpen] = useState(false);
  const retryPlaces = async () => {
    await Promise.all([placesQuery.refetch(), zonesQuery.refetch()]);
  };

  const handleAddPlace = () => {
    if (tier !== TIERS.UNKNOWN) {
      const limit = placeLimitFor(tier);
      const count = places.length;
      if (count >= limit) {
        setUpsellOpen(true);
        return;
      }
    }
    navigate("/place-form");
  };

  // 삭제는 도착·위험 알림을 함께 끄는 되돌릴 수 없는 동작이라 한 번의 탭으로 실행하지 않는다.
  // 설정의 로그아웃과 같은 방식으로 첫 탭은 확인 대기, 5초 안의 두 번째 탭에서만 삭제한다.
  const [armedDeleteKey, setArmedDeleteKey] = useState<string | null>(null);
  useEffect(() => {
    if (!armedDeleteKey) return undefined;
    const timer = window.setTimeout(() => setArmedDeleteKey(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [armedDeleteKey]);
  const confirmThenDelete = (key: string, run: () => void) => {
    if (armedDeleteKey !== key) {
      setArmedDeleteKey(key);
      return;
    }
    setArmedDeleteKey(null);
    run();
  };

  const handleDeleteZone = (id: string, name: string) => {
    deleteZone.mutate(id, {
      onSuccess: () => show(intl.formatMessage({ id: "notifications.placeManager.zoneDeleted" }, { name }), "🗑️"),
      onError: () => show(intl.formatMessage({ id: "notifications.placeManager.deleteFailed" }), "⚠️"),
    });
  };

  const handleDeletePlace = (id: string, name: string) => {
    deletePlace.mutate(id, {
      onSuccess: () => show(intl.formatMessage({ id: "notifications.placeManager.placeDeleted" }, { name }), "🗑️"),
      onError: () => show(intl.formatMessage({ id: "notifications.placeManager.deleteFailed" }), "⚠️"),
    });
  };

  return (
    <div className="pm-screen">
      <div className="pm-header">
        <button type="button" className="pm-back hy-press" aria-label={intl.formatMessage({ id: "notifications.action.back" })} onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="pm-title">{intl.formatMessage({ id: "notifications.placeManager.title" })}</span>
        <button type="button" className="pm-add hy-press" aria-label={intl.formatMessage({ id: "notifications.placeManager.addPlace" })} onClick={handleAddPlace}>
          <Plus size={20} strokeWidth={2.4} color="#fff" />
        </button>
      </div>

      <div className="hy-content pm-content">
        {/* 히어로 배너 */}
        <div className="pm-hero">
          <span className="pm-hero__blob pm-hero__blob--a" />
          <span className="pm-hero__blob pm-hero__blob--b" />
          <span className="pm-hero__streak" />
          <img className="pm-hero__pin" src={asset("ui/place-home.webp")} alt="" style={{ top: 34, left: 60, width: 32, height: 32 }} />
          <img className="pm-hero__pin" src={asset("ui/place-academy.webp")} alt="" style={{ top: 62, right: 78, width: 32, height: 32 }} />
          <img className="pm-hero__pin" src={asset("ui/menu-place-manager.webp")} alt="" style={{ bottom: 22, left: 120, width: 32, height: 32 }} />
        </div>

        {/* 저장한 장소 */}
        <div>
          <div className="pm-label pm-label--saved">{intl.formatMessage({ id: "notifications.placeManager.savedPlaces" })}</div>
          <div className="pm-list">
            {placesLoading && <Loading label={intl.formatMessage({ id: "notifications.placeManager.savedPlacesLoading" })} compact />}
            {placesError && !placesLoading && (
              <div className="pm-item__addr" style={{ padding: 16 }} role="alert">
                {intl.formatMessage({ id: "notifications.placeManager.savedPlacesError" })}{" "}
                <button type="button" className="hy-section-action hy-press" onClick={() => void retryPlaces()}>
                  {intl.formatMessage({ id: "notifications.action.retry" })}
                </button>
              </div>
            )}
            {/* 빈 목록은 '없어요' 한 줄로 끝내지 않는다 — 무엇을 등록하면 무엇이 좋아지는지와 바로 할 버튼을 둔다. */}
            {!placesLoading && !placesError && places.length === 0 && (
              <div className="pm-empty hy-tile">
                <div className="pm-empty__title">{intl.formatMessage({ id: "notifications.placeManager.savedPlacesEmpty" })}</div>
                <p className="pm-empty__hint">{intl.formatMessage({ id: "notifications.placeManager.savedPlacesEmptyHint" })}</p>
                <button type="button" className="pm-empty__cta hy-press" onClick={handleAddPlace}>
                  <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                  {intl.formatMessage({ id: "notifications.placeManager.addPlace" })}
                </button>
              </div>
            )}
            {!placesLoading && !placesError && places.map((p) => {
              const visual = resolvePlaceVisual(p, intl);
              const alertState = parseTierAlertActivation(p);
              return (
              <div key={p.id} className="pm-item">
                <span className="pm-item__icon" data-tone={visual.tone}>
                  <img src={asset(visual.assetPath)} alt="" />
                </span>
                <div className="pm-item__main">
                  <div className="pm-item__name">
                    <span>{p.name}</span>
                    <span className="pm-item__badge">{visual.label}</span>
                  </div>
                  <div className="pm-item__addr">
                    {p.location?.address ?? intl.formatMessage({ id: "notifications.placeManager.addressMissing" })}
                  </div>
                  <div className="pm-alert-state" data-state={alertState}>
                    {tierAlertActivationLabel(alertState, intl)}
                  </div>
                </div>
                {/* 편집(프리필) 미지원 — 빈 등록폼 오인 방지로 편집은 비노출. 삭제만 제공. */}
                <button
                  type="button"
                  className="pm-item__del hy-press"
                  data-armed={armedDeleteKey === `place:${p.id}` ? "true" : "false"}
                  aria-label={intl.formatMessage(
                    { id: armedDeleteKey === `place:${p.id}` ? "notifications.placeManager.deleteConfirmAria" : "notifications.placeManager.deleteAria" },
                    { name: p.name },
                  )}
                  onClick={() => confirmThenDelete(`place:${p.id}`, () => handleDeletePlace(p.id, p.name))}
                  disabled={deletePlace.isPending}
                  aria-busy={deletePlace.isPending && deletePlace.variables === p.id}
                >
                  <Trash2 size={18} strokeWidth={2.2} color="#8B7E84" />
                  {armedDeleteKey === `place:${p.id}` && (
                    <span className="pm-del__confirm">{intl.formatMessage({ id: "notifications.placeManager.deleteConfirm" })}</span>
                  )}
                </button>
              </div>
              );
            })}
          </div>
        </div>

        {/* 위험구역 */}
        <div>
          <div className="pm-danger-head">
            <div className="pm-label pm-label--danger">
              <TriangleAlert size={16} strokeWidth={2.2} aria-hidden="true" />
              {intl.formatMessage({ id: "notifications.placeManager.dangerZones" })}
            </div>
            <button
              type="button"
              className="pm-zone-add hy-press"
              onClick={() => navigate("/danger-zone-form")}
            >
              {intl.formatMessage({ id: "notifications.placeManager.addZone" })}
            </button>
          </div>
          <div className="pm-list">
            {zonesLoading && <Loading label={intl.formatMessage({ id: "notifications.placeManager.dangerZonesLoading" })} compact />}
            {zonesError && !zonesLoading && (
              <div className="pm-danger__addr" style={{ padding: 16 }} role="alert">
                {intl.formatMessage({ id: "notifications.placeManager.dangerZonesError" })}{" "}
                <button type="button" className="hy-section-action hy-press" onClick={() => void retryPlaces()}>
                  {intl.formatMessage({ id: "notifications.action.retry" })}
                </button>
              </div>
            )}
            {/* 비어 있는 것은 경고가 아니다 — 빨간 글씨 대신 차분한 안내로 보여 준다. */}
            {!zonesLoading && !zonesError && zones.length === 0 && (
              <div className="pm-empty hy-tile">
                <div className="pm-empty__title">{intl.formatMessage({ id: "notifications.placeManager.dangerZonesEmpty" })}</div>
                <p className="pm-empty__hint">{intl.formatMessage({ id: "notifications.placeManager.dangerZonesEmptyHint" })}</p>
              </div>
            )}
            {!zonesLoading && !zonesError && zones.map((z) => {
              const alertState = parseTierAlertActivation(z);
              return (
              <div key={z.id} className="pm-danger">
                <button
                  type="button"
                  className="pm-danger__body hy-press"
                  onClick={() => navigate("/danger-zone-form", { state: { zone: z } })}
                >
                  <span className="pm-danger__icon">
                    <img src={asset("ui/place-caution.webp")} alt="" />
                  </span>
                  <div className="pm-danger__main">
                    <div className="pm-danger__name">{z.name}</div>
                    <div className="pm-danger__addr">
                      {intl.formatMessage({ id: "notifications.placeManager.zoneRadius" }, { radius: z.radius_m })}
                    </div>
                    <div className="pm-alert-state" data-state={alertState}>
                      {tierAlertActivationLabel(alertState, intl)}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  className="pm-danger__del hy-press"
                  data-armed={armedDeleteKey === `zone:${z.id}` ? "true" : "false"}
                  aria-label={intl.formatMessage(
                    { id: armedDeleteKey === `zone:${z.id}` ? "notifications.placeManager.deleteConfirmAria" : "notifications.placeManager.deleteAria" },
                    { name: z.name },
                  )}
                  onClick={() => confirmThenDelete(`zone:${z.id}`, () => handleDeleteZone(z.id, z.name))}
                  disabled={deleteZone.isPending}
                  aria-busy={deleteZone.isPending && deleteZone.variables === z.id}
                >
                  <Trash2 size={18} strokeWidth={2.2} color="#C0334C" />
                  {armedDeleteKey === `zone:${z.id}` && (
                    <span className="pm-del__confirm">{intl.formatMessage({ id: "notifications.placeManager.deleteConfirm" })}</span>
                  )}
                </button>
              </div>
              );
            })}
          </div>
        </div>
      </div>
      <PremiumUpsell
        open={upsellOpen}
        source="saved_place"
        tier={tier}
        usage={{ used: places.length, limit: placeLimitFor(tier) }}
        returnTo="/place-form"
        onClose={() => setUpsellOpen(false)}
        onUpgrade={({ source, feature, returnTo }) => {
          const storage = browserPremiumReturnIntentStorage();
          const saved = storage && returnTo
            ? savePremiumReturnIntent(storage, { source, feature, returnTo })
            : false;
          if (!saved) throw new Error(intl.formatMessage({ id: "notifications.placeManager.returnPathFailed" }));
          setUpsellOpen(false);
          navigate("/subscription");
        }}
      />
    </div>
  );
}
