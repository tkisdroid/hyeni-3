[CmdletBinding()]
param(
    [int]$Port = 9224,
    [ValidateSet("Identity", "Tts")]
    [string]$Mode = "Tts"
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

    $Task.GetAwaiter().GetResult()
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
        [string]$Expression
    )

    $response = Send-CdpCommand -Socket $Socket -Method "Runtime.evaluate" -Parameters @{
        expression = $Expression
        returnByValue = $true
        awaitPromise = $false
    }
    if ($response.PSObject.Properties.Name -contains "error") {
        throw "CDP 명령이 실패했습니다."
    }
    if ($response.result.PSObject.Properties.Name -contains "exceptionDetails") {
        throw "WebView 확인식 실행이 실패했습니다."
    }
    return $response.result.result.value
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
        [string]$Name
    )

    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    $expression = "(() => window.__hyeniNativeTtsProbe?.$Name ?? 'pending')()"
    do {
        $state = [string](Invoke-CdpEvaluate -Socket $Socket -Expression $expression)
        if ($state -in @("started", "stopped", "failed")) {
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
    $targets = @(
        Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 10 |
            Where-Object {
                $_.type -eq "page" -and
                $_.webSocketDebuggerUrl -and
                ([Uri]$_.url).Host -eq "localhost"
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
  window.__hyeniNativeTtsProbe = { short: "pending", long: "pending", stop: "pending" };
  const SpeechRecognition = window.Capacitor?.Plugins?.SpeechRecognition;
  if (!SpeechRecognition?.speak || !SpeechRecognition?.stopSpeak) {
    window.__hyeniNativeTtsProbe.short = "failed";
    return "failed";
  }
  try {
    Promise.resolve(SpeechRecognition.speak({
      text: "AI 친구 음성 답변 확인이야.",
      language: "ko-KR",
      rate: 1,
    })).then((result) => {
      window.__hyeniNativeTtsProbe.short = result?.started === false ? "failed" : "started";
    }).catch(() => {
      window.__hyeniNativeTtsProbe.short = "failed";
    });
  } catch {
    window.__hyeniNativeTtsProbe.short = "failed";
  }
  return window.__hyeniNativeTtsProbe.short;
})()
'@)
    $shortState = Wait-CdpProbeState -Socket $socket -Name "short"
    if ($shortState -ne "started") {
        throw "네이티브 TTS 짧은 재생 확인에 실패했습니다."
    }
    Start-Sleep -Milliseconds 2500

    [void](Invoke-CdpEvaluate -Socket $socket -Expression @'
(() => {
  const SpeechRecognition = window.Capacitor?.Plugins?.SpeechRecognition;
  if (!SpeechRecognition?.speak) {
    window.__hyeniNativeTtsProbe.long = "failed";
    return "failed";
  }
  try {
    Promise.resolve(SpeechRecognition.speak({
      text: "AI 친구 음성 답변 중단 확인을 위해 이 문장을 끝까지 천천히 읽고 있어. 중간에 소리가 멈추는지 확인해 줘.",
      language: "ko-KR",
      rate: 1,
    })).then((result) => {
      window.__hyeniNativeTtsProbe.long = result?.started === false ? "failed" : "started";
    }).catch(() => {
      window.__hyeniNativeTtsProbe.long = "failed";
    });
  } catch {
    window.__hyeniNativeTtsProbe.long = "failed";
  }
  return window.__hyeniNativeTtsProbe.long;
})()
'@)
    $longState = Wait-CdpProbeState -Socket $socket -Name "long"
    if ($longState -ne "started") {
        throw "네이티브 TTS 긴 재생 확인에 실패했습니다."
    }
    Start-Sleep -Milliseconds 700
    [void](Invoke-CdpEvaluate -Socket $socket -Expression @'
(() => {
  const SpeechRecognition = window.Capacitor?.Plugins?.SpeechRecognition;
  if (!SpeechRecognition?.stopSpeak) {
    window.__hyeniNativeTtsProbe.stop = "failed";
    return "failed";
  }
  try {
    Promise.resolve(SpeechRecognition.stopSpeak()).then(() => {
      window.__hyeniNativeTtsProbe.stop = "stopped";
    }).catch(() => {
      window.__hyeniNativeTtsProbe.stop = "failed";
    });
  } catch {
    window.__hyeniNativeTtsProbe.stop = "failed";
  }
  return window.__hyeniNativeTtsProbe.stop;
})()
'@)
    $stopState = Wait-CdpProbeState -Socket $socket -Name "stop"
    if ($stopState -ne "stopped") {
        throw "네이티브 TTS 중단 확인에 실패했습니다."
    }

    [ordered]@{
        mode = $Mode
        role = [string]$identity.role
        hasFamilyId = [bool]$identity.hasFamilyId
        familyScopesMatch = [bool]$identity.familyScopesMatch
        rootVisible = [bool]$identity.rootVisible
        shortPlayback = $shortState
        longPlayback = $longState
        stopPlayback = $stopState
    } | ConvertTo-Json -Compress
} finally {
    if ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
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
