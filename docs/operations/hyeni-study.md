# 혜니캘린더 학습관리 운영 런북

이 문서는 혜니스터디 production 롤아웃에서 혜니캘린더가 담당하는 서비스 바인딩, 부모 UI, 기능 플래그와 비파괴 롤백 절차를 고정한다. 실제 배포 버전과 D1 bookmark는 배포 직후 별도 증적에 기록하며, 확인되지 않은 값을 이 문서에 추정해 넣지 않는다.

## 고정 계약

- Calendar Worker: `hyeni-calendar-api`
- Calendar → Study binding: `STUDY_SERVICE`
- Study entrypoint: `CalendarStudyService`
- Calendar projection entrypoint: `CalendarProfileService`
- 기능 플래그: `app_global_settings.study_management_enabled`
- 부모 경로: `#/study-management`, `#/study-management/claim`
- 공개 Study 경로: `https://study.hyenicalendar.com/math/`
- 학습관리 문구: 한국어 전용

Study 문구는 Calendar locale catalog에 추가하지 않는다. 기존 비학습 화면의 locale 및 생성 catalog는 배포 전후 동일해야 한다.

## 배포 전 확인

Calendar 최종 기능 브랜치에서 다음을 실행한다. macOS에서는 Android 병합 manifest 테스트가 같은 JDK를 사용하도록 JDK 17을 명령에만 주입한다.

```bash
npm ci
npm run typecheck:worker
npm run test:worker
npm run typecheck
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
PATH=/opt/homebrew/opt/openjdk@17/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
npm test
npm run build
npm run qa:browser
npx wrangler deploy --dry-run --config worker/wrangler.toml
```

필수 결과:

- Worker와 웹 테스트의 fail 수가 0이다.
- 브라우저 QA에서 부모 45화면, 아이 14화면, 문제 0건이다.
- `study-management`와 `study-management/claim`이 부모 전용으로 통과한다.
- Study 한국어 문구 검사와 기존 locale catalog 비변경 검사가 통과한다.
- Worker dry-run에 `STUDY_SERVICE`가 `hyeni-study#CalendarStudyService`로 표시된다.

## dark 배포 순서

1. Study projection만 포함한 검증된 Calendar 커밋을 별도 worktree에서 먼저 배포한다.
2. Calendar `/api/health`가 기존과 동일하게 ready인지 읽는다.
3. Study workers.dev와 양방향 service binding이 검증된 뒤에만 전체 Calendar Worker를 배포한다.
4. 이때 `study_management_enabled`는 없거나 `false`여야 한다.
5. `STUDY_ACTOR_REF_SECRET`이 이미 있으면 보존한다. 없을 때만 새 값을 write-only로 생성하며 원문을 출력하거나 증적에 남기지 않는다.
6. Worker version, health status, 기능 상태 `disabled`, 기존 cron trigger 수를 개인정보 없이 기록한다.

전체 Worker 배포 전에는 다음 조회가 정확히 0행 또는 값 `false`인지 확인한다.

```sql
SELECT key, value, updated_by, updated_at
FROM app_global_settings
WHERE key = 'study_management_enabled';
```

## 공개 활성화

Study workers.dev dark E2E와 공개 `/math/` readback이 모두 통과한 뒤에만 Calendar Pages를 배포한다. Pages의 새 JS/CSS 해시가 배포 URL, `hyeni-calendar.pages.dev`, `hyenicalendar.com`에서 일치하고 학습관리 카드가 아직 숨겨진 상태인지 확인한다.

플래그 변경 직전 Calendar D1 Time Travel bookmark를 기록한다. 그런 다음 아래 한 키만 변경한다.

```sql
INSERT INTO app_global_settings (key, value, updated_by, updated_at)
VALUES (
  'study_management_enabled',
  'true',
  'rollout:hyeni-study-2026-08-24',
  datetime('now')
)
ON CONFLICT(key) DO UPDATE SET
  value = 'true',
  updated_by = 'rollout:hyeni-study-2026-08-24',
  updated_at = datetime('now');
```

같은 키를 즉시 다시 읽어 정확히 한 행, 값 `true`를 요구한다. 다른 global setting은 변경하지 않는다.

## 운영 확인

- 기존 primary-parent 세션의 role, family, notification registration이 전후 동일하다.
- 부모 홈의 학습관리 카드는 기존 8개 바로가기 앞에 표시되며 바로가기 수를 늘리지 않는다.
- 활성 자녀만 탭과 리포트에 보이고 inactive/ghost 자녀는 제외된다.
- 부모는 학년을 수정하거나 문제를 만들지 않고 리포트, 연결 QR, 기기 해제만 관리한다.
- 실제 Study submission 한 건이 Calendar 리포트의 count, accuracy, recent session에 반영된다.
- QR 재사용은 거부되고, 기기 해제 후에도 D1 학습 이력은 보존된다.
- Study 동작으로 Calendar auth `Set-Cookie`나 refresh 회전이 발생하지 않는다.

증적에는 상태, 건수, 해시, HMAC pseudonym, Worker/Pages version만 남긴다. 이름, 원본 family/member ID, 쿠키, access/refresh token, QR fragment, 알림 endpoint, R2 경로는 기록하지 않는다.

## 비파괴 롤백

장애 시 다음 순서로 영향만 닫는다.

1. `study_management_enabled` 한 키를 `false`로 변경하고 즉시 readback한다.
2. 검증된 직전 Calendar Pages production deployment로 롤백하거나, 현재 소스를 카드가 숨겨진 상태로 재배포한다.
3. Study custom route를 제거하고 Study Worker를 재배포해 기존 origin fingerprint가 복구됐는지 확인한다.
4. 필요한 경우 기록된 직전 Calendar/Study Worker version으로 코드와 정적 자산만 롤백한다.
5. D1 schema, content, 연결된 profile, attempt/progress, tombstone은 그대로 보존한다.

플래그 비활성화 SQL은 다음 한 키만 대상으로 한다.

```sql
INSERT INTO app_global_settings (key, value, updated_by, updated_at)
VALUES (
  'study_management_enabled',
  'false',
  'rollback:hyeni-study-2026-08-24',
  datetime('now')
)
ON CONFLICT(key) DO UPDATE SET
  value = 'false',
  updated_by = 'rollback:hyeni-study-2026-08-24',
  updated_at = datetime('now');
```

`wrangler d1 time-travel restore`는 정상 롤백 명령에 포함하지 않는다. restore가 필요하면 정확한 bookmark, 복원 시점, 영향받는 쓰기 구간을 제시하고 별도 파괴적 작업 승인을 받은 뒤에만 실행한다.

## 배포 후 기록할 항목

실제 배포가 끝난 뒤 다음 항목을 release evidence에서 읽어 이 문서의 운영 인계 기록에 추가한다.

- projection 전용 Calendar Worker version
- 전체 Calendar dark/live Worker version
- Calendar Pages production deployment ID와 asset hash
- 플래그 변경 전 Calendar D1 bookmark와 최종 readback 시각
- Study/Calendar health status와 실제 리포트 검증 건수
- razr 설치 전후 Calendar package/session/notification 불변 결과

값이 없거나 직접 읽지 못한 항목은 `미검증`으로 남기며 성공으로 추정하지 않는다.
