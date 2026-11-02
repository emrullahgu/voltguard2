param([string]$DataDirectory = '', [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\','/')
if (!$DataDirectory) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $workspaceHash = -join ($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant())) | ForEach-Object { $_.ToString('x2') }) } finally { $hasher.Dispose() }
    $DataDirectory = Join-Path $env:LOCALAPPDATA ('VoltGuard\preview-data\' + $workspaceHash.Substring(0,20))
}
$privateRoot = [IO.Path]::GetFullPath($DataDirectory).TrimEnd('\','/')
if ($privateRoot.Equals($projectRoot,[StringComparison]::OrdinalIgnoreCase) -or $privateRoot.StartsWith($projectRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Anahtar klasoru web kokunun disinda olmali.' }
$probe = $privateRoot
while ($probe) {
    if ((Test-Path -LiteralPath $probe) -and ((Get-Item -LiteralPath $probe -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Anahtar klasorunde baglanti veya junction kullanilamaz.' }
    $parent = [IO.Path]::GetDirectoryName($probe)
    if ($parent -eq $probe) { break }; $probe = $parent
}
$settingsFile = Join-Path $privateRoot 'integrations-secrets.json'
$providers = @(
    @{ Label='Google Gemini'; Keys=@('VG_GEMINI_API_KEY'); Url='https://aistudio.google.com/api-keys' },
    @{ Label='Groq'; Keys=@('VG_GROQ_API_KEY'); Url='https://console.groq.com/keys' },
    @{ Label='OpenRouter (ucretsiz modeller)'; Keys=@('VG_OPENROUTER_API_KEY'); Url='https://openrouter.ai/settings/keys' },
    @{ Label='Cloudflare Workers AI'; Keys=@('VG_CLOUDFLARE_ACCOUNT_ID','VG_CLOUDFLARE_API_TOKEN'); Url='https://dash.cloudflare.com/' },
    @{ Label='OpenWeather'; Keys=@('VG_OPENWEATHER_API_KEY'); Url='https://home.openweathermap.org/api_keys' },
    @{ Label='IPinfo Lite'; Keys=@('VG_IPINFO_TOKEN'); Url='https://ipinfo.io/account/token' },
    @{ Label='EPiAS'; Keys=@('VG_EPIAS_USERNAME','VG_EPIAS_PASSWORD'); Url='https://giris.epias.com.tr/' },
    @{ Label='Unsplash'; Keys=@('VG_UNSPLASH_ACCESS_KEY'); Url='https://unsplash.com/developers' },
    @{ Label='TMDB (ticari lisans ayri gerekir)'; Keys=@('VG_TMDB_TOKEN'); Url='https://www.themoviedb.org/settings/api' },
    @{ Label='NewsAPI (ucretsiz plan yalniz yerel gelistirme)'; Keys=@('VG_NEWSAPI_KEY'); Url='https://newsapi.org/account' },
    @{ Label='CoinGecko Demo (istege bagli)'; Keys=@('VG_COINGECKO_DEMO_KEY'); Url='https://www.coingecko.com/en/developers/dashboard' },
    @{ Label='GitHub (istege bagli, yalniz public_repo okuma)'; Keys=@('VG_GITHUB_TOKEN'); Url='https://github.com/settings/personal-access-tokens' }
)
if ($CheckOnly) { Write-Output ('Guvenli anahtar klasoru: '+$privateRoot); Write-Output ('Servis sayisi: '+$providers.Count); exit 0 }
if (!(Test-Path -LiteralPath $privateRoot)) { New-Item -ItemType Directory -Path $privateRoot -Force | Out-Null }
function Read-Settings {
    $result = @{}
    if (Test-Path -LiteralPath $settingsFile) {
        $item = Get-Item -LiteralPath $settingsFile -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 65536) { throw 'Anahtar dosyasi dogrulanamadi.' }
        $parsed = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
        foreach ($property in $parsed.PSObject.Properties) { $result[$property.Name] = [string]$property.Value }
    }; return $result
}
function Save-Settings($changes) {
    $temporary = Join-Path $privateRoot ([Guid]::NewGuid().ToString('N')+'.tmp')
    $lockFile=Join-Path $privateRoot '.integrations-config.lock'
    if ((Test-Path -LiteralPath $lockFile) -and ((Get-Item -LiteralPath $lockFile -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Yapilandirma kilidi dogrulanamadi.' }
    $lock=$null; $deadline=[DateTime]::UtcNow.AddSeconds(10)
    while (!$lock) { try {$lock=[IO.File]::Open($lockFile,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)} catch [IO.IOException] { if ([DateTime]::UtcNow -ge $deadline) {throw 'Baska bir anahtar penceresi kaydediyor. Biraz sonra tekrar deneyin.'}; [Threading.Thread]::Sleep(100) } }
    try {
        $settings=Read-Settings
        foreach ($key in $changes.Keys) { $settings[$key]=$changes[$key] }
        [IO.File]::WriteAllText($temporary,'')
        $access = New-Object Security.AccessControl.FileSecurity
        $access.SetAccessRuleProtection($true,$false)
        $current = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $access.SetOwner($current)
        $access.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($current,'FullControl','Allow')))
        [IO.File]::SetAccessControl($temporary,$access)
        [IO.File]::WriteAllText($temporary, ($settings | ConvertTo-Json -Depth 3), (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination $settingsFile -Force
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }; if ($settings) {$settings.Clear()}; $lock.Dispose() }
}
$Host.UI.RawUI.WindowTitle = 'VoltGuard - Gizli API anahtari girisi'
Write-Host 'VoltGuard yerel onizleme anahtarlari' -ForegroundColor Cyan
Write-Host 'Degerler ekranda veya sohbet kaydinda gosterilmez. Yalniz bu bilgisayara kaydedilir.'
Write-Host 'Canli sunucuya aktarim yapilmaz. Bos giris mevcut degeri korur. Cikis: 0.'
while ($true) {
    for ($i=0; $i -lt $providers.Count; $i++) { Write-Host (($i+1).ToString()+'. '+$providers[$i].Label) }
    $selection = Read-Host 'Servis numarasi (0 = bitir)'
    if ($selection -eq '0') { break }
    $number = 0
    if (![int]::TryParse($selection,[ref]$number) -or $number -lt 1 -or $number -gt $providers.Count) { Write-Host 'Listedeki numarayi secin.'; continue }
    $provider = $providers[$number-1]; Write-Host $provider.Label -ForegroundColor Cyan; Write-Host $provider.Url
    $changes = @{}
    foreach ($key in $provider.Keys) {
        $secure = Read-Host ($key+' (gizli)') -AsSecureString; $pointer = [IntPtr]::Zero
        try {
            $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()
            if ($value) { if ($value.Length -gt 4096 -or $value -match '[\r\n\x00]') { throw 'Anahtar bicimi gecersiz.' }; $changes[$key] = $value }
        } finally { if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }; $value=$null; $secure.Dispose() }
    }
    Save-Settings $changes; $changes.Clear(); Write-Host 'Kaydedildi. Deger yazdirilmadi.' -ForegroundColor Green
}
Write-Host 'Tamamlandi. Bu pencereyi kapatabilirsiniz.'
