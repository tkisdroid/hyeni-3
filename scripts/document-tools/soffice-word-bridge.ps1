param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Arguments
)

$outDir = $null
$inputPath = $null
for ($index = 0; $index -lt $Arguments.Count; $index += 1) {
  if ($Arguments[$index] -eq '--outdir' -and $index + 1 -lt $Arguments.Count) {
    $outDir = $Arguments[$index + 1]
    $index += 1
    continue
  }
  if (-not $Arguments[$index].StartsWith('-')) {
    $inputPath = $Arguments[$index]
  }
}

if (-not $outDir -or -not $inputPath) {
  Write-Error 'Word bridge requires --outdir and an input document.'
  exit 2
}

$resolvedInput = (Resolve-Path -LiteralPath $inputPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($outDir)
[System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null
$pdfPath = Join-Path $resolvedOutput ([System.IO.Path]::GetFileNameWithoutExtension($resolvedInput) + '.pdf')

$word = $null
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($resolvedInput, $false, $true)
  $document.ExportAsFixedFormat($pdfPath, 17)
  Write-Output 'converted'
} catch {
  Write-Error $_
  exit 1
} finally {
  if ($document) { $document.Close($false) }
  if ($word) { $word.Quit() }
  if ($document) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
  if ($word) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
