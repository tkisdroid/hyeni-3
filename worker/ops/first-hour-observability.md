# 출시 직후 60분 Worker 관측

## 목적

출시 직후 운영자가 확인할 질문은 세 가지다.

1. 새 Worker 버전이 실제 요청을 처리하고 있는가?
2. 최근 5분의 5xx가 5건 이상이면서 전체 요청의 1%를 초과했는가?
3. 각 cron handler가 결과 데이터나 예외 원문을 노출하지 않고 성공·실패 heartbeat를 남기는가?

Worker는 `invocation_logs=false`를 유지한다. 대신 매 fetch 응답에 아래 세 필드만 구조화 로그로 남긴다.

- `event=hyeni_request_outcome_v1`
- `versionId`
- `statusClass`

cron은 `event=hyeni_cron_heartbeat_v1`과 배포 버전, 정적 cron/handler 이름, `success|failure`만 남긴다. handler 반환값과 예외 원문은 저장하지 않는다.

## 실행 전 조건

- 실행 위치: `C:\Users\TK\Desktop\hyeni-3`
- `CLOUDFLARE_ACCOUNT_ID`: 현재 Cloudflare 계정 ID
- `CLOUDFLARE_API_TOKEN`: `Workers Observability Write`와 `Workers Scripts Read` 또는 `Workers Tail Read` 권한이
  있는 API token
- `HYENI_WORKER_VERSION_ID`: 방금 배포한 100% traffic Worker version ID(UUID). Cloudflare 배포 결과와
  `CF_VERSION_METADATA.id`가 같은 값이어야 한다.
- 선택: `HYENI_OBSERVABILITY_WINDOW_END_MS`: 재현할 5분 창의 끝 Unix timestamp(ms). 미설정하면 실행 시각을 쓴다.

API token과 account ID는 콘솔 명령, 문서, 로그 파일에 붙여 넣어 남기지 않는다. Worker version ID는 비밀값이 아닌
배포 출처이므로 `hyeni-first-hour-5xx-v2` 결과에 서비스명, 현재 100% traffic deployment ID·생성 시각,
deployment API 확인 시각과 함께 정확히 기록된다. version/deployment ID는 하이픈이 있는 UUID 형식만 허용하며,
누락·형식 오류는 exit 2로 fail-closed한다. 스크립트는 매 실행마다 Cloudflare List Deployments API의 첫 active
deployment를 읽어 단일 version이 100% traffic인지, env version과 같은지, 해당 5분 창 시작 전에 배포됐는지 확인한다.
따라서 중간 재배포 뒤 env를 그대로 두어도 정상 결과를 만들지 않는다.

## 5분 자동 판정

아래 블록은 Worker가 100% traffic으로 배포된 직후 T0에 실행한다. 12개 창은 고정 T0를 기준으로 정확히 이어지며,
각 JSON과 최종 시계열 JSON은 create-only다. 같은 경로가 있으면 덮어쓰지 않고 즉시 실패한다.

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3'
$ErrorActionPreference = 'Stop'
if ($env:HYENI_WORKER_VERSION_ID -notmatch '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$') {
  throw 'HYENI_WORKER_VERSION_ID가 유효한 Worker version UUID가 아닙니다.'
}
$firstHourStartedAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$fiveXxEvidenceDirectory = Join-Path -Path '.\artifacts' -ChildPath ("first-hour-5xx-" + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $fiveXxEvidenceDirectory | Out-Null

function Invoke-HyeniFirstHour5xxCheckpoint([int]$minutes) {
  $targetMs = $firstHourStartedAtMs + ($minutes * 60 * 1000)
  while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $targetMs) {
    $remainingSeconds = [math]::Ceiling(($targetMs - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) / 1000)
    Start-Sleep -Seconds ([math]::Min(30, $remainingSeconds))
  }
  $checkpoint = 'T+{0:D2}' -f $minutes
  $outputPath = Join-Path $fiveXxEvidenceDirectory ('5xx-t-plus-{0:D2}.json' -f $minutes)
  $env:HYENI_OBSERVABILITY_WINDOW_END_MS = [string]$targetMs
  node .\worker\scripts\check-first-hour-5xx.mjs "--checkpoint=$checkpoint" "--out=$outputPath"
  if ($LASTEXITCODE -eq 1) { throw "$checkpoint 5xx 롤백 기준을 넘었습니다." }
  if ($LASTEXITCODE -eq 2) { throw "$checkpoint 5xx 판정이 불충분합니다." }
}

