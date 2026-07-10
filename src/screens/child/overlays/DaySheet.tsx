/**
 * 오늘 시간표 시트 — 지도 노드나 상단 시간표 칩을 누르면 열린다.
 *
 * 시안에는 "알림장 · 월요일에 줄넘기 검사가 있어요!" 배너가 있지만, 아이가 볼 수 있는 알림장
 * 엔드포인트가 서버에 없다. 문장을 지어내는 대신 **부모님이 오늘 보낸 최신 메시지**를 띄운다
 * (없으면 배너 자체를 감춘다). 아이 홈에서 부모 소식을 놓치지 않게 하려는 자리이기도 하다.
 */
import { asset } from "@/lib/assets";
import { ChildSheet } from "./ChildSheet";
import type { ChildTimetableRow } from "../ChildTimetable";
import { ChildTimetableList } from "../ChildTimetable";

export interface DaySheetProps {
  open: boolean;
  onClose: () => void;
  dateLabel: string;
  rows: readonly ChildTimetableRow[];
  /** 부모님 최신 메시지(없으면 배너 숨김). */
  parentNote: string | null;
  onOpenMemo: () => void;
}

export function DaySheet({ open, onClose, dateLabel, rows, parentNote, onOpenMemo }: DaySheetProps) {
  return (
    <ChildSheet open={open} onClose={onClose} label="오늘 시간표">
      <div className="ks-head">
        <img src={asset("ui/calendar-heart.webp")} alt="" />
        <span className="ks-head__title">오늘 시간표</span>
        <span className="ks-head__badge">{dateLabel}</span>
      </div>

      {parentNote && (
        <button type="button" className="ks-day__notice hy-press" onClick={onOpenMemo}>
          <img src={asset("ui/megaphone.webp")} alt="" />
          <span>부모님 · {parentNote}</span>
        </button>
      )}

      <div className="ks-day__list">
        <ChildTimetableList rows={rows} compact />
      </div>

      <button type="button" className="ks-cta ks-cta--ghost hy-press" onClick={onClose}>
        알겠어!
      </button>
    </ChildSheet>
  );
}
