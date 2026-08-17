$ErrorActionPreference = 'Stop'

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$Host.UI.RawUI.WindowTitle = '혜니캘린더 Play 출시 파일 만들기'

$releaseRoot = 'C:\Users\TK\Desktop\hyeni-3\.worktrees\play-release-20260808'
$certificate = 'C:\Users\TK\keys\hyeni-calendar\android-signing\public\play-upload-reset-candidate_certificate.pem'
$resultPath = Join-Path $env:TEMP 'hyeni-play-release-20260808-a5c5e6a.status.json'
$exitCode = 1
$message = '알 수 없는 오류'

try {
    Set-Location -LiteralPath $releaseRoot
    & '.\scripts\build-android-release.ps1' -PlayUploadCertificatePath $certificate
    $exitCode = 0
    $message = '서명 AAB와 제출 묶음 생성 완료'
    Write-Host ''
    Write-Host '서명 AAB와 제출 묶음 생성이 완료되었습니다.' -ForegroundColor Green
} catch {
    $message = $_.Exception.Message
    Write-Host ''
    Write-Host "빌드 실패: $message" -ForegroundColor Red
} finally {
    [pscustomobject]@{
        exitCode = $exitCode
        message = $message
        finishedAt = (Get-Date).ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding utf8
}

Read-Host '결과를 확인한 뒤 Enter를 누르면 창이 닫힙니다'
exit $exitCode
