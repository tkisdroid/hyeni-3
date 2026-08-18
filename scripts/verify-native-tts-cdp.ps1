[CmdletBinding()]
param(
    [int]$Port = 9224,
    [ValidateSet("Identity", "Tts")]
    [string]$Mode = "Tts",
    [switch]$ShortOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$expectedRole = "child"
$script:NextCommandId = 0
$socket = [System.Net.WebSockets.ClientWebSocket]::new()

function Invoke-WebSocketTask {
    param(
        [Parameter(Mandatory = $true)]
        [System.Threading.Tasks.Task]$Task
    )

    [void]$Task.GetAwaiter().GetResult()
}

function Send-CdpCommand {
    param(
        [Parameter(Mandatory = $true)]
        [System.Net.WebSockets.ClientWebSocket]$Socket,
        [Parameter(Mandatory = $true)]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [hashtable]$Parameters
    )

    $commandDeadline = [DateTime]::UtcNow.AddSeconds(10)
    $script:NextCommandId += 1
    $commandId = $script:NextCommandId
    $payload = @{
        id = $commandId
        method = $Method
        params = $Parameters
    } | ConvertTo-Json -Compress -Depth 12
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $sendBuffer = [ArraySegment[byte]]::new($bytes)
    $sendRemainingMilliseconds = [int][Math]::Ceiling(
        ($commandDeadline - [DateTime]::UtcNow).TotalMilliseconds
    )
    if ($sendRemainingMilliseconds -le 0) {
        throw "CDP 명령 제한 시간이 초과됐습니다."
    }
    $sendTimeout = [System.Threading.CancellationTokenSource]::new($sendRemainingMilliseconds)

    try {
        Invoke-WebSocketTask ($Socket.SendAsync(
            $sendBuffer,
            [System.Net.WebSockets.WebSocketMessageType]::Text,
            $true,
            $sendTimeout.Token
        ))
    } finally {
        $sendTimeout.Dispose()
    }

    while ($true) {
        if ([DateTime]::UtcNow -ge $commandDeadline) {
            throw "CDP 명령 제한 시간이 초과됐습니다."
        }
        $message = [System.IO.MemoryStream]::new()
        try {
            do {
                $receiveRemainingMilliseconds = [int][Math]::Ceiling(
                    ($commandDeadline - [DateTime]::UtcNow).TotalMilliseconds
                )
                if ($receiveRemainingMilliseconds -le 0) {
                    throw "CDP 명령 제한 시간이 초과됐습니다."
                }
                $receiveBytes = [byte[]]::new(8192)
                $receiveBuffer = [ArraySegment[byte]]::new($receiveBytes)
                $receiveTimeout = [System.Threading.CancellationTokenSource]::new(
                    $receiveRemainingMilliseconds
                )
                try {
                    $receiveResult = $Socket.ReceiveAsync(
                        $receiveBuffer,
                        $receiveTimeout.Token
                    ).GetAwaiter().GetResult()
                } finally {
                    $receiveTimeout.Dispose()
                }

                if ($receiveResult.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                    throw "CDP 연결이 응답 전에 닫혔습니다."
                }
                $message.Write($receiveBytes, 0, $receiveResult.Count)
            } while (-not $receiveResult.EndOfMessage)

            $json = [System.Text.Encoding]::UTF8.GetString($message.ToArray())
            $response = $json | ConvertFrom-Json
            if (
                $response.PSObject.Properties.Name -contains "id" -and
                [int]$response.id -eq $commandId
            ) {
                return $response
            }
        } finally {
            $message.Dispose()
        }
    }
}

function Invoke-CdpEvaluate {
    param(
        [Parameter(Mandatory = $true)]
        [System.Net.WebSockets.ClientWebSocket]$Socket,
        [Parameter(Mandatory = $true)]
        [string]$Expression,
        [bool]$AwaitPromise = $false
    )

    $responseItems = @(
        Send-CdpCommand -Socket $Socket -Method "Runtime.evaluate" -Parameters @{
            expression = $Expression
            returnByValue = $true
            awaitPromise = $AwaitPromise
        }
    )
    if ($responseItems.Count -ne 1) {
        throw "CDP 응답은 정확히 하나여야 합니다."
    }
    $response = $responseItems[0]
    $responseProperties = @($response.PSObject.Properties.Name)
    if ($responseProperties -contains "error") {
        throw "CDP 명령이 실패했습니다."
    }
    if ($responseProperties -notcontains "result") {
        throw "CDP 응답에 result가 없습니다: $($responseProperties -join ',')"
    }
    $resultEnvelope = $response.result
    $resultProperties = @($resultEnvelope.PSObject.Properties.Name)
    if ($resultProperties -contains "exceptionDetails") {
        throw "WebView 확인식 실행이 실패했습니다."
    }
    if ($resultProperties -notcontains "result") {
        throw "CDP Runtime 응답에 result가 없습니다: $($resultProperties -join ',')"
    }
    $runtimeResult = $resultEnvelope.result
    if ($runtimeResult.PSObject.Properties.Name -notcontains "value") {
        throw "CDP Runtime 결과에 value가 없습니다."
    }
    return $runtimeResult.value
}

function Wait-CdpRoot {
    param(
        [Parameter(Mandatory = $true)]
        [System.Net.WebSockets.ClientWebSocket]$Socket
    )

    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    do {
        $visible = Invoke-CdpEvaluate -Socket $Socket -Expression @'
(() => {
  const root = document.querySelector(".afc");
  return !!root && root.getClientRects().length > 0;
})()
'@
        if ($visible -eq $true) {
            return
        }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "AI 친구 화면이 제한 시간 안에 표시되지 않았습니다."
}

function Wait-CdpProbeState {
    param(
        [Parameter(Mandatory = $true)]
        [System.Net.WebSockets.ClientWebSocket]$Socket,
        [Parameter(Mandatory = $true)]
        [ValidateSet("short", "long", "stop")]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [ValidateSet("started", "done", "stopped")]
        [string]$ExpectedState,
        [int]$TimeoutSeconds = 10
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $expression = "(() => window.__hyeniNativeTtsProbe?.$Name ?? 'pending')()"
    do {
        $state = [string](Invoke-CdpEvaluate -Socket $Socket -Expression $expression)
        if ($state -eq "failed") {
            throw "네이티브 TTS 상태 확인에 실패했습니다: $Name"
        }
        if ($state -eq $ExpectedState) {
            return $state
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "네이티브 TTS 상태 확인 시간이 초과됐습니다."
}

$identityExpression = @'
(() => {
  const session = JSON.parse(localStorage.getItem("hyeni-api-session-v1") || "null");
  const app = session?.user?.app_metadata ?? {};
  const user = session?.user?.user_metadata ?? {};
  return {
    role: app.role ?? user.role ?? null,
    hasFamilyId: typeof (app.family_id ?? user.family_id) === "string" && (app.family_id ?? user.family_id).length > 0,
    familyScopesMatch: !app.family_id || !user.family_id || app.family_id === user.family_id,
    rootVisible: (() => {
      const root = document.querySelector(".afc");
      return !!root && root.getClientRects().length > 0;
    })(),
  };
})()
'@

try {
    # Windows PowerShell 5.1은 Invoke-RestMethod의 최상위 JSON 배열을
    # 파이프라인에서 단일 Object[]로 유지할 수 있어 먼저 변수에 받는다.
    $targetPayload = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 10
    $targets = @(
        foreach ($target in [object[]]$targetPayload) {
            $targetUrl = $null
            $hasAllowedUrl = [Uri]::TryCreate(
                [string]$target.url,
                [UriKind]::Absolute,
                [ref]$targetUrl
            )
            if (
                $target.type -eq "page" -and
                $target.webSocketDebuggerUrl -and
                $hasAllowedUrl -and
                $targetUrl.Host -eq "localhost"
            ) {
                $target
            }
        }
    )
    if ($targets.Count -ne 1) {
        throw "localhost 혜니 WebView target은 정확히 하나여야 합니다."
    }

    $targetSocket = [Uri]$targets[0].webSocketDebuggerUrl
    if ($targetSocket.Scheme -ne "ws" -or $targetSocket.AbsolutePath -notlike "/devtools/page/*") {
        throw "허용되지 않은 CDP target 주소입니다."
    }
    $socketUri = [Uri]("ws://127.0.0.1:$Port" + $targetSocket.PathAndQuery)
    $connectTimeout = [System.Threading.CancellationTokenSource]::new(10000)
    try {
        Invoke-WebSocketTask ($socket.ConnectAsync($socketUri, $connectTimeout.Token))
    } finally {
        $connectTimeout.Dispose()
    }

    $identity = Invoke-CdpEvaluate -Socket $socket -Expression $identityExpression
    if (
        $identity.role -ne $expectedRole -or
        $identity.hasFamilyId -ne $true -or
        $identity.familyScopesMatch -ne $true
    ) {
        throw "아이 역할·가족 범위 확인에 실패했습니다."
    }

    [void](Invoke-CdpEvaluate -Socket $socket -Expression @'
(() => {
  location.hash = "#/child/ai-friend";
  return true;
})()
'@)
    Wait-CdpRoot -Socket $socket
    $identity = Invoke-CdpEvaluate -Socket $socket -Expression $identityExpression

    if ($Mode -eq "Identity") {
        [ordered]@{
            mode = $Mode
            role = [string]$identity.role
            hasFamilyId = [bool]$identity.hasFamilyId
            familyScopesMatch = [bool]$identity.familyScopesMatch
            rootVisible = [bool]$identity.rootVisible
        } | ConvertTo-Json -Compress
        return
    }

    [void](Invoke-CdpEvaluate -Socket $socket -Expression @'
(() => {
  const probe = {
    short: "pending",
    long: "pending",
    stop: "pending",
    shortId: null,
    longId: null,
    statesById: {},
    listener: null,
    cancelled: false,
    stopRequested: false,
  };
  window.__hyeniNativeTtsProbe = probe;
  const SpeechRecognition = window.Capacitor?.Plugins?.SpeechRecognition;
  if (!SpeechRecognition?.speak || !SpeechRecognition?.stopSpeak || !SpeechRecognition?.addListener) {
    probe.short = "failed";
    return "failed";
  }
  window.speechSynthesis?.cancel();
  const applyState = (id, state) => {
    if (typeof id !== "string" || !id || !["started", "done", "error", "stopped"].includes(state)) return;
    const normalized = state === "error" ? "failed" : state;
    probe.statesById[id] = normalized;
    if (id === probe.shortId) probe.short = normalized;
    if (id === probe.longId) {
      probe.long = normalized;
      if (normalized === "stopped" && probe.stopRequested) probe.stop = "stopped";
    }
  };
  try {
    Promise.resolve(SpeechRecognition.addListener("ttsState", (event) => {
      applyState(event?.utteranceId, event?.state);
    })).then((listener) => {
      if (probe.cancelled) {
        return Promise.resolve(listener?.remove?.()).then(() => {
          throw new Error("probe cancelled");
        });
      }
      probe.listener = listener;
      return SpeechRecognition.speak({
        // Windows PowerShell 5.1은 BOM 없는 UTF-8을 CP949로 읽으므로 발화문은 ASCII Unicode escape로 고정한다.
        text: "AI \uce5c\uad6c \uc74c\uc131 \ub2f5\ubcc0 \ud655\uc778\uc774\uc57c.",
        language: "ko-KR",
        rate: 1,
      });
    }).then((result) => {
      const id = typeof result?.utteranceId === "string" ? result.utteranceId : "";
      if (probe.cancelled) {
        Promise.resolve(SpeechRecognition.stopSpeak()).catch(() => undefined);
        return;
      }
      if (result?.started !== true || !id) {
        probe.short = "failed";
        return;
      }
      probe.shortId = id;
      probe.short = probe.statesById[id] ?? "queued";
    }).catch(() => {
      probe.short = "failed";
    });
  } catch {
    probe.short = "failed";
  }
  return probe.short;
})()
'@)
    $shortState = Wait-CdpProbeState `
        -Socket $socket `
        -Name "short" `
        -ExpectedState "done" `
        -TimeoutSeconds 20

    if ($ShortOnly) {
        [ordered]@{
            mode = $Mode
            role = [string]$identity.role
            hasFamilyId = [bool]$identity.hasFamilyId
            familyScopesMatch = [bool]$identity.familyScopesMatch
            rootVisible = [bool]$identity.rootVisible
            shortPlayback = "started"
            shortCompletion = $shortState
        } | ConvertTo-Json -Compress
        return
    }

    [void](Invoke-CdpEvaluate -Socket $socket -Expression @'
(() => {
  const SpeechRecognition = window.Capacitor?.Plugins?.SpeechRecognition;
  const probe = window.__hyeniNativeTtsProbe;
  if (!SpeechRecognition?.speak || !probe) {
    if (probe) probe.long = "failed";
    return "failed";
  }
  try {
    Promise.resolve(SpeechRecognition.speak({
      text: "AI \uce5c\uad6c \uc74c\uc131 \ub2f5\ubcc0 \uc911\ub2e8 \ud655\uc778\uc744 \uc704\ud574 \uc774 \ubb38\uc7a5\uc744 \ub05d\uae4c\uc9c0 \ucc9c\ucc9c\ud788 \uc77d\uace0 \uc788\uc5b4. \uc911\uac04\uc5d0 \uc18c\ub9ac\uac00 \uba48\ucd94\ub294\uc9c0 \ud655\uc778\ud574 \uc918.",
      language: "ko-KR",
      rate: 1,
    })).then((result) => {
      const id = typeof result?.utteranceId === "string" ? result.utteranceId : "";
      if (probe.cancelled) {
        Promise.resolve(SpeechRecognition.stopSpeak()).catch(() => undefined);
        return;
      }
      if (result?.started !== true || !id) {
        probe.long = "failed";
        return;
      }
      probe.longId = id;
      probe.long = probe.statesById[id] ?? "queued";
      if (probe.long === "stopped" && probe.stopRequested) probe.stop = "stopped";
    }).catch(() => {
      probe.long = "failed";
    });
  } catch {
    probe.long = "failed";
  }
  return probe.long;
})()
'@)
    $longState = Wait-CdpProbeState `
        -Socket $socket `
        -Name "long" `
        -ExpectedState "started" `
        -TimeoutSeconds 15
    Start-Sleep -Milliseconds 700
    [void](Invoke-CdpEvaluate -Socket $socket -Expression @'
(() => {
  const SpeechRecognition = window.Capacitor?.Plugins?.SpeechRecognition;
  if (!SpeechRecognition?.stopSpeak) {
    window.__hyeniNativeTtsProbe.stop = "failed";
    return "failed";
  }
  try {
    window.__hyeniNativeTtsProbe.stopRequested = true;
    window.__hyeniNativeTtsProbe.stop = "requested";
    Promise.resolve(SpeechRecognition.stopSpeak()).then((result) => {
      if (result?.status !== "stopped") {
        window.__hyeniNativeTtsProbe.stop = "failed";
      }
    }).catch(() => {
      window.__hyeniNativeTtsProbe.stop = "failed";
    });
  } catch {
    window.__hyeniNativeTtsProbe.stop = "failed";
  }
  return window.__hyeniNativeTtsProbe.stop;
})()
'@)
    $stopState = Wait-CdpProbeState `
        -Socket $socket `
        -Name "stop" `
        -ExpectedState "stopped"

    [ordered]@{
        mode = $Mode
        role = [string]$identity.role
        hasFamilyId = [bool]$identity.hasFamilyId
        familyScopesMatch = [bool]$identity.familyScopesMatch
        rootVisible = [bool]$identity.rootVisible
        shortPlayback = "started"
        shortCompletion = $shortState
        longPlayback = $longState
        stopPlayback = $stopState
    } | ConvertTo-Json -Compress
} finally {
    if ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
        try {
            [void](Invoke-CdpEvaluate -Socket $socket -AwaitPromise $true -Expression @'
(async () => {
  const probe = window.__hyeniNativeTtsProbe;
  if (probe) probe.cancelled = true;
  const SpeechRecognition = window.Capacitor?.Plugins?.SpeechRecognition;
  const cleanup = [];
  window.speechSynthesis?.cancel();
  if (probe && SpeechRecognition?.stopSpeak) cleanup.push(Promise.resolve(SpeechRecognition.stopSpeak()));
  if (probe?.listener?.remove) cleanup.push(Promise.resolve(probe.listener.remove()));
  await Promise.allSettled(cleanup);
  delete window.__hyeniNativeTtsProbe;
  return true;
})()
'@)
        } catch {
            # 검증 결과를 바꾸지 않고 임시 listener 정리만 최선 노력한다.
        }
        $closeTimeout = [System.Threading.CancellationTokenSource]::new(2000)
        try {
            Invoke-WebSocketTask ($socket.CloseAsync(
                [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
                "done",
                $closeTimeout.Token
            ))
        } catch {
            $socket.Abort()
        } finally {
            $closeTimeout.Dispose()
        }
    }
    $socket.Dispose()
}
