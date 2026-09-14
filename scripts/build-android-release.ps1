[CmdletBinding()]
param(
    [switch]$PreflightOnly,
    [string]$KeystorePath,
    [string]$PlayUploadCertificatePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$androidRoot = Join-Path $repoRoot 'android'
$gradleWrapper = Join-Path $androidRoot 'gradlew.bat'
$projectKeystore = Join-Path $androidRoot 'keystore\hyeni-upload.jks'
$approvedUploadKeystore = Join-Path $env:USERPROFILE 'keys\hyeni-calendar\android-signing\private\hyeni-upload-reset-20260808.jks'
$vaultUploadKeystoreCandidate = Join-Path $env:USERPROFILE 'keys\hyeni-calendar\android-signing\private\hyeni-upload-reset-candidate-20260804.jks'
$legacyUploadKeystoreCandidate = Join-Path $env:USERPROFILE 'keys\hyeni-upload.jks'
$defaultKeystore = @(
    $approvedUploadKeystore,
    $vaultUploadKeystoreCandidate,
    $projectKeystore,
    $legacyUploadKeystoreCandidate
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($defaultKeystore)) {
    $defaultKeystore = $projectKeystore
}
$gradleProperties = Join-Path $env:USERPROFILE '.gradle\gradle.properties'
$legacyCredentialFile = Join-Path $androidRoot 'keystore\hyeni-upload-credentials.txt'
$releaseAab = Join-Path $androidRoot 'app\build\outputs\bundle\release\app-release.aab'
$evidenceRoot = Join-Path $repoRoot 'artifacts\release-evidence'
$vaultPlayUploadCertificate = Join-Path $env:USERPROFILE 'keys\hyeni-calendar\android-signing\public\play-upload-reset-20260808_certificate.pem'
$artifactPlayUploadCertificate = Join-Path $evidenceRoot 'play-console-certificates-20260804\upload_cert.der'
$defaultPlayUploadCertificate = @(
    $vaultPlayUploadCertificate,
    $artifactPlayUploadCertificate
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($defaultPlayUploadCertificate)) {
    $defaultPlayUploadCertificate = $artifactPlayUploadCertificate
}
$bundletoolPath = Join-Path $evidenceRoot 'release-tools\bundletool-all-1.18.1.jar'
$bundletoolUrl = 'https://github.com/google/bundletool/releases/download/1.18.1/bundletool-all-1.18.1.jar'
$bundletoolSha256 = '675786493983787ffa11550bdb7c0715679a44e1643f3ff980a529e9c822595c'
$signingVariableNames = @(
    'HYENI_KEYSTORE',
    'HYENI_KEYSTORE_PASSWORD',
    'HYENI_KEY_ALIAS',
    'HYENI_KEY_PASSWORD'
)

function Assert-PathWithin {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][string]$Label
    )

    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    $resolvedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    if (-not $resolvedPath.StartsWith(
        $resolvedRoot + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw "$Label 경로가 허용 범위를 벗어났습니다: $resolvedPath"
    }
}

function Get-ForbiddenSigningProperties {
    if (-not (Test-Path -LiteralPath $gradleProperties -PathType Leaf)) {
        return @()
    }

    $found = @()
    foreach ($line in [System.IO.File]::ReadLines($gradleProperties)) {
        if ($line -match '^\s*(HYENI_KEYSTORE|HYENI_KEYSTORE_PASSWORD|HYENI_KEY_ALIAS|HYENI_KEY_PASSWORD)\s*=') {
            $found += $Matches[1]
        }
    }
    return @($found | Sort-Object -Unique)
}

