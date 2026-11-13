# APKを作る。USBでつないだスマホがあれば、そのままインストールする(-NoInstall で作るだけ)
param([switch]$NoInstall)
$ErrorActionPreference = "Stop"
$root = Join-Path $env:LOCALAPPDATA "MicroSlowAndroid"
if (-not (Test-Path "$root\jdk\bin\java.exe")) {
  throw "道具が入っていません。先に setup-tools.ps1 を実行してください"
}
$env:JAVA_HOME = "$root\jdk"
Set-Location $PSScriptRoot
if (-not (Test-Path "local.properties")) {
  "sdk.dir=$("$root\sdk".Replace('\', '/'))" | Out-File local.properties -Encoding ascii
}

& .\gradlew.bat assembleDebug -q
if ($LASTEXITCODE -ne 0) { throw "ビルドに失敗しました" }
$apk = Join-Path $PSScriptRoot "app\build\outputs\apk\debug\app-debug.apk"
Write-Host "APK: $apk"
if ($NoInstall) { return }

$adb = "$root\sdk\platform-tools\adb.exe"
$devices = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" }
if (-not $devices) {
  Write-Host "スマホがつながっていないので、インストールはしませんでした(README.md の「スマホに入れる」を参照)"
  return
}
& $adb install -r $apk
