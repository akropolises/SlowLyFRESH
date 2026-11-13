# Android版を組み立てる道具(JDK 17・Android SDK・Gradle)を %LOCALAPPDATA%\MicroSlowAndroid に入れる。
# 管理者権限やAndroid Studioは要らない。入っているものは飛ばすので、何度実行してもよい
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$root = Join-Path $env:LOCALAPPDATA "MicroSlowAndroid"
$dl = Join-Path $root "downloads"
New-Item -ItemType Directory -Force $dl | Out-Null

function Get-Zip($url, $name) {
  $file = Join-Path $dl $name
  if (-not (Test-Path $file)) { Write-Host "download $url"; Invoke-WebRequest $url -OutFile $file -UseBasicParsing }
  return $file
}

function Expand-Single($zip, $target) {
  $tmp = "$target-tmp"
  Expand-Archive $zip $tmp -Force
  Move-Item (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName $target
  Remove-Item $tmp -Recurse -Force
}

if (-not (Test-Path "$root\jdk\bin\java.exe")) {
  Expand-Single (Get-Zip "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse" "jdk17.zip") "$root\jdk"
}

$sdk = "$root\sdk"
if (-not (Test-Path "$sdk\cmdline-tools\latest\bin\sdkmanager.bat")) {
  New-Item -ItemType Directory -Force "$sdk\cmdline-tools" | Out-Null
  Expand-Single (Get-Zip "https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip" "cmdline-tools.zip") "$sdk\cmdline-tools\latest"
}

if (-not (Test-Path "$root\gradle\bin\gradle.bat")) {
  Expand-Single (Get-Zip "https://services.gradle.org/distributions/gradle-8.10.2-bin.zip" "gradle.zip") "$root\gradle"
}

$env:JAVA_HOME = "$root\jdk"
$sdkmanager = "$sdk\cmdline-tools\latest\bin\sdkmanager.bat"
# SDKのライセンスに同意してから、ビルドに要るものを入れる
("y`n" * 20) | & $sdkmanager --sdk_root=$sdk --licenses | Out-Null
& $sdkmanager --sdk_root=$sdk "platform-tools" "platforms;android-35" "build-tools;35.0.0" | Out-Null
Write-Host "道具の準備ができました: $root"