function Get-Utf8TextState {
    param([Parameter(Mandatory)][string]$Path)

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $hasBom = $bytes.Length -ge 3 `
        -and $bytes[0] -eq 0xEF `
        -and $bytes[1] -eq 0xBB `
        -and $bytes[2] -eq 0xBF
    $offset = if ($hasBom) { 3 } else { 0 }
    $encoding = [System.Text.UTF8Encoding]::new($false, $true)
    try {
        $text = $encoding.GetString($bytes, $offset, $bytes.Length - $offset)
    } catch {
        throw "$Path 파일은 안전한 자동 정리를 위해 UTF-8이어야 합니다. 수동으로 확인해 주세요."
    }

    return [pscustomobject]@{
        Bytes = $bytes
        Text = $text
        HasBom = $hasBom
    }
}

function Write-Utf8TextState {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][bool]$HasBom
    )

    $encoding = [System.Text.UTF8Encoding]::new($HasBom)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream)) -replace '-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Remove-ForbiddenSigningProperties {
    param([Parameter(Mandatory)]$OriginalState)

    $names = $signingVariableNames | ForEach-Object { [regex]::Escape($_) }
    $pattern = '(?m)^[\t ]*(?:' + ($names -join '|') + ')[\t ]*=.*(?:\r?\n|\z)'
    $sanitized = [regex]::Replace($OriginalState.Text, $pattern, '')
    Write-Utf8TextState -Path $gradleProperties -Text $sanitized -HasBom $OriginalState.HasBom

    $remaining = @(Get-ForbiddenSigningProperties)
    if ($remaining.Count -ne 0) {
        throw 'Gradle properties에서 평문 서명 항목을 완전히 제거하지 못했습니다.'
    }
}

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

function Get-CertificateFingerprint {
    param(
        [Parameter(Mandatory)][string]$KeytoolOutput,
        [Parameter(Mandatory)][ValidateSet('SHA1', 'SHA256')][string]$Algorithm
    )

    $match = [regex]::Match(
        $KeytoolOutput,
        "(?im)^\s*${Algorithm}:\s*(?<fingerprint>[0-9A-F:]+)\s*$"
    )
    if (-not $match.Success) {
        throw "선택한 키의 $Algorithm 인증서 지문을 확인하지 못했습니다."
    }
    return $match.Groups['fingerprint'].Value.ToUpperInvariant()
}

function Get-NormalizedFingerprint {
    param(
        [Parameter(Mandatory)][string]$Fingerprint,
        [Parameter(Mandatory)][ValidateSet(40, 64)][int]$ExpectedLength,
        [Parameter(Mandatory)][string]$Label
    )

    $normalized = ($Fingerprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
    if ($normalized -notmatch "^[0-9A-F]{$ExpectedLength}$") {
        throw "$Label 인증서 지문 형식이 올바르지 않습니다."
    }
    return $normalized
}

function Invoke-External {
    param(
        [Parameter(Mandatory)][scriptblock]$Command,
        [Parameter(Mandatory)][string]$FailureMessage,
        [int[]]$AllowedExitCodes = @(0)
    )

    & $Command
    $exitCode = $LASTEXITCODE
    if ($AllowedExitCodes -notcontains $exitCode) {
        throw "$FailureMessage (exit $exitCode)"
    }
    return $exitCode
}

function Get-GitState {
    Push-Location $repoRoot
    try {
        $head = (& git rev-parse HEAD).Trim().ToLowerInvariant()
        if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[a-f0-9]{40}$') {
            throw 'Git commit SHA를 확인할 수 없습니다.'
        }
        $status = (& git status --porcelain=v1 --untracked-files=all | Out-String).Trim()
        return [pscustomobject]@{
            Head = $head
            Clean = [string]::IsNullOrWhiteSpace($status)
        }
    } finally {
        Pop-Location
    }
}

function Get-DotEnvVariables {
    param([Parameter(Mandatory)][string]$Path)

    $values = [ordered]@{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $values
    }

    foreach ($line in [System.IO.File]::ReadLines($Path)) {
        $match = [regex]::Match(
            $line,
            '^\s*(?:export\s+)?(?<name>VITE_[A-Za-z0-9_]+)\s*=\s*(?<value>.*)\s*$'
        )
        if (-not $match.Success) {
            continue
        }

        $name = $match.Groups['name'].Value
        $value = $match.Groups['value'].Value.Trim()
        if ($value.Length -ge 2 -and (
            ($value.StartsWith('"') -and $value.EndsWith('"')) `
            -or ($value.StartsWith("'") -and $value.EndsWith("'"))
        )) {
            $value = $value.Substring(1, $value.Length - 2)
        } else {
            $value = [regex]::Replace($value, '\s+#.*$', '').Trim()
        }
        $values[$name] = $value
    }
    return $values
}

