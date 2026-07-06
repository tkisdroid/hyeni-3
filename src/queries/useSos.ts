/**
 * 자녀 SOS 도메인 TanStack Query 훅.
 *
 * ⚠️ 쓰기(부모 긴급 알림) 뮤테이션 — 자동 실행 절대 금지.
 *    반드시 화면의 SOS 버튼 onClick(꾹 누르기 완료/보내기)에서만 .mutate() 호출.
 *    컴포넌트 마운트·타 effect·타이머 단독 호출 금지.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "./useFamily";
import { sendSos, type SendSosResult } from "@/lib/api/endpoints/sos";
import { fetchParentAlerts, type ParentAlert } from "@/lib/api/endpoints/notifications";

/** 발송 시점의 자녀 현재 위치(없으면 위치 단계 skip). */
export interface SosPosition {
  lat?: number | null;
  lng?: number | null;
}

/**
 * 자녀 SOS 발송 뮤테이션.
 * familyId·발신 자녀 user_id 는 useAuth 에서, 부모 수신자·자녀 이름은 가족 캐시에서 파생한다.
 * 위치(lat/lng)는 화면이 navigator.geolocation 으로 취득해 mutate 인자로 넘긴다.
 * 서버 단계별 실패는 sendSos 가 내부에서 흡수하므로 mutate 는 좀처럼 reject 되지 않는다
 * (familyId/userId 부재 시에만 결과가 전부 false).
 */
export function useSendSos() {
  const { familyId, userId } = useAuth();
  const { data: family } = useMyFamily();

  return useMutation<SendSosResult, unknown, SosPosition>({
    mutationFn: (pos: SosPosition) => {
      const members = family?.members ?? [];
      const parentUserIds = members
        .filter((m) => m.role === "parent" && m.user_id)
        .map((m) => m.user_id as string);
      const me = members.find((m) => m.user_id === userId);
      return sendSos({
        familyId: familyId ?? "",
        childUserId: userId ?? "",
        lat: pos.lat ?? null,
        lng: pos.lng ?? null,
        parentUserIds,
        childName: me?.name,
      });
    },
  });
}

/**
 * 부모용 수신 SOS 목록(최신순).
 *
 * 서버에 sos_events 조회(GET) 엔드포인트는 없다 — 부모 쪽 SOS 수신은
 * parent_alerts(alert_type='sos', severity='urgent')로 도달한다(sendSos 2단계).
 * 그래서 parentAlerts 캐시를 그대로 공유(qk.parentAlerts)하고 select 로 sos 만 거른다.
 * → useParentAlerts 와 캐시/무효화(읽음 처리 후 refetch)가 자동 정합한다.
 * WS parent_alerts INSERT 브릿지가 이 키를 무효화하므로 새 SOS 가 실시간 반영된다.
 */
export function useReceivedSos(opts?: { pollMs?: number }) {
  const { familyId, status } = useAuth();
  return useQuery<ParentAlert[], unknown, ParentAlert[]>({
    queryKey: qk.parentAlerts(familyId ?? ""),
    queryFn: () => fetchParentAlerts(familyId as string, 50),
    enabled: status === "authenticated" && !!familyId,
    refetchInterval: opts?.pollMs && opts.pollMs > 0 ? opts.pollMs : false,
    select: (all) => all.filter((a) => a.alert_type === "sos"),
  });
}
