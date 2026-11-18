# Oprávnění techniků

Mobilní webová appka (PWA) pro evidenci a hlídání profesních oprávnění techniků HVAC firmy: kdo má jaké oprávnění, do kdy platí, co propadá a co je už objednané. Data jsou v Supabase (sdílený projekt „servisní záznamy“, schéma `opravneni`), upozornění posílá GitHub Actions z pracovní schránky, doklady umí vyčíst AI (Claude Haiku 5.5).

**Adresa:** https://vm73-prace.github.io/opravneni/ (GitHub Pages z větve `main`, kořen repa). Ukázka bez přihlášení: https://vm73-prace.github.io/opravneni/?demo=1

**Bezpečnost:** Supabase URL a publishable klíč jsou ve frontendu (`app.js`) veřejné z principu – data chrání RLS (řádková oprávnění) a funkce s ověřením přihlášení / tokenu. Tajné hodnoty (token, SMTP, klíč AI) jsou jen v GitHub Secrets a Supabase Secrets. Repo je veřejné – názvy serverů, e-maily ani interní podklady do něj nepatří (viz `CLAUDE.md`).

## Co appka umí

- **Přehled** techniků se semaforem (platné / v předstihu / propadlé / objednané / doba neurčitá), odznak „K vyřízení“, filtr kategorií (`?kat=ppk|vyrobci|fplyny|elektro`), hledání bez diakritiky.
- **Detail technika a záznamu:** oprávnění seskupená podle kategorií, platnost, stav **Objednáno** s termínem školení, aktuální doklad a historie dokladů.
- **Doklady:** fotka z mobilu (zmenší se na 2000 px JPEG) nebo PDF do 10 MB, soukromý bucket, zobrazení přes podepsané odkazy (1 h).
- **✨ Vyčíst AI** (jen správce): z dokladu navrhne technika, druh, číslo, vydavatele, data a platnost; porovnání po políčkách a „Převzít“. Limit 30 vyčtení denně.
- **E-mailová upozornění** 1× denně: při vstupu do předstihu / propadnutí a týdenní souhrn; správcům souhrn, technikům jejich položky.
- **Role:** správce (vše) a technik (jen čte svoje oprávnění a doklady). **Nastavení:** technici, katalog kategorií a druhů (lhůty), předstih, výrobci, příjemci souhrnu, testovací e-mail.
- Diagnostika: `?debug=1` – panel s logem a chybami JS. `?demo=1` – ukázková data v paměti (smyšlení technici), nic se neukládá.

## Kdo je správce

Zatím jediný uživatel = správce (Vladan). Správce je v tabulce `opravneni.uzivatele` s rolí `spravce`; účet musí existovat v Supabase Auth a mít `opravneni` v `public.profily.aplikace`.

### Jak přidat technika (nebo dalšího správce)

1. V appce Nastavení → Technici → **Přidat technika** (jméno, e-mail pro upozornění). Tím technik existuje v evidenci – účet k přihlášení zatím nepotřebuje.
2. Má-li se technik přihlašovat: Supabase → Authentication → Users → **Add user** (e-mail + heslo, „Auto confirm“), heslo mu předat bezpečně.
3. V SQL Editoru propojit účet s technikem (vzor je v hlavičce `tests/sql.test.mjs` a v lokálním `sql/lokalni/001b_pristup.sql`, který není v gitu):
   ```sql
   update public.profily set aplikace = array_append(aplikace, 'opravneni') where id = '<uuid účtu>' and not 'opravneni' = any(aplikace);
   insert into opravneni.uzivatele (user_id, role, technik_id) values ('<uuid účtu>', 'technik', '<id technika>');  -- správce: role 'spravce', technik_id null
   ```
   Řádek účtu v `public.profily` musí mít `aktivni = true` (jinak appka hlásí „bez přístupu“).
4. Technik se přihlásí na adrese appky; v Nastavení u technika se ukáže „Propojený účet: ano“.

## Nasazení

- **Frontend:** statické soubory v kořeni repa (`index.html`, `app.js`, `calc.js`, `demo.js`, `app.css`, `sw.js`, `manifest.json`, ikony). Každý push do `main` se do 1–2 min nasadí přes Pages (Settings → Pages → Deploy from a branch, `main`, `/ (root)`).
- **Nová verze:** zvýšit `VERZE` v `app.js` a zároveň `CACHE = 'opravneni-vN'` v `sw.js` (service worker bere síť první, cache jen offline). Verze je vidět v patičce a v Nastavení → Účet.
- **Kontrola po nasazení:** `node tests/smoke-ostry.mjs` (HTTP 200, přihlašovací obrazovka, service worker, manifest a ikony, „verze N“, konzole bez chyb; nic neukládá).
- **Na iPhonu:** Safari → adresa → Sdílet → **Přidat na plochu**.
- **Ikony:** zdroj `icons/A.svg`, sada `node icons/render.mjs A` → `icon-1024/512/192`, `icon-512-maskable`, `apple-touch-icon`, `favicon-32`.

## Supabase

Sdílený projekt „servisní záznamy“ – **nový projekt nezakládat**, ostatní schémata nechat být. Schéma `opravneni` musí být v Settings → API → **Exposed schemas**.