foreach ($minutes in 5,10,15,20,25,30,35,40,45,50,55,60) {
  Invoke-HyeniFirstHour5xxCheckpoint $minutes
}

$fiveXxPaths = 5,10,15,20,25,30,35,40,45,50,55,60 | ForEach-Object {
  Join-Path $fiveXxEvidenceDirectory ('5xx-t-plus-{0:D2}.json' -f $_)
}
$seriesArguments = @($fiveXxPaths) + "--out=$(Join-Path $fiveXxEvidenceDirectory '5xx-first-hour.json')"
& node .\worker\scripts\check-first-hour-5xx-series.mjs @seriesArguments
if ($LASTEXITCODE -eq 1) { throw '첫 60분 중 5xx 롤백 창이 있습니다.' }
if ($LASTEXITCODE -eq 2) { throw '첫 60분 5xx 증거가 불완전하거나 배포 출처가 섞였습니다.' }
```

Cloudflare Workers Observability Telemetry Query API를 `dry=true`, `view=calculations`, `ignoreSeries=true`로 두 번 조회한다. 첫 조회는 해당 버전의 전체 `hyeni_request_outcome_v1`, 둘째 조회는 그중 `statusClass=5xx`만 센다. 데이터·설정 변경 API는 호출하지 않는다.
각 결과에는 `workerService=hyeni-calendar-api`, 정규화된 `workerVersionId`, `workerDeploymentId`,
`workerDeploymentCreatedAt`, `deploymentVerifiedAt`, checkpoint가 포함된다. 최종
`hyeni-first-hour-5xx-series-v2` 판정은 T+05부터 T+60까지 정확히 이어진 12개 창만 받고, version이나 deployment가
하나라도 다르면 각각 `evidence_version_mismatch`, `evidence_deployment_mismatch`로 fail-closed한다.

- `HEALTHY`: 롤백 기준 미충족
- `ROLLBACK_REQUIRED`: 5xx가 5건 이상이고 비율이 1% 초과
- `INCONCLUSIVE`: 전체 요청이 0건이라 비율 판정 불가. 정상으로 간주하지 않고 트래픽·로그 수집을 확인한 뒤 다시 실행

출시 후 60분 동안 5분마다 자동 실행한다. `ROLLBACK_REQUIRED`이면 출시 runbook의 Worker 코드 롤백 절차를 즉시 따른다. `INCONCLUSIVE`도 관측 완료로 체크하지 않는다.
같은 시간대의 큐 스냅샷도 `ops/first-hour-queue-trend.md`에 따라 동일한 `HYENI_WORKER_VERSION_ID`를 사용한다.
T+60 전에 Worker가 다시 배포되면 기존 큐 추세와 5xx 시계열을 이어 붙이지 말고 새 deployment용 증거 디렉터리에서 다시 시작한다.

## cron heartbeat 확인

Workers Observability Query Builder에서 `event=hyeni_cron_heartbeat_v1`과 현재 `versionId`를 필터하고 `handler`, `status`로 그룹화한다. 각 예정 handler의 `success`가 보여야 하며 `failure`가 있거나 예정 시각을 지나 heartbeat가 없으면 cron 미정상으로 분리한다.

공식 계약:

- https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/
- https://developers.cloudflare.com/workers/observability/logs/workers-logs/
