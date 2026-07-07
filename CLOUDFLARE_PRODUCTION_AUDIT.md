# CLOUDFLARE_PRODUCTION_AUDIT

작성일: 2026-07-08 KST

## 결론

프론트엔드 변경분은 Cloudflare Pages에 배포했다. Worker 코드는 변경하지 않았고 typecheck만 수행했다.

## Pages

| 항목 | 결과 |
|---|---|
| 배포 명령 | `npx wrangler pages deploy dist --project-name=hyeni-calendar --branch=main --commit-dirty=true` |
| 배포 URL | `https://c09f59d1.hyeni-calendar.pages.dev` |
| production URL | `https://hyeni-calendar.pages.dev` |
| HTTP smoke | 두 URL 200 |
| manifest | `https://hyeni-calendar.pages.dev/manifest.webmanifest` 200 |

## Worker

| 항목 | 결과 |
|---|---|
| 위치 | `C:\Users\TK\Desktop\hyeni-1\worker` |
| typecheck | `npx tsc --noEmit` exit 0 |
| 배포 | 이번 변경은 프론트만이라 Worker 배포 없음 |

## 바인딩

- D1: `DB` -> `hyeni-calendar`
- R2: `PHOTOS` -> `child-photos`
- Durable Objects: `FamilyRoom`, `TeacherRoom`
