# Ověření přístupu appky ke schématu opravneni přes API (publishable klíč + přihlášení).
# Spuštění: Set-Location C:\Projekty\opravneni; powershell -ExecutionPolicy Bypass -File scripts\overeni-api.ps1
# E-mail a heslo zadáš při spuštění; heslo ani token se nikam neukládají a nevypisují.
# Soubor je UTF-8 s BOM, aby Windows PowerShell 5 správně zobrazil češtinu.
$ErrorActionPreference = 'Stop'
$url = 'https://pqehuuamgecmdmrdhmza.supabase.co'
$key = 'sb_publishable_6SgwttYu1LHUrAeInwv1Qw_chrfScN7'  # veřejný klíč, data chrání RLS

# Zkrácení jen pro výpis; odpověď s tokenem se nevypíše vůbec
function ProVypis($text) {
  if ($text -match '"(access_token|refresh_token)"') { return '(tělo skryto – obsahuje token)' }
  if ($text.Length -gt 300) { return $text.Substring(0, 300) + '…' }
  return $text
}

# Vrací CELÉ tělo odpovědi (k parsování); vypisuje jen zkrácenou verzi. -SkrytTelo = nevypisovat tělo vůbec.
function Volej($popis, $metoda, $cesta, $hlavicky, $telo, [switch]$SkrytTelo) {
  try {
    $p = @{ Method = $metoda; Uri = "$url$cesta"; Headers = $hlavicky; ContentType = 'application/json; charset=utf-8' }
    if ($null -ne $telo) { $p.Body = [System.Text.Encoding]::UTF8.GetBytes(($telo | ConvertTo-Json -Compress)) }
    $r = Invoke-WebRequest @p -UseBasicParsing
    $obsah = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
    $vypis = if ($SkrytTelo) { '(tělo skryto)' } else { ProVypis $obsah }
    Write-Host ("OK    {0,-37} {1}  {2}" -f $popis, $r.StatusCode, $vypis)
    return $obsah
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { '-' }
    # PowerShell 5 má tělo chybové odpovědi v ErrorDetails (proud odpovědi už je přečtený)
    $chyba = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    Write-Host ("CHYBA {0,-37} {1}  {2}" -f $popis, $status, (ProVypis $chyba))
    return $null
  }
}

$email = Read-Host 'E-mail účtu'
$heslo = Read-Host 'Heslo' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($heslo)
try {
  $hesloText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $login = Volej 'přihlášení' 'POST' '/auth/v1/token?grant_type=password' @{ apikey = $key } @{ email = $email; password = $hesloText } -SkrytTelo
} finally {
  $hesloText = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if (-not $login) { Write-Host 'Přihlášení selhalo – konec.'; exit 1 }
try { $token = ($login | ConvertFrom-Json).access_token } catch { Write-Host ('Odpověď přihlášení nejde přečíst: ' + $_.Exception.Message); exit 1 }
if (-not $token) { Write-Host 'Odpověď přihlášení neobsahuje token – konec.'; exit 1 }
$h = @{ apikey = $key; Authorization = "Bearer $token"; 'Accept-Profile' = 'opravneni'; 'Content-Profile' = 'opravneni' }

Write-Host "`n--- Očekávání: smi true, je_spravce true, nastaveni_vypocet 90, kategorie 4, druhy 13, uzivatele spravce, tajne CHYBA 401/403 ---"
Volej 'rpc smi' 'POST' '/rest/v1/rpc/smi' $h @{} | Out-Null
Volej 'rpc je_spravce' 'POST' '/rest/v1/rpc/je_spravce' $h @{} | Out-Null
Volej 'rpc nastaveni_vypocet' 'POST' '/rest/v1/rpc/nastaveni_vypocet' $h @{} | Out-Null
$kat = Volej 'kategorie' 'GET' '/rest/v1/kategorie?select=id,nazev&order=poradi' $h $null
if ($kat) { Write-Host ('      kategorií: ' + (ConvertFrom-Json $kat).Count) }
$druhy = Volej 'druhy' 'GET' '/rest/v1/druhy?select=nazev' $h $null
if ($druhy) { Write-Host ('      druhů: ' + (ConvertFrom-Json $druhy).Count) }
Volej 'uzivatele (můj řádek)' 'GET' '/rest/v1/uzivatele?select=role,technik_id' $h $null | Out-Null
Volej 'tajne (musí být CHYBA)' 'GET' '/rest/v1/tajne?select=*' $h $null | Out-Null
$token = $null
