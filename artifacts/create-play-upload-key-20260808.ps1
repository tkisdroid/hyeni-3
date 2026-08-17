[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$Host.UI.RawUI.WindowTitle = '혜니캘린더 새 Play 업로드 키 만들기'

$privateRoot = 'C:\Users\TK\keys\hyeni-calendar\android-signing\private'
$publicRoot = 'C:\Users\TK\keys\hyeni-calendar\android-signing\public'
$keystorePath = Join-Path $privateRoot 'hyeni-upload-reset-20260808.jks'
$certificatePath = Join-Path $publicRoot 'play-upload-reset-20260808_certificate.pem'
$keyAlias = 'hyeni-upload-20260808'
$passwordEnvironmentName = 'HYENI_NEW_UPLOAD_PASSWORD'
$plainPassword = $null

function Convert-SecureStringToPlainText {
    param([Parameter(Mandatory)][Security.SecureString]$Value)

    $pointer = [IntPtr]::Zero
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
    }
}

function Read-ConfirmedPassword {
    $firstSecure = Read-Host '새 비밀번호를 입력하세요 (키스토어·키 공통)' -AsSecureString
    $secondSecure = Read-Host '같은 비밀번호를 다시 입력하세요' -AsSecureString
    $firstPlain = $null
    $secondPlain = $null
    try {
        $firstPlain = Convert-SecureStringToPlainText -Value $firstSecure
        $secondPlain = Convert-SecureStringToPlainText -Value $secondSecure
        if ($firstPlain.Length -lt 12) {
            throw '비밀번호는 12자 이상으로 만들어 주세요.'
        }
        if ($firstPlain -cne $secondPlain) {
            throw '두 번 입력한 비밀번호가 서로 다릅니다.'
        }
        return $firstPlain
    } finally {
        $firstSecure = $null
        $secondSecure = $null
        $secondPlain = $null
    }
}

try {
    if (Test-Path -LiteralPath $keystorePath -PathType Leaf) {
        throw "새 키스토어가 이미 있어 덮어쓰지 않습니다: $keystorePath"
    }
    if (Test-Path -LiteralPath $certificatePath -PathType Leaf) {
        throw "새 공개 인증서가 이미 있어 덮어쓰지 않습니다: $certificatePath"
    }

    Write-Host '새 비밀번호는 화면·파일·명령 기록에 저장되지 않습니다.' -ForegroundColor Cyan
    Write-Host '비밀번호 관리자에 반드시 직접 저장해 주세요.' -ForegroundColor Yellow
    Write-Host '앞으로 AAB 서명 시 키스토어 비밀번호와 키 비밀번호에 같은 값을 입력합니다.'
    Write-Host ''

    $plainPassword = Read-ConfirmedPassword
    [Environment]::SetEnvironmentVariable($passwordEnvironmentName, $plainPassword, 'Process')

    $keytool = (Get-Command keytool.exe -ErrorAction Stop).Source
    New-Item -ItemType Directory -Force -Path $privateRoot, $publicRoot | Out-Null

    Write-Host ''
    Write-Host '1/3 RSA 4096비트 새 업로드 키를 만듭니다.'
    $generateArguments = @(
        '-J-Duser.language=en',
        '-J-Duser.country=US',
        '-genkeypair',
        '-v',
        '-keystore', $keystorePath,
        '-storetype', 'JKS',
        '-storepass:env', $passwordEnvironmentName,
        '-keypass:env', $passwordEnvironmentName,
        '-alias', $keyAlias,
        '-keyalg', 'RSA',
        '-keysize', '4096',
        '-sigalg', 'SHA384withRSA',
        '-validity', '10000',
        '-dname', 'CN=Hyeni Calendar Upload, OU=Android Release, O=Hyeni Calendar, C=KR'
    )
    & $keytool @generateArguments 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        throw "새 키스토어 생성에 실패했습니다. (exit $LASTEXITCODE)"
    }

    Write-Host '2/3 Play Console에 제출할 공개 PEM 인증서를 내보냅니다.'
    $exportArguments = @(
        '-J-Duser.language=en',
        '-J-Duser.country=US',
        '-exportcert',
        '-rfc',
        '-keystore', $keystorePath,
        '-storepass:env', $passwordEnvironmentName,
        '-alias', $keyAlias,
        '-file', $certificatePath
    )
    & $keytool @exportArguments 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        throw "공개 PEM 인증서 내보내기에 실패했습니다. (exit $LASTEXITCODE)"
    }

    Write-Host '3/3 개인키 항목과 공개 인증서 지문을 검증합니다.'
    $listOutput = (& $keytool '-J-Duser.language=en' '-J-Duser.country=US' '-list' '-v' `
        '-keystore' $keystorePath '-storepass:env' $passwordEnvironmentName '-alias' $keyAlias 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0 -or $listOutput -notmatch '(?im)^Entry type:\s*PrivateKeyEntry\s*$') {
        throw '생성한 JKS에서 PrivateKeyEntry를 확인하지 못했습니다.'
    }

    $certificateOutput = (& $keytool '-J-Duser.language=en' '-J-Duser.country=US' '-printcert' '-v' `
        '-file' $certificatePath 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
        throw '생성한 PEM 공개 인증서를 읽지 못했습니다.'
    }
    $sha1Match = [regex]::Match($certificateOutput, '(?im)^\s*SHA1:\s*(?<value>[0-9A-F:]+)\s*$')
    $sha256Match = [regex]::Match($certificateOutput, '(?im)^\s*SHA256:\s*(?<value>[0-9A-F:]+)\s*$')
    if (-not $sha1Match.Success -or -not $sha256Match.Success) {
        throw '새 공개 인증서의 SHA-1/SHA-256 지문을 확인하지 못했습니다.'
    }

    $keystoreHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $keystorePath).Hash.ToLowerInvariant()
    Write-Host ''
    Write-Host '새 업로드 키 생성과 검증이 완료되었습니다.' -ForegroundColor Green
    Write-Host "JKS(외부 제출 금지): $keystorePath"
    Write-Host "PEM(Play Console 제출): $certificatePath"
    Write-Host "별칭: $keyAlias"
    Write-Host "새 인증서 SHA-1: $($sha1Match.Groups['value'].Value)"
    Write-Host "새 인증서 SHA-256: $($sha256Match.Groups['value'].Value)"
    Write-Host "JKS 파일 SHA-256: $keystoreHash"
    Write-Host ''
    Write-Host '중요: 방금 입력한 비밀번호를 비밀번호 관리자에 저장하세요.' -ForegroundColor Yellow
    Write-Host 'Play Console에는 JKS가 아니라 위 PEM 파일만 올립니다.' -ForegroundColor Yellow
} catch {
    Write-Host ''
    Write-Host "실패: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    [Environment]::SetEnvironmentVariable($passwordEnvironmentName, $null, 'Process')
    $plainPassword = $null
}

Read-Host '내용을 확인한 뒤 Enter를 누르면 창이 닫힙니다'
