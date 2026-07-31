# 피드백·오류 대응 운영 가이드

앱의 `문제 신고 · 문의`에서 접수한 내용은 이메일 성공 여부와 무관하게 운영 D1의
`user_feedback`에 먼저 저장된다. `status='sent'`는 Resend 전달 완료,
`status='queued'`는 D1 접수 완료·이메일 미전달을 뜻한다. 두 값 모두 문제 해결 여부와는
무관하므로 `sent`만 확인하고 접수를 닫으면 안 된다.

진단 정보는 사용자가 화면에서 포함 여부를 선택한다. 포함되는 값은 앱 버전, 실행 환경,
현재 화면, 네트워크·알림·Service Worker 상태와 최근 24시간의 정규화된 오류 최대 12건이다.
대화 내용, 위치 좌표, 사진, 비밀번호, 로그인·구매 토큰은 진단 필드에 저장하지 않는다.

## 매일 확인

PowerShell에서 Worker 디렉터리로 이동한다.

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-1\worker'
```

최근 접수 50건을 본문 없이 확인한다. `request_id`는 상세 조회와 Worker 로그 상관관계에
사용한다.

```powershell
npx wrangler d1 execute hyeni-calendar --remote --json --command "SELECT created_at, status, json_extract(message, '$.requestId') AS request_id, json_extract(message, '$.feedbackKind') AS kind, json_extract(message, '$.category') AS category, json_extract(message, '$.diagnosticSchemaVersion') AS diagnostic_schema, current_screen, CASE WHEN json_valid(error_logs) THEN json_array_length(error_logs) ELSE 0 END AS error_count FROM user_feedback WHERE type = 'feature_feedback' ORDER BY created_at DESC LIMIT 50;"
```

이메일 전달이 밀린 접수 수와 최초·최근 시각을 확인한다.

```powershell
npx wrangler d1 execute hyeni-calendar --remote --json --command "SELECT COUNT(*) AS queued_count, MIN(created_at) AS oldest_queued_at, MAX(created_at) AS newest_queued_at FROM user_feedback WHERE type = 'feature_feedback' AND status = 'queued';"
```

최근 24시간에 반복된 오류 코드·화면·HTTP 상태를 빈도순으로 확인한다.

```powershell
npx wrangler d1 execute hyeni-calendar --remote --json --command "SELECT json_extract(j.value, '$.code') AS error_code, json_extract(j.value, '$.screen') AS screen, json_extract(j.value, '$.status') AS http_status, SUM(COALESCE(json_extract(j.value, '$.count'), 1)) AS occurrences, COUNT(DISTINCT json_extract(f.message, '$.requestId')) AS reports FROM user_feedback AS f, json_each(CASE WHEN json_valid(f.error_logs) THEN f.error_logs ELSE '[]' END) AS j WHERE f.type = 'feature_feedback' AND julianday(f.created_at) >= julianday('now', '-24 hours') GROUP BY error_code, screen, http_status ORDER BY occurrences DESC, reports DESC LIMIT 30;"
```

## 한 건 상세 확인

먼저 위 목록에서 `request_id`를 복사한다. 아래 명령은 UUID 형식을 확인한 뒤 해당 한 건만
조회하므로 다른 사용자의 접수까지 넓게 열지 않는다.

```powershell
$feedbackRequestId = Read-Host '확인할 피드백 requestId'
if ($feedbackRequestId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') { throw '올바른 피드백 requestId가 아닙니다.' }
$feedbackSql = "SELECT created_at, status, message, current_screen, device_info, error_logs FROM user_feedback WHERE type = 'feature_feedback' AND json_extract(message, '$.requestId') = '$feedbackRequestId' LIMIT 1;"
npx wrangler d1 execute hyeni-calendar --remote --json --command $feedbackSql
```

`message`에는 사용자가 직접 쓴 내용이 들어 있으므로 장애 대응에 필요한 담당자만 열람한다.
진단의 `code`와 `status`로 같은 실패를 묶고, `appVersion`, `runtime`, `current_screen`으로
영향 범위를 좁힌다. 사용자 설명과 진단이 맞지 않을 때는 진단을 정답으로 간주하지 말고
재현과 서버 로그를 함께 확인한다.

## 실시간 Worker 로그

접수·저장·이메일 전달 상태만 보려면 다음 명령을 실행한다.

```powershell
npx wrangler tail hyeni-calendar-api --format pretty --search '"scope":"feedback"'
```

구조화 로그의 `requestId`는 D1의 `message.requestId`와 같다. 로그에는 사용자 ID, 가족 ID,
작성 본문, 토큰을 남기지 않는다.

주요 이벤트:

| 이벤트 | 의미 | 대응 |
|---|---|---|
| `accepted_sent` | D1 저장과 이메일 전달 완료 | 접수 내용·진단 확인 |
| `accepted_queued` | D1 저장 완료, 이메일 미전달 | `reason` 확인 후 D1에서 직접 처리 |
| `storage_failed` | D1 조회·저장 실패 | Cloudflare D1 상태와 Worker 배포 확인 |
| `identity_failed` | 활성 가족·발신자 정본 조회 실패 | 인증·membership 오류 확인 |
| `rejected` | 가족 권한 또는 시간당 제한으로 거절 | `reason`별 비정상 급증 확인 |
| `idempotent_replay` | 같은 requestId 재시도 | 중복 접수로 처리하지 않음 |

## 장애 우선순위

1. 위치·SOS·도착·알림처럼 안전 기능을 막는 회귀
2. 로그인·페어링·결제처럼 사용 자체를 막는 회귀
3. 여러 앱 버전·화면에서 반복되는 동일 오류
4. 단일 기기·단일 화면의 재현 가능한 오류
5. 사용 문의와 기능 제안

수정 후에는 해당 `requestId`를 기준으로 재현 조건과 고친 버전을 기록하고, 같은
`error_code + screen + appVersion` 조합이 다시 늘어나는지 24시간 집계를 재확인한다.
