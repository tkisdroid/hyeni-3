import { useNavigate } from "react-router-dom";
import { ChevronLeft, Plus, Trash2, TriangleAlert } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useSavedPlaces, useDangerZones, useDeleteDangerZone, useDeleteSavedPlace } from "@/queries/useLocation";
import { useEntitlement } from "@/queries/useEntitlement";
import { placeLimitFor, TIERS } from "@/transform/tierPolicy";
import { resolvePlaceVisual } from "@/transform/placeVisual";
import { Loading } from "@/components/ui/Loading";
import "./PlaceManager.css";

export function PlaceManager() {
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
  const retryPlaces = async () => {
    await Promise.all([placesQuery.refetch(), zonesQuery.refetch()]);
  };

  const handleAddPlace = () => {
    if (tier !== TIERS.UNKNOWN) {
      const limit = placeLimitFor(tier);
      const count = places.length;
      if (count >= limit) {
        show(`현재 플랜에서는 장소 ${limit}개까지 저장할 수 있어요`, "👑");
        return;
      }
    }
    navigate("/place-form");
  };

  const handleDeleteZone = (id: string, name: string) => {
    deleteZone.mutate(id, {
      onSuccess: () => show(`‘${name}’ 위험구역을 삭제했어요`, "🗑️"),
      onError: () => show("삭제에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️"),
    });
  };

  const handleDeletePlace = (id: string, name: string) => {
    deletePlace.mutate(id, {
      onSuccess: () => show(`‘${name}’ 장소를 삭제했어요`, "🗑️"),
      onError: () => show("삭제에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️"),
    });
  };

  return (
    <div className="pm-screen">
      <div className="pm-header">
        <button type="button" className="pm-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="pm-title">장소 관리</span>
        <button type="button" className="pm-add hy-press" aria-label="장소 추가" onClick={handleAddPlace}>
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
          <div className="pm-label pm-label--saved">저장한 장소</div>
          <div className="pm-list">
            {placesLoading && <Loading label="저장한 장소를 불러오는 중" size={6} />}
            {placesError && !placesLoading && (
              <div className="pm-item__addr" style={{ padding: 16 }} role="alert">
                장소를 불러오지 못했어요. <button type="button" className="hy-section-action hy-press" onClick={() => void retryPlaces()}>다시 시도</button>
              </div>
            )}
            {!placesLoading && !placesError && places.length === 0 && (
              <div className="pm-item__addr" style={{ padding: 16 }}>저장한 장소가 없어요</div>
            )}
            {!placesLoading && !placesError && places.map((p) => {
              const visual = resolvePlaceVisual(p);
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
                  <div className="pm-item__addr">{p.location?.address ?? "주소 미등록"}</div>
                </div>
                {/* 편집(프리필) 미지원 — 빈 등록폼 오인 방지로 편집은 비노출. 삭제만 제공. */}
                <button
                  type="button"
                  className="pm-item__del hy-press"
                  aria-label={`${p.name} 삭제`}
                  onClick={() => handleDeletePlace(p.id, p.name)}
                  disabled={deletePlace.isPending}
                  aria-busy={deletePlace.isPending && deletePlace.variables === p.id}
                >
                  <Trash2 size={18} strokeWidth={2.2} color="#8B7E84" />
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
              위험구역
            </div>
            <button
              type="button"
              className="pm-zone-add hy-press"
              onClick={() => navigate("/danger-zone-form")}
            >
              + 구역
            </button>
          </div>
          <div className="pm-list">
            {zonesLoading && <Loading label="위험구역을 불러오는 중" size={6} />}
            {zonesError && !zonesLoading && (
              <div className="pm-danger__addr" style={{ padding: 16 }} role="alert">
                위험구역을 불러오지 못했어요. <button type="button" className="hy-section-action hy-press" onClick={() => void retryPlaces()}>다시 시도</button>
              </div>
            )}
            {!zonesLoading && !zonesError && zones.length === 0 && (
              <div className="pm-danger__addr" style={{ padding: 16 }}>등록된 위험구역이 없어요</div>
            )}
            {!zonesLoading && !zonesError && zones.map((z) => (
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
                    <div className="pm-danger__addr">반경 {z.radius_m}m · 접근 시 알림</div>
                  </div>
                </button>
                <button
                  type="button"
                  className="pm-danger__del hy-press"
                  aria-label={`${z.name} 삭제`}
                  onClick={() => handleDeleteZone(z.id, z.name)}
                  disabled={deleteZone.isPending}
                  aria-busy={deleteZone.isPending && deleteZone.variables === z.id}
                >
                  <Trash2 size={18} strokeWidth={2.2} color="#C0334C" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