function Get-ViteReleaseEnvironmentState {
    $values = @{}
    $sources = @{}
    foreach ($processVariable in Get-ChildItem Env: | Where-Object { $_.Name -match '^VITE_[A-Za-z0-9_]+$' }) {
        if ([string]::IsNullOrWhiteSpace($processVariable.Value)) {
            continue
        }
        $values[$processVariable.Name] = $processVariable.Value
        $sources[$processVariable.Name] = 'process-environment'
    }

    $gitCommonDir = $null
    Push-Location $repoRoot
    try {
        $gitCommonDir = (& git rev-parse --path-format=absolute --git-common-dir 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) {
            $gitCommonDir = $null
        }
    } finally {
        Pop-Location
    }

    $envCandidates = @((Join-Path $repoRoot '.env'))
    if (-not [string]::IsNullOrWhiteSpace($gitCommonDir)) {
        $primaryWorktreeRoot = Split-Path -Parent ([System.IO.Path]::GetFullPath($gitCommonDir))
        $envCandidates += Join-Path $primaryWorktreeRoot '.env'
    }

    $seenEnvCandidates = @{}
    foreach ($candidate in $envCandidates) {
        $fullCandidate = [System.IO.Path]::GetFullPath($candidate)
        if ($seenEnvCandidates.ContainsKey($fullCandidate)) {
            continue
        }
        $seenEnvCandidates[$fullCandidate] = $true

        $sourceLabel = if ($fullCandidate -eq [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.env'))) {
            'current-worktree-env'
        } else {
            'primary-worktree-env'
        }
        $candidateValues = Get-DotEnvVariables -Path $fullCandidate
        foreach ($name in $candidateValues.Keys) {
            if ($values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($candidateValues[$name])) {
                continue
            }
            $values[$name] = $candidateValues[$name]
            $sources[$name] = $sourceLabel
        }
    }

    $kakaoName = 'VITE_KAKAO_APP_KEY'
    $naverName = 'VITE_NAVER_CLIENT_ID'
    return [pscustomobject]@{
        Values = $values
        VariableNames = @($values.Keys | Sort-Object)
        KakaoConfigured = $values.ContainsKey($kakaoName)
        KakaoSource = if ($sources.ContainsKey($kakaoName)) { $sources[$kakaoName] } else { 'missing' }
        NaverClientIdConfigured = $values.ContainsKey($naverName)
        NaverClientIdSource = if ($sources.ContainsKey($naverName)) { $sources[$naverName] } else { 'missing' }
    }
}

function Set-ViteReleaseEnvironment {
    param([Parameter(Mandatory)]$State)

    $snapshot = @()
    foreach ($name in $State.VariableNames) {
        $originalValue = [Environment]::GetEnvironmentVariable($name, 'Process')
        $snapshot += [pscustomobject]@{
            Name = $name
            HadOriginalValue = $null -ne $originalValue
            OriginalValue = $originalValue
        }
        [Environment]::SetEnvironmentVariable($name, $State.Values[$name], 'Process')
    }
    return $snapshot
}

function Restore-ViteReleaseEnvironment {
    param([Parameter(Mandatory)][object[]]$Snapshot)

    foreach ($entry in $Snapshot) {
        if ($entry.HadOriginalValue) {
            [Environment]::SetEnvironmentVariable($entry.Name, $entry.OriginalValue, 'Process')
        } else {
            [Environment]::SetEnvironmentVariable($entry.Name, $null, 'Process')
        }
    }
}

function Get-AndroidSdkRoot {
    $candidates = @(
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME,
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    foreach ($candidate in $candidates) {
        $full = [System.IO.Path]::GetFullPath($candidate)
        if (Test-Path -LiteralPath $full -PathType Container) {
            return $full
        }
    }
    throw 'Android SDK 경로를 찾을 수 없습니다.'
}

function Find-LatestTool {
    param(
        [Parameter(Mandatory)][string]$Parent,
        [Parameter(Mandatory)][string]$RelativeToolPath,
        [Parameter(Mandatory)][string]$Label
    )

    if (-not (Test-Path -LiteralPath $Parent -PathType Container)) {
        throw "$Label 탐색 경로가 없습니다: $Parent"
    }
    $candidates = Get-ChildItem -LiteralPath $Parent -Directory |
        Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending
    foreach ($candidate in $candidates) {
        $tool = Join-Path $candidate.FullName $RelativeToolPath
        if (Test-Path -LiteralPath $tool -PathType Leaf) {
            return $tool
        }
    }
    throw "$Label 실행 파일을 찾을 수 없습니다."
}

function Ensure-Bundletool {
    Assert-PathWithin -Path $bundletoolPath -Root $evidenceRoot -Label 'bundletool'
    if (-not (Test-Path -LiteralPath $bundletoolPath -PathType Leaf)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $bundletoolPath) | Out-Null
        Invoke-WebRequest -Uri $bundletoolUrl -OutFile $bundletoolPath
    }
    $actual = Get-Sha256Hex -Path $bundletoolPath
    if ($actual -ne $bundletoolSha256) {
        throw "bundletool SHA-256이 승인값과 다릅니다: $actual"
    }
}

function Archive-ExistingReleaseAab {
    if (-not (Test-Path -LiteralPath $releaseAab -PathType Leaf)) {
        return $null
    }

    $sha = Get-Sha256Hex -Path $releaseAab
    $archiveRoot = Join-Path $evidenceRoot 'historical-release-aab'
    Assert-PathWithin -Path $archiveRoot -Root $evidenceRoot -Label '기존 AAB 보관'
    New-Item -ItemType Directory -Force -Path $archiveRoot | Out-Null
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $destination = Join-Path $archiveRoot "app-release-$timestamp-$($sha.Substring(0, 8)).aab"
    Move-Item -LiteralPath $releaseAab -Destination $destination
    return $destination
}

function Clear-LegacyCredentialFile {
    if (-not (Test-Path -LiteralPath $legacyCredentialFile -PathType Leaf)) {
        return
    }
    Assert-PathWithin -Path $legacyCredentialFile -Root $androidRoot -Label '평문 자격정보 파일'
    $length = (Get-Item -LiteralPath $legacyCredentialFile).Length
    if ($length -gt 0) {
        [System.IO.File]::WriteAllBytes($legacyCredentialFile, [byte[]]::new($length))
    }
    [System.IO.File]::Delete($legacyCredentialFile)
}

function Clear-SigningEnvironment {
    foreach ($name in $signingVariableNames) {
        Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
}

function Clear-ReleaseEvidenceEnvironment {
    Get-ChildItem Env: | Where-Object { $_.Name -like 'HYENI_RELEASE_*' } |
        ForEach-Object { Remove-Item -LiteralPath "Env:$($_.Name)" -ErrorAction SilentlyContinue }
}

$selectedKeystore = if ([string]::IsNullOrWhiteSpace($KeystorePath)) {
    $defaultKeystore
} else {
    [System.IO.Path]::GetFullPath($KeystorePath)
}
$selectedPlayUploadCertificate = if ([string]::IsNullOrWhiteSpace($PlayUploadCertificatePath)) {
    $defaultPlayUploadCertificate
} else {
    [System.IO.Path]::GetFullPath($PlayUploadCertificatePath)
}
$playUploadCertificatePresent = Test-Path -LiteralPath $selectedPlayUploadCertificate -PathType Leaf
$playExpectedUploadCertificateSha1 = $null
if ($playUploadCertificatePresent) {
    $playUploadCertificate = $null
    try {
        $playUploadCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
            $selectedPlayUploadCertificate
        )
        $playExpectedUploadCertificateSha1 = @(
            $playUploadCertificate.GetCertHash() | ForEach-Object { $_.ToString('X2') }
        ) -join ':'
    } catch {
        throw "Play 업로드 인증서 파일을 읽지 못했습니다: $selectedPlayUploadCertificate"
    } finally {
        if ($null -ne $playUploadCertificate) {
            $playUploadCertificate.Dispose()
        }
    }
}

$gitState = Get-GitState
$viteReleaseEnvironmentState = Get-ViteReleaseEnvironmentState
$forbiddenProperties = @(Get-ForbiddenSigningProperties)
$preflight = [ordered]@{
    sourceCommit = $gitState.Head
    worktreeClean = $gitState.Clean
    keystorePath = $selectedKeystore
    keystorePresent = Test-Path -LiteralPath $selectedKeystore -PathType Leaf
    playUploadCertificatePath = $selectedPlayUploadCertificate
    playUploadCertificatePresent = $playUploadCertificatePresent
    playExpectedUploadCertificateSha1 = $playExpectedUploadCertificateSha1
    forbiddenGradlePropertyNames = $forbiddenProperties
    legacyCredentialFilePresent = Test-Path -LiteralPath $legacyCredentialFile -PathType Leaf
    viteKakaoKeyConfigured = $viteReleaseEnvironmentState.KakaoConfigured
    viteKakaoKeySource = $viteReleaseEnvironmentState.KakaoSource
    viteNaverClientIdConfigured = $viteReleaseEnvironmentState.NaverClientIdConfigured
    viteNaverClientIdSource = $viteReleaseEnvironmentState.NaverClientIdSource
    vitePublicVariableNames = $viteReleaseEnvironmentState.VariableNames
    releaseAabPath = $releaseAab
}

if ($PreflightOnly) {
    [pscustomobject]$preflight | ConvertTo-Json -Depth 3
    if (-not $gitState.Clean `
        -or -not $preflight.keystorePresent `
        -or -not $playUploadCertificatePresent `
        -or -not $viteReleaseEnvironmentState.KakaoConfigured) {
        exit 2
    }
    exit 0
}

if (-not $gitState.Clean) {
    throw 'release AAB는 clean worktree에서만 만들 수 있습니다.'
}
if (-not $preflight.keystorePresent) {
    throw "업로드 키스토어가 없습니다: $selectedKeystore"
}
if (-not $playUploadCertificatePresent) {
    throw "Play Console에서 받은 업로드 인증서가 없습니다: $selectedPlayUploadCertificate"
}
if (-not $viteReleaseEnvironmentState.KakaoConfigured) {
    throw 'production release에 필요한 VITE_KAKAO_APP_KEY를 현재 또는 기본 worktree의 .env에서 찾지 못했습니다.'
}
if (-not (Test-Path -LiteralPath $gradleWrapper -PathType Leaf)) {
    throw "Gradle wrapper가 없습니다: $gradleWrapper"
}

$sdkRoot = Get-AndroidSdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_HOME = $sdkRoot
# 연결 worktree 이름에 한글이 있어도 Android Gradle Plugin이 빌드 자체를 막지 않게 한다.
# 현재 PowerShell 프로세스와 자식 Gradle에만 전달하며 프로젝트·사용자 설정 파일은 건드리지 않는다.
[Environment]::SetEnvironmentVariable(
    'ORG_GRADLE_PROJECT_android.overridePathCheck',
    'true',
    'Process'
)
$zipalign = Find-LatestTool -Parent (Join-Path $sdkRoot 'build-tools') `
    -RelativeToolPath 'zipalign.exe' -Label 'zipalign'
$readelf = Find-LatestTool -Parent (Join-Path $sdkRoot 'ndk') `
    -RelativeToolPath 'toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe' `
    -Label 'llvm-readelf'
Ensure-Bundletool

Write-Host '1/6 production 웹 번들을 만들고 Android에 동기화합니다.'
$viteEnvironmentSnapshot = @(Set-ViteReleaseEnvironment -State $viteReleaseEnvironmentState)
Push-Location $repoRoot
try {
    Invoke-External -Command { & npm.cmd run build } -FailureMessage 'production 웹 빌드 실패' | Out-Null
    Invoke-External -Command { & npx.cmd cap sync android } -FailureMessage 'Capacitor Android 동기화 실패' | Out-Null
} finally {
    Pop-Location
    Restore-ViteReleaseEnvironment -Snapshot $viteEnvironmentSnapshot
}

$postSyncGit = Get-GitState
if (-not $postSyncGit.Clean -or $postSyncGit.Head -ne $gitState.Head) {
    throw 'build 또는 cap sync 후 worktree/source commit이 달라졌습니다.'
}

Write-Host '2/6 서명 값은 화면에 표시하거나 파일에 저장하지 않습니다.'
$mapsApiKeySecure = Read-Host 'Google Maps Android API 키' -AsSecureString
$keystorePasswordSecure = Read-Host '키스토어 비밀번호' -AsSecureString
$keyPasswordSecure = $null
$keyAlias = $null

$originalGradleState = if (Test-Path -LiteralPath $gradleProperties -PathType Leaf) {
    Get-Utf8TextState -Path $gradleProperties
} else {
    $null
}
$gradlePropertiesSanitized = $false
$releaseBuildSucceeded = $false
$plainMapsApiKey = $null
$plainKeystorePassword = $null
$plainKeyPassword = $null
$selectedCertificateSha1 = $null
$uploadCertificateSha256 = $null

try {
    $plainMapsApiKey = Convert-SecureStringToPlainText -Value $mapsApiKeySecure
    if ([string]::IsNullOrWhiteSpace($plainMapsApiKey)) {
        throw '빈 Google Maps Android API 키는 허용하지 않습니다.'
    }
    $env:ORG_GRADLE_PROJECT_MAPS_API_KEY = $plainMapsApiKey

    $plainKeystorePassword = Convert-SecureStringToPlainText -Value $keystorePasswordSecure
    if ([string]::IsNullOrEmpty($plainKeystorePassword)) {
        throw '빈 키스토어 비밀번호는 허용하지 않습니다.'
    }

    Clear-SigningEnvironment
    $env:HYENI_KEYSTORE = $selectedKeystore
    $env:HYENI_KEYSTORE_PASSWORD = $plainKeystorePassword

    $keytool = (Get-Command keytool.exe -ErrorAction Stop).Source
    $keytoolLines = @(& $keytool '-J-Duser.language=en' '-J-Duser.country=US' '-list' '-v' `
        '-keystore' $selectedKeystore '-storepass:env' 'HYENI_KEYSTORE_PASSWORD' 2>&1)
    $keytoolExitCode = $LASTEXITCODE
    $keytoolOutput = ($keytoolLines | Out-String)
    if ($keytoolExitCode -ne 0) {
        if ($keytoolOutput -match '(?i)(password was incorrect|keystore was tampered with|password verification failed|failed to decrypt)') {
            throw '키스토어 비밀번호가 일치하지 않습니다.'
        }
        throw '키스토어를 열지 못했습니다. 키스토어 파일 형식과 손상 여부를 확인해 주세요.'
    }

    $privateKeyAliases = @(
        [regex]::Matches(
            $keytoolOutput,
            '(?ms)^Alias name:\s*(?<alias>[^\r\n]+)\r?\n.*?^Entry type:\s*PrivateKeyEntry\s*$'
        ) | ForEach-Object { $_.Groups['alias'].Value.Trim() } | Sort-Object -Unique
    )
    if ($privateKeyAliases.Count -eq 0) {
        throw '키스토어에 서명 가능한 PrivateKeyEntry가 없습니다.'
    }
    if ($privateKeyAliases.Count -eq 1) {
        $keyAlias = $privateKeyAliases[0]
        Write-Host "업로드 키 별칭을 키스토어에서 확인했습니다: $keyAlias"
    } else {
        Write-Host "서명 가능한 키 별칭: $($privateKeyAliases -join ', ')"
        $requestedAlias = (Read-Host '사용할 업로드 키 별칭').Trim()
        $keyAlias = $privateKeyAliases | Where-Object { $_ -ieq $requestedAlias } | Select-Object -First 1
        if ([string]::IsNullOrWhiteSpace($keyAlias)) {
            throw '입력한 별칭은 키스토어의 PrivateKeyEntry가 아닙니다.'
        }
    }

    $selectedAliasLines = @(& $keytool '-J-Duser.language=en' '-J-Duser.country=US' '-list' '-v' `
        '-keystore' $selectedKeystore '-storepass:env' 'HYENI_KEYSTORE_PASSWORD' `
        '-alias' $keyAlias 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw '선택한 업로드 키의 인증서를 확인하지 못했습니다.'
    }
    $selectedAliasOutput = ($selectedAliasLines | Out-String)
    $selectedCertificateSha1 = Get-CertificateFingerprint `
        -KeytoolOutput $selectedAliasOutput -Algorithm 'SHA1'
    $selectedCertificateSha256 = Get-CertificateFingerprint `
        -KeytoolOutput $selectedAliasOutput -Algorithm 'SHA256'
    $normalizedExpectedSha1 = Get-NormalizedFingerprint `
        -Fingerprint $playExpectedUploadCertificateSha1 -ExpectedLength 40 -Label 'Play Console 요구 SHA-1'
    $normalizedSelectedSha1 = Get-NormalizedFingerprint `
        -Fingerprint $selectedCertificateSha1 -ExpectedLength 40 -Label '선택한 키 SHA-1'
    if ($normalizedSelectedSha1 -ne $normalizedExpectedSha1) {
        throw "선택한 키는 Play Console에 등록된 업로드 키가 아닙니다. Play 요구 SHA-1: $playExpectedUploadCertificateSha1 / 선택 키 SHA-1: $selectedCertificateSha1. 이 키로 AAB를 만들지 않습니다."
    }
    $uploadCertificateSha256 = (Get-NormalizedFingerprint `
        -Fingerprint $selectedCertificateSha256 -ExpectedLength 64 -Label '선택한 키 SHA-256').ToLowerInvariant()
    Write-Host "Play Console 업로드 키 SHA-1 일치를 확인했습니다: $selectedCertificateSha1"

    $keyPasswordSecure = Read-Host '키 비밀번호' -AsSecureString
    $plainKeyPassword = Convert-SecureStringToPlainText -Value $keyPasswordSecure
    if ([string]::IsNullOrEmpty($plainKeyPassword)) {
        throw '빈 키 비밀번호는 허용하지 않습니다.'
    }
    $env:HYENI_KEY_ALIAS = $keyAlias
    $env:HYENI_KEY_PASSWORD = $plainKeyPassword

    Write-Host '3/6 입력값 검증 후 Gradle의 평문 서명 property를 제거합니다.'
    if ($null -ne $originalGradleState -and $forbiddenProperties.Count -gt 0) {
        Remove-ForbiddenSigningProperties -OriginalState $originalGradleState
        $gradlePropertiesSanitized = $true
    }

    $archivedAab = Archive-ExistingReleaseAab
    if ($null -ne $archivedAab) {
        Write-Host "기존 release AAB를 역사 보관함으로 이동했습니다: $archivedAab"
    }

    Write-Host '4/6 clean source에서 서명 release AAB를 만듭니다.'
    Push-Location $androidRoot
    try {
        Invoke-External -Command { & $gradleWrapper ':app:bundleRelease' } `
            -FailureMessage '서명 release AAB 빌드 실패' | Out-Null
    } finally {
        Pop-Location
    }

    if (-not (Test-Path -LiteralPath $releaseAab -PathType Leaf)) {
        throw "release AAB가 생성되지 않았습니다: $releaseAab"
    }
    $releaseBuildSucceeded = $true

    Write-Host '5/6 빌드 성공 후 남은 평문 자격정보 파일을 제거합니다.'
    Clear-LegacyCredentialFile

    Write-Host '6/6 서명·manifest·16KB 정렬 증거와 업로드 폴더를 만듭니다.'
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $shortSha = $gitState.Head.Substring(0, 7)
    $evidencePath = Join-Path $evidenceRoot "android-release-aab-evidence-$timestamp-$shortSha.json"
    $verificationLogPath = Join-Path $evidenceRoot "android-release-aab-verification-$timestamp-$shortSha.txt"
    Push-Location $repoRoot
    try {
        Invoke-External -Command {
            & npm.cmd run release:aab-evidence -- `
                --aab $releaseAab `
                --bundletool-jar $bundletoolPath `
                --zipalign $zipalign `
                --readelf $readelf `
                --build-type release `
                --expected-source-sha $gitState.Head `
                --expected-certificate-sha256 $uploadCertificateSha256 `
                --out $evidencePath `
                --verification-log-out $verificationLogPath
        } -FailureMessage 'release AAB 기계 검증 실패' | Out-Null
    } finally {
        Pop-Location
    }

    $evidence = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
    if ($evidence.buildType -ne 'release' `
        -or $evidence.sourceCommit -ne $gitState.Head `
        -or $evidence.manifest.debuggable -ne $false `
        -or $evidence.signature.jarsignerVerified -ne $true `
        -or $evidence.signature.expectedCertificateMatched -ne $true `
        -or $evidence.webAssets.matched -ne $true `
        -or $evidence.alignment16Kb.bundleConfigPageAlignment16Kb -ne $true `
        -or $evidence.alignment16Kb.universalApkZipAligned16Kb -ne $true `
        -or $evidence.alignment16Kb.allElfLoadSegmentsAtLeast16384 -ne $true) {
        throw 'release AAB evidence의 필수 검증값이 GREEN이 아닙니다.'
    }

    $package = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'package.json') | ConvertFrom-Json
    $buildGradle = Get-Content -Raw -LiteralPath (Join-Path $androidRoot 'app\build.gradle')
    if ($buildGradle -notmatch '(?m)^\s*versionCode\s+(\d+)\s*$') {
        throw 'versionCode를 확인할 수 없습니다.'
    }
    $versionCode = [int]$Matches[1]
    $uploadRoot = Join-Path $evidenceRoot "play-upload-v$($package.version)-vc$versionCode-$shortSha"
    Assert-PathWithin -Path $uploadRoot -Root $evidenceRoot -Label 'Play 업로드 폴더'
    if (Test-Path -LiteralPath $uploadRoot) {
        throw "Play 업로드 폴더가 이미 존재합니다: $uploadRoot"
    }
    New-Item -ItemType Directory -Path $uploadRoot | Out-Null
    $uploadAab = Join-Path $uploadRoot "hyeni-calendar-v$($package.version)-vc$versionCode-$shortSha.aab"
    Copy-Item -LiteralPath $releaseAab -Destination $uploadAab
    $aabSha256 = Get-Sha256Hex -Path $uploadAab
    $evidenceSha256 = Get-Sha256Hex -Path $evidencePath
    Copy-Item -LiteralPath $evidencePath -Destination (Join-Path $uploadRoot ([System.IO.Path]::GetFileName($evidencePath)))
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText(
        (Join-Path $uploadRoot 'SHA256SUMS.txt'),
        "$aabSha256  $([System.IO.Path]::GetFileName($uploadAab))`n$evidenceSha256  $([System.IO.Path]::GetFileName($evidencePath))`n",
        $utf8
    )
    [System.IO.File]::WriteAllText(
        (Join-Path $uploadRoot 'UPLOAD-INSTRUCTIONS.txt'),
        "Google Play Console 업로드 대상은 $([System.IO.Path]::GetFileName($uploadAab)) 파일 하나입니다.`nZIP 파일과 debug AAB는 업로드하지 마세요.`nsource commit: $($gitState.Head)`nAAB SHA-256: $aabSha256`n업로드 인증서 SHA-1: $selectedCertificateSha1`n업로드 인증서 SHA-256: $uploadCertificateSha256`nPlay App Signing의 앱 서명 키 SHA-256 확인 후 assetlinks.json 교체가 별도로 필요합니다.`n",
        $utf8
    )

    Clear-ReleaseEvidenceEnvironment
    $env:HYENI_RELEASE_AAB_PATH = $releaseAab
    $env:HYENI_RELEASE_AAB_SOURCE_SHA = $gitState.Head
    $env:HYENI_RELEASE_AAB_EVIDENCE_PATH = $evidencePath
    $env:HYENI_RELEASE_AAB_EVIDENCE_SHA256 = $evidenceSha256
    $env:HYENI_RELEASE_UPLOAD_CERTIFICATE_SHA256 = $uploadCertificateSha256
    $env:HYENI_RELEASE_OBSERVATION_OWNER = 'release-operator'
    $releaseRecordPath = Join-Path $evidenceRoot "release-record-$timestamp-$shortSha-post-signing.json"
    Push-Location $repoRoot
    try {
        Invoke-External -Command {
            & npm.cmd run release:record -- --out $releaseRecordPath
        } -FailureMessage '출시 기록 생성 실패' -AllowedExitCodes @(0, 2) | Out-Null
    } finally {
        Pop-Location
    }

    $record = Get-Content -Raw -LiteralPath $releaseRecordPath | ConvertFrom-Json
    [pscustomobject]@{
        uploadAab = $uploadAab
        uploadAabSha256 = $aabSha256
        sourceCommit = $gitState.Head
        releaseEvidence = $evidencePath
        releaseRecord = $releaseRecordPath
        releaseVerdict = $record.assessment.verdict
        remainingBlockerCount = $record.assessment.blockers.Count
        plaintextSigningPropertiesRemaining = @(Get-ForbiddenSigningProperties).Count
        legacyCredentialFilePresent = Test-Path -LiteralPath $legacyCredentialFile -PathType Leaf
    } | ConvertTo-Json -Depth 3
} finally {
    Clear-SigningEnvironment
    Clear-ReleaseEvidenceEnvironment
    Remove-Item -LiteralPath 'Env:ORG_GRADLE_PROJECT_MAPS_API_KEY' -ErrorAction SilentlyContinue
    $plainMapsApiKey = $null
    $plainKeystorePassword = $null
    $plainKeyPassword = $null
    $selectedCertificateSha1 = $null
    $uploadCertificateSha256 = $null
    $mapsApiKeySecure = $null
    $keystorePasswordSecure = $null
    $keyPasswordSecure = $null

    if (-not $releaseBuildSucceeded -and $gradlePropertiesSanitized -and $null -ne $originalGradleState) {
        [System.IO.File]::WriteAllBytes($gradleProperties, $originalGradleState.Bytes)
        Write-Warning 'release 빌드가 완료되지 않아 기존 Gradle properties를 원복했습니다.'
    }
}