| Migrace | Obsah | Rollback |
| --- | --- | --- |
| `sql/000_pruzkum.sql` | jen čtení – průzkum před migrací | – |
| `sql/001_init.sql` | tabulky `kategorie, druhy, technici, opravneni, doklady, nastaveni, tajne, uzivatele, upozorneni_log`, RLS, funkce `smi / je_spravce / muj_technik / nastaveni_vypocet`, bucket `opravneni-doklady` + politiky, seed katalogu | `001_rollback.sql` |
| `sql/002_upozorneni.sql` | `over_token`, `upozorneni_data(token)`, `zapis_upozorneni(token, …)` – jen pro `anon` s tokenem | `002_rollback.sql` |
| `sql/003_ai_log.sql` | `ai_log`, `ai_zacni` / `ai_dokonci` (denní limit 30) | `003_rollback.sql` |

- Migrace se spouštějí v jedné transakci (SQL Editor nebo konektor), pak `notify pgrst, 'reload schema'`. **Pozor:** opětovné spuštění 002 odebere práva všem funkcím schématu → pak znovu 003.
- **Edge Function `opravneni-vycteni`** (`supabase/functions/opravneni-vycteni/`, `verify_jwt: false` – přihlášení správce ověřuje sama): secret **`OPRAVNENI_ANTHROPIC_API_KEY`** (Supabase → Edge Functions → Secrets). CORS povoluje jen `https://vm73-prace.github.io` a `http://localhost:8124` – při vlastní doméně doplnit původ v `POVOLENE_PUVODY` (`vycteni.js`) a funkci znovu nasadit. Model = konstanta `MODEL`.
- **Přihlášení:** jen e-mail + heslo (žádné odkazy z e-mailu), takže Auth → URL Configuration se pro tuto appku nemění.

### Zálohy

- **Data:** Supabase Free nemá automatické zálohy ke stažení. Ruční záloha schématu: `pg_dump --schema=opravneni --data-only` (connection string ze Settings → Database), nebo v SQL Editoru export tabulek do CSV. Doporučeno 1× měsíčně a před každou migrací.
- **Doklady:** Storage → bucket `opravneni-doklady` → stáhnout složky (`<technik_id>/…`).
- **Kód:** toto repo; schéma a katalog lze obnovit z migrací (001 → 002 → 003), přístup účtů viz „Jak přidat technika“.

## E-mailová upozornění

Workflow `.github/workflows/upozorneni.yml` běží 1× denně (cron `17 5 * * *` = 6:17 v zimě / 7:17 v létě) a spouští `scripts/upozorneni.py`:

- data čte přes `opravneni.upozorneni_data(token)` s publishable klíčem a tokenem (žádný service_role; v DB je jen SHA-256 tokenu v tabulce `opravneni.tajne`, z API nečitelné),
- první e-mail při vstupu do předstihu / propadnutí, pak každé pondělí týdenní souhrn do vyřízení (nový doklad nebo stav Objednáno),
- správci (Nastavení → Příjemci souhrnu) dostanou souhrn za všechny, technik s e-mailem jen svoje položky,
- každé odeslání (i chyba) se zapíše do `opravneni.upozorneni_log` přes `opravneni.zapis_upozorneni(token, …)`,
- výpis v logu Actions (veřejný) neobsahuje jména, e-maily ani názvy serverů.

**Testovací e-mail:** v appce Nastavení → *Poslat testovací e-mail* otevře stránku workflow na GitHubu → *Run workflow* → režim `test`. [TEST] e-mail dostanou jen správci (příjemci souhrnu), nikdy technici. Výsledek se ukáže v Nastavení (*Obnovit výsledek*). Režim `nahled` jen vypíše počty, nic neposílá; `smtp-sonda` ověří server bez přihlášení.

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

Záložka *Variables*: `OPRAVNENI_APP_URL` = `https://vm73-prace.github.io/opravneni/` (odkaz na appku v patičce e-mailu).

Supabase Secrets (Edge Functions): `OPRAVNENI_ANTHROPIC_API_KEY`.

**Výměna tokenu:** vygenerovat nový token, přepsat secret `OPRAVNENI_NOTIFY_TOKEN` a SHA-256 zapsat do `opravneni.tajne` (`update opravneni.tajne set token_hash = '<hash>'`). Starý token tím přestane platit. Ověřit Run workflow → `nahled`.

**Výměna SMTP:** přepsat secrets `OPRAVNENI_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD` a `_FROM`. Ověření bez přihlášení: Run workflow → `smtp-sonda`. Skript se nikdy nepřihlásí bez úspěšného STARTTLS a ověřuje certifikát i jméno serveru.

### Keepalive plánovaných běhů

GitHub ve **veřejném** repu automaticky vypíná plánovaná workflow po 60 dnech bez aktivity. Proto `.github/workflows/keepalive.yml` 1. den v měsíci (cron `41 4 1 * *`) zavolá API *enable workflow* pro `upozorneni.yml` i pro sebe – jen s `GITHUB_TOKEN` (`permissions: actions: write`), bez osobního tokenu a bez prázdných commitů.

Kontrola: GitHub → Actions → u workflow *Upozornění na oprávnění* nesmí být „This scheduled workflow is disabled“. Když už vypnuté je: *Enable workflow*.

## Vývoj a testy

```
npm ci && npx playwright install chromium            # jednou na novém PC (Playwright používá nainstalovaný Chrome)
python -m pip install --user -r requirements.txt     # tzdata pro skript upozornění
npm run serve -- 8124                                # lokální server http://localhost:8124 (povolený i v CORS funkce)
npm test          # Node (výpočty, SQL migrace na PGlite, Edge Function) + Playwright (6 zařízení) + Playwright s ?debug=1
python -m unittest discover -s tests -p "test_*.py"   # skript upozornění
node tests/smoke-ostry.mjs                            # kontrola nasazené appky
```

Stav vývoje, rozhodnutí a pravidla pro Claude Code: `CLAUDE.md`. Zadání: `ZADANI.md`.
