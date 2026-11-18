# Oprávnění techniků

Mobilní webová appka (PWA) pro evidenci a hlídání profesních oprávnění techniků HVAC firmy: kdo má jaké oprávnění, do kdy platí, co propadá a co je už objednané. Data jsou v Supabase (sdílený projekt „servisní záznamy“, schéma `opravneni`), upozornění posílá GitHub Actions z pracovní schránky.

**Bezpečnost:** Supabase URL a publishable klíč jsou ve frontendu (`app.js`) veřejné z principu – data chrání RLS (řádková oprávnění) a funkce s ověřením přihlášení / tokenu. Tajné hodnoty (token, SMTP, klíč AI) jsou jen v GitHub Secrets a Supabase Secrets.

Plný návod k nasazení a zálohám doplní etapa 6. Stav vývoje a rozhodnutí: `CLAUDE.md`.

## Ukázka a diagnostika

- `?demo=1` – ukázková data v paměti (6 fiktivních techniků), nic se neukládá.
- `?debug=1` – panel s logem a chybami JS (sbalitelný, stránka se odsadí, aby panel nic nepřekrýval).
- `?kat=ppk|vyrobci|fplyny|elektro` – filtr kategorie (kódy z katalogu).

## E-mailová upozornění

Workflow `.github/workflows/upozorneni.yml` běží 1× denně (cron `17 5 * * *` = 6:17 v zimě / 7:17 v létě) a spouští `scripts/upozorneni.py`:

- data čte přes `opravneni.upozorneni_data(token)` s publishable klíčem a tokenem (žádný service_role; v DB je jen SHA-256 tokenu v tabulce `opravneni.tajne`, z API nečitelné),
- první e-mail při vstupu do předstihu / propadnutí, pak každé pondělí týdenní souhrn do vyřízení (nový doklad nebo stav Objednáno),
- správci (Nastavení → Příjemci souhrnu) dostanou souhrn za všechny, technik s e-mailem jen svoje položky,
- každé odeslání (i chyba) se zapíše do `opravneni.upozorneni_log` přes `opravneni.zapis_upozorneni(token, …)`.

**Testovací e-mail:** v appce Nastavení → *Poslat testovací e-mail* otevře stránku workflow na GitHubu → *Run workflow* → režim `test`. [TEST] e-mail dostanou jen správci (příjemci souhrnu), nikdy technici. Výsledek (čas, příjemce, ok/chyba) se pak ukáže v Nastavení (*Obnovit výsledek*). Režim `nahled` jen vypíše počty do logu, nic neposílá.

### Secrets (GitHub → repo → Settings → Secrets and variables → Actions)

Jen názvy – hodnoty zadává správce, nikdy nepatří do repa:

| Secret | Obsah |
| --- | --- |
| `OPRAVNENI_SUPABASE_URL` | adresa Supabase projektu |
| `OPRAVNENI_SUPABASE_PUBLISHABLE_KEY` | publishable klíč projektu |
| `OPRAVNENI_NOTIFY_TOKEN` | náhodný token skriptu (jeho SHA-256 je v `opravneni.tajne.token_hash`) |
| `OPRAVNENI_SMTP_HOST` | SMTP server pracovní schránky |
| `OPRAVNENI_SMTP_PORT` | 587 (STARTTLS) nebo 465 (SSL) |
| `OPRAVNENI_SMTP_USER` | přihlašovací jméno pracovní schránky (u Exchange jméno bez domény) |
| `OPRAVNENI_SMTP_FROM` | adresa odesílatele = e-mail pracovní schránky; když chybí, použije se `OPRAVNENI_SMTP_USER` (jen pokud je to e-mail) |
| `OPRAVNENI_SMTP_PASSWORD` | heslo / heslo aplikace pracovní schránky |

Volitelně na záložce *Variables*: `OPRAVNENI_APP_URL` (odkaz na appku v patičce e-mailu).

**Výměna tokenu:** vygenerovat nový token, přepsat secret `OPRAVNENI_NOTIFY_TOKEN` a SHA-256 zapsat do `opravneni.tajne` (`update opravneni.tajne set token_hash = '<hash>'` v SQL Editoru nebo přes konektor). Starý token tím přestane platit.

**Výměna SMTP (např. za firemní účet):** přepsat secrets `OPRAVNENI_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD` a `_FROM`. Ověření bez přihlášení: Run workflow → režim `smtp-sonda`. Skript se nikdy nepřihlásí bez úspěšného STARTTLS a ověřuje certifikát i jméno serveru.

### Keepalive plánovaných běhů

GitHub ve **veřejném** repu automaticky vypíná plánovaná workflow po 60 dnech bez aktivity v repu (žádný push apod.). Upozornění by pak potichu přestala chodit. Proto `.github/workflows/keepalive.yml` 1. den v měsíci (cron `41 4 1 * *`) zavolá API *enable workflow* pro `upozorneni.yml` i pro sebe – jen s `GITHUB_TOKEN` (`permissions: actions: write`), bez osobního tokenu a bez prázdných commitů. Ručně jde spustit přes *Run workflow*.

Kontrola: GitHub → Actions → u workflow *Upozornění na oprávnění* nesmí být „This scheduled workflow is disabled“. Když už vypnuté je: tlačítko *Enable workflow*.

## Testy

```
npm test          # Node (výpočty, SQL migrace na PGlite) + Playwright (6 zařízení) + Playwright s ?debug=1
python -m unittest discover -s tests -p "test_*.py"   # skript upozornění (pip install -r requirements.txt)
```
