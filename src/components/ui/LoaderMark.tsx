import { asset } from "@/lib/assets";

/** 일반 로딩 = 캘린더, 지도·경로 로딩 = 위치. 두 가지뿐이다. */
export type LoaderMarkVariant = "calendar" | "location";

/**
 * 공용 로딩 마크 — 앱의 화면 로딩은 전부 이 그림을 쓴다.
 *
 * 애니메이션 webp 는 CSS 로 멈출 수 없으므로 움직임 줄이기에서는 <picture> 가
 * 정지 프레임을 대신 내려준다(점 3개 로더의 reduced-motion 처리와 같은 원칙).
 *
 * ⚠️ 크기·배치는 소비 화면 CSS 의 몫이다 — `--loader-mark-size` 로 정한다.
 *    공용 컴포넌트에 인라인 style 로 크기를 주면 소비 화면의 클래스를 덮어쓴다.
 *
 * 상태 안내(role=status·aria-label)는 감싸는 쪽이 맡고 이 그림은 장식으로 넘긴다.
 */
export function LoaderMark({ variant = "calendar" }: { variant?: LoaderMarkVariant }) {
  return (
    <picture className="hy-loader-mark" aria-hidden="true">
      <source
        media="(prefers-reduced-motion: reduce)"
        srcSet={asset(`ui/loader-${variant}-still.webp`)}
        type="image/webp"
      />
      <img
        src={asset(`ui/loader-${variant}.webp`)}
        alt=""
        width={256}
        height={256}
        loading="eager"
        decoding="async"
      />
    </picture>
  );
}
