# CLAUDE.md – Evidence oprávnění techniků (opravneni)

Zadání: `ZADANI.md` (16. 11. 2026). Vzor: `C:\Projekty\kalibrace` (jen číst, nic neměnit).

## Repo je VEŘEJNÉ – pravidlo (od 2026-11-18)

Do žádného souboru ani commitu (ani zprávy commitu, issue, výpisu v logu Actions) **nepsat** názvy serverů a domén mimo github.io / supabase.co / jsdelivr, e-maily, jména osob (kromě vlastníka projektu Vladana, který je i autorem commitů), interní náklady (Kč, tokeny, čas), hashe ani jejich části, ID sezení a běhů, údaje o ostatních appkách ve sdíleném Supabase a o zaměstnavateli. To patří do soukromého repa **`vm73-prace/opravneni-interni`**. Tajné hodnoty jen v GitHub Secrets / Supabase Secrets. Ukázková data jen smyšlená (`example.cz`, `firma.cz`).

## Interní podklady

Soukromé repo `vm73-prace/opravneni-interni` naklonované vedle: `C:\Projekty\opravneni-interni` (na novém PC naklonovat obě). Obsah: `NAKLADY.md` (čas a náklady po etapách), `INTERNI.md` (SMTP server a ladění, certifikát, okraje hashů tokenu, poznámky k PC, ostatní appky ve sdíleném Supabase, ID sezení a běhů, výsledky ostrých testů AI), `opravneni-historie.bundle` (plná historie do 18. 11. 2026; veřejné repo má od 18. 11. zkrácenou historii).

**Po zkrácení historie na domácím PC:** nejdřív ověřit, že tam není nic nepushnutého (`git status` a `git log origin/main..HEAD` před fetch – musí být prázdné), pak `git fetch origin && git reset --hard origin/main`; vedle naklonovat `opravneni-interni`.

## Rozhodnutí z úvodních otázek (2026-11-16)

1. **GitHub:** pracovní organizace `vm73-prace`, repo `opravneni`.
2. **SMTP:** stejně jako kalibrace – skript v GitHub Actions, secrets `OPRAVNENI_SMTP_HOST`, `OPRAVNENI_SMTP_PORT`, `OPRAVNENI_SMTP_USER`, `OPRAVNENI_SMTP_PASSWORD`, `OPRAVNENI_SMTP_FROM` (465 = SSL, jinak STARTTLS s ověřením certifikátu). Hodnoty zadává Vladan (pracovní schránka Exchange, port 587; podrobnosti v `opravneni-interni/INTERNI.md`).
3. **AI vyčtení:** Anthropic **Claude Haiku 5.5** (`claude-haiku-5-5`, $0.10 / $0.50 za 1M tokenů), strukturovaný výstup přes tool use (`strict: true`). Secret `OPRAVNENI_ANTHROPIC_API_KEY` v Supabase Secrets. Přepnutí na Sonnet 5.5 = změna modelu v jedné konstantě.
4. **Lhůty druhů:** v seedu jen orientační, skutečné doplní Vladan v Nastavení.
5. **Filtr kategorií** (2026-11-16, ověřeno proti `ZADANI.md` sekce 7; „skrýt, nebo šedě“ rozhodnuto: **šedě „bez oprávnění“**):
   - Segmentový přepínač Vše + kategorie **z katalogu**, na úzkém displeji (320 px, více kategorií) **vodorovně posuvný**; zvolená kategorie se posune do viditelné části (tabulka `kategorie`: `id` = kód, `nazev`, `poradi`; spravuje se v Nastavení, nic natvrdo v kódu).
   - Je v **Přehledu i v Detailu technika**, jedna společná volba. V Detailu technika zúží seskupené seznamy na zvolenou kategorii (stav v hlavičce technika zůstává celkový).
   - Při zvolené kategorii se semafor, počty i „K vyřízení“ počítají jen z oprávnění té kategorie; odznak počítá vše.
   - Technici bez oprávnění v kategorii **zůstanou v seznamu**: šedé prázdné kolečko, popisek „bez oprávnění“, řazení až za „doba neurčitá“.
   - **Odkaz `?kat=ppk|vyrobci|fplyny|elektro`** (kód z katalogu) má přednost; neznámý kód = Vše. Adresa se při přepnutí aktualizuje (`history.replaceState`), Vše parametr odebere.
   - **Zapamatování** v localStorage (`opr_kat`), čtení i zápis v try/catch se zálohou v paměti.
   - Výpočet v `// <calc>` (`Calc.prehled`), Playwright test pro každou kategorii.
6. **Ikona:** vybraná **A** (odznak se zaškrtnutím), sada vygenerovaná `node icons/render.mjs A`.
7. **Stav Objednáno ukazuje datum termínu školení**: „objednáno · termín 6. 12.“, po termínu „termín 14. 11. proběhl – nahraj nový doklad“ (rok jen u jiného než letošního roku). Datum platnosti v řádcích je „platí do …“.

## Pravidlo: přehled času a nákladů (od 2026-11-17, Vladan)

Na konci **každé etapy** doplnit do **`../opravneni-interni/NAKLADY.md`** (soukromé repo; commit + push tam, ne sem) řádek za etapu (sloupce Code / chat / celkem) a kumulativní součet za projekt a v souhrnu etapy (v chatu) uvést:
- **čistý čas práce** – Claude Code podle časů v záznamu sezení (`~/.claude/projects/C--Projekty-opravneni/<sezení>.jsonl`, mezery mezi zprávami ≤ 15 min) a commitů; chat = hodnota od Vladana,
- **Claude** – tokeny vstup (z toho čtení cache) / výstup (`message.usage`, unikátní `message.id`) a odhad v Kč podle aktuálních cen API; u předplatného jde o ekvivalent,
- **GitHub** – Actions minuty (`gh api repos/vm73-prace/opravneni/actions/runs`),
- **Supabase** – DB MB, Storage MB, volání Edge Functions vůči free tieru (jen čtení přes konektor),
- **AI API** – počet volání a Kč.
Kurz USD→CZK z ČNB (denní lístek) s datem; starší řádky zůstávají v původním kurzu.

## Stav projektu: HOTOVO, PROVOZ (od 2026-11-18)

Appka běží na https://vm73-prace.github.io/opravneni/ (verze 10, funkce `opravneni-vycteni` v5), upozornění chodí z GitHub Actions denně. Etapy 0–6 hotové a ověřené naostro (PC i iPhone z plochy, AI vyčtení PDF i fotky). Další práce = samostatné úkoly, každý v novém sezení (kontext z tohoto souboru), náklady do `../opravneni-interni/NAKLADY.md`.

**Otevřené body:**
1. **Technici – rozhodnutí 19. 11. (Vladan): bez přihlašovacích účtů, přehled má jen správce.** Technici se do appky nepřihlašují; vybraní technici dostávají jen e-mailová upozornění na svá oprávnění (`technici.email`, skript `upozorneni.py` to už umí). Účty v Auth / `opravneni.uzivatele` pro techniky nezakládat; RLS pro roli technik zůstává (neškodí, připraveno pro případ změny). ZADANI §2 („technik čte svou sekci“) tím pro provoz neplatí.
   - Pozor: technik s vyplněným e-mailem dostane při nejbližším denním běhu (6:17) e-mail „vstup“ ke všem svým položkám k řešení (např. Mandík 23. 11.).
   - Známá drobnost: smazání technika s propojeným účtem v `uzivatele` selže (`uzivatele_check` vs. `ON DELETE SET NULL`) – dnes se netýká (žádný technik nemá účet).
2. **Import 11 dokladů ze skenů z 18. 11.** – podklady v souboru `import-skeny` mimo repo (nepřidávat do gitu); nahrát přes appku (Vyčíst AI → kontrola → Uložit).
3. **Kontrola veřejného repa `VM73/kalibrace`** na citlivé údaje (stejný postup jako u opravneni 18. 11.: pracovní strom + celá historie + logy Actions) – samostatný úkol.
4. ~~**AI – pole vydavatel jen název firmy**~~ – **uzavřeno 2026-11-18 (funkce v5):** zpřesněný popis pole `vydavatel` + pojistka nad 80 znaků (`upravVydavatele`), viz Etapa 5.
5. **Katalog druhů:** Vladan zkontroluje lhůty a popisy druhů (AI je používá při výběru druhu).
6. **Flaky timeout w1280 supabase.spec při plném běhu na pomalém PC** (18. 11.: `page.goto` 20 s v testu „správce: přihlášení … odhlášení“ při `npm test`; samostatně 3× po sobě prošel, sada s `?debug=1` 222/222) – zatím neopravováno; pokud se bude opakovat, zvýšit timeout / omezit workers.
7. Později: vlastní doména (původ do `POVOLENE_PUVODY` + nasadit funkci), hlídat platnost certifikátu SMTP serveru (datum v `INTERNI.md`).

## Stav po etapách

| Etapa | Stav |
| --- | --- |
| 0. Otázky, zadání | hotovo (2026-11-16) |
| 1. Prototyp (demo data, obrazovky, výpočet stavů + testy, 3 ikony) | hotovo 2026-11-16 (verze 3), ikona A |
| 2. Supabase (schéma `opravneni`, RLS, bucket, přihlášení, role, CRUD) | hotovo 2026-11-16 (verze 4) |
| 3. Doklady (foto/PDF, zmenšení, historie, podepsané URL) | hotovo 2026-11-16 (verze 6) |
| 4. Upozornění (Actions cron, RPC s tokenem, SMTP, log, testovací e-mail) | hotovo 2026-11-17 (verze 7): testovací e-mail odeslán, záznam `test` / `ok` v `upozorneni_log` |
| 5. AI vyčtení (Edge Function `opravneni-vycteni`) | hotovo 2026-11-18 (verze 8, funkce v4 – výběr druhu podle významu, ověřen na skutečném dokladu; v5 vydavatel jen název firmy); fotka z iPhonu ověřena 18. 11. po nasazení |
| 6. Nasazení (veřejné repo + Pages, ikony, README) | **hotovo 2026-11-18** – https://vm73-prace.github.io/opravneni/ (smoke test, CORS, upozornění, test na PC a iPhonu s fotkou dokladu) |

## Oprava odhlášení (2026-11-22, verze 9)

- **Chyba:** `authStorage.removeItem` mazal klíč z paměti (`delete`), `getItem` pak četl starou session z localStorage → při blokovaném mazání zůstal uživatel po odhlášení přihlášený.
- **Oprava má tři vrstvy, žádnou neodebírat:**
  1. smazání = `authPamet[k] = null` (platí jen do obnovení stránky),
  2. co z localStorage nejde smazat, přepíše se odloženě prázdnou hodnotou (pokryje i výpadek serveru při odhlášení),
  3. `start()` při nalezené session volá `getUser()`: zrušené sezení (`session_not_found`) supabase-js odstraní, výpadek sítě nebo 5xx nikoho neodhlásí. Pokryje i blokované mazání i zápis zároveň; stojí 1 dotaz do Auth na načtení stránky.
- **Přihlášení:** po `signInWithPassword` se ověří `getSession()`; bez session „session se neuložila“ do debug panelu a česká hláška, žádný dotaz jako anon.
- ~~**Důsledek:** `signOut` ruší všechna sezení účtu~~ – od verze 10 neplatí (odhlášení jen tohoto zařízení), meze viz verze 10.
- **Mock:** anon 401 / 42501 se zněním jako produkce (`permission denied for function …` / `table …`; schéma má od migrace 002 pro anon USAGE), odhlášení ruší sezení (`/user` pak 403 `session_not_found`, REST JWT dál bere).
- **Nasazeno a ověřeno 22. 11.:** Pages = commit, `opravneni-v9`, smoke test 28/28, odhlášení na nasazeném kódu s napodobeným Supabase (bez blokování, blokovaný zápis, mazání, obojí). Testy: Node 62, Playwright 288 + 288 s `?debug=1`, Python 36. **Ruční zkouška skutečným účtem na PC s blokujícím antivirem (přihlásit → odhlásit → obnovit stránku): prošla 22. 11. (Vladan).**

## Odhlášení jen tohoto zařízení a vždy úspěšné (2026-11-22, verze 10)

Převzato z druhé pracovní appky v organizaci (stejné řešení), doplněno Odhlásit na obrazovce výpadku a ochrana proti opožděným odpovědím. Vše v `app.js` u `authStorage`; **nic neodebírat** (každá část má svůj test v `tests/odhlaseni.spec.mjs`).
1. **Odhlásit = `signOut({ scope: 'local' })`** – ostatní zařízení zůstanou přihlášená (ověřeno i obnovou tokenu na druhém zařízení).
2. **Limit 5 s** (`ODHLASENI_LIMIT_MS`): supabase-js při výpadku obnovuje vypršený token až 30 s a bez odpovědi serveru čeká bez konce. Při chybě nebo po limitu appka smaže session sama (`authStorage.removeItem` = paměť `null` + localStorage, co nejde smazat, přepíše `''`), ukáže přihlášení a zaloguje „odhlášení offline – session smazána jen lokálně (důvod)“. Bez načtené knihovny totéž hned.
3. **Nové přihlášení čeká** na nedokončený `signOut` (`odhlasovani`) i na ověření sezení ze startu (`overovani`), hláška „Dokončuji předchozí odhlášení…“. Jinak by opožděný `signOut` nebo opožděné `session_not_found` nové přihlášení smazaly.
4. **Událost `storage`:** smazání / vyprázdnění `opravneni-auth` v jiné záložce odhlásí i tuto (paměť `null`). K tomu dvě pojistky v `authStorage`: odložený zápis se neprovede, když se mezitím hodnota v paměti změnila (odhlášení), a `removeItem` nic nedělá, když už je v paměti `null` (opožděné odhlášení jedné záložky tak nesmaže nové přihlášení z druhé).
5. **Start:** `getUser()` s `bad_jwt` / `user_not_found` / `user_banned` → session zahozena jen lokálně (žádný požadavek na server); `session_not_found` zahodí supabase-js. Když `getSession` vrátí chybu a session v úložišti zůstala (vypršený token + výpadek, i 500), nebo selže načtení dat či knihovny, nebo start do **35 s** (`START_LIMIT_MS`) neskončí, ukáže se hláška se **Zkusit znovu** a **Odhlásit** (jen když je v úložišti session). Hláška vydrží i změnu adresy (`startStav` v `render`); opožděná odpověď ji nahradí appkou.
6. **Relace:** každé odhlášení zvýší `relace`; opožděný start, `nactiData` a přihlášení ze starší relace se zahodí (žádná cizí data ani překreslení po odhlášení).
- **Zbývající meze (ověřené čtením kódu a mockem):**
  - blokované mazání i zápis **a zároveň** nedostupný server → po F5 hláška výpadku se session a po obnově serveru zase přihlášený (odhlášení není kam zapsat ani předat jiné záložce; Odhlásit na hlášce pomůže jen do F5),
  - F5 nebo zavření appky během „Odhlašuji…“ (nejvýš 5 s) → zůstane přihlášený,
  - opožděné odhlášení jedné záložky (server odpoví po limitu) pošle ostatním záložkám SIGNED_OUT: ukážou přihlášení, ale session nesmažou, po F5 jsou přihlášené,
  - 429 při obnově vypršeného tokenu: supabase-js session smaže sám (nejde o výpadek) → přihlašovací formulář,
  - start delší než 35 s i bez výpadku (velmi pomalá síť) → dočasně hláška výpadku, po načtení appka,
  - úplně bez internetu po F5 → hláška o nenačtené knihovně (shell z cache service workeru); Odhlásit tam smaže session lokálně, přihlásit jde až po obnovení stránky online.
- **Důsledky:** odhlášení offline nechá sezení na serveru platné (v zařízení už není). Odhlásit neslouží k odhlášení ztraceného zařízení – to jde jen na straně Supabase (Auth → uživatel → zrušit sezení). Odhlášení s výchozím (globálním) rozsahem téhož účtu jinde dál ruší i sezení této appky.
- **Mock:** sezení podle `session_id` (`store.sezeni`), `logout` respektuje `scope` (bez parametru = global, záznam v `store.rozsahy`), obnova tokenu přes `refresh_token` sezení, poruchy `store.selhani[token|logout|user|rest]` = HTTP status, `'sit'` nebo Promise (odpověď až po splnění), `store.neplatna` = kód odmítnutí JWT. Stejný store ve dvou kontextech = dvě zařízení.
- **Testy:** `tests/odhlaseni.spec.mjs` (36 testů × 6 profilů, paralelně, bez pevného „dnes“ – opakování obnovy měří skutečný čas): (a) dvě zařízení, (b) vypršený token + 503 / síť / 429 / bez odpovědi, dvě záložky (i s blokovaným mazáním), (c) totéž s blokovaným mazáním (tiše i výjimkou), (d) bad_jwt / user_not_found / user_banned (i s blokovaným mazáním), (e) obrazovka výpadku (500, síť, bez odpovědi s `page.clock`, výpadek dat, nenačtená knihovna), opožděné odpovědi a přihlášení. **Proti v9 selhalo všech 36** (profil w390), proti opravě prošlo. Celá sada: Node 62, Playwright 504 + 504 s `?debug=1`, Python 36.
- **Nasazeno a ověřeno 22. 11.:** Pages build = commit, `app.js` a `sw.js` shodné s commitem, `var VERZE = 10`, cache `opravneni-v10`, smoke test 28/28 (Chrome + emulace iPhone 13, bez přihlášení).
- **Neověřeno (dělá Vladan):** skutečný účet – přihlásit PC i iPhone → na PC Odhlásit → iPhone po znovuotevření zůstává přihlášený, PC po F5 ne; totéž na PC s blokujícím antivirem; WebKit na iPhonu.

## Etapa 1 – prototyp (2026-11-16, verze 3)

- `?demo=1` = data v paměti z `demo.js` (relativně k dnešku, smyšlená jména). Bez parametru přihlášení (etapa 2).
- Role v ukázce: `?demo=1&jako=<id technika>` = pohled technika (jen vlastní sekce, nic needituje). Přepínač v Nastavení → Účet.
- Obrazovky: Přehled (`#/`: odznak, K vyřízení, filtr kategorií, hledání bez diakritiky), Detail technika (`#/t/<id>`), Detail záznamu (`#/o/<id>`: Objednáno na termín…, doklad, historie), Formulář (`#/o/<id>/upravit`, `#/t/<id>/nove`), Nastavení (`#/nastaveni`, technici `#/nastaveni/t/<id|novy>`, druhy `#/nastaveni/d/<id|novy>`, kategorie `#/nastaveni/k/<kód|nova>` – kód se po založení nemění).
- Kategorie i druhy jsou v katalogu (`S.kategorie`, `S.druhy`), v appce `kategorie()` → `[kód, název]`. Výrobci pro „Pokrytí výrobci“ = text v nastavení (čárkami).
- Fotka se zmenší na 2000 px JPEG 0,8, PDF limit 10 MB. Nový doklad = předchozí do historie.
- Ikony: zdroj `icons/A.svg` (vybraná), návrhy B/C ponechány, náhled `icons/nahled.png`. Sada v kořeni: `icon-1024/512/192`, `icon-512-maskable`, `apple-touch-icon`, `favicon-32`.
- Testy: Node `tests/calc.test.mjs` (případy v `tests/cases.json`) + Playwright `tests/e2e.spec.mjs` (iPhone 13, Pixel 7, 320, 390, 768, 1280; data-driven pro každou kategorii). Port testovacího serveru 8124 (kalibrace má 8123). E2E mají pevné „dnes“ 16. 11. 2026 (`page.clock.setFixedTime`).
- Screenshoty: `node tests/nahledy.mjs` (server `npm run serve -- 8124`) → `nahledy/` (v .gitignore).

## Etapa 2 – Supabase (2026-11-16, verze 4)

- **Git:** https://github.com/vm73-prace/opravneni, větev `main`.
- **Průzkum** `sql/000_pruzkum.sql` (jen čtení, přes konektor): schéma `opravneni` neexistovalo; sdílená tabulka účtů `public.profily` (id, email, role, aktivni, token_hash, vytvoreno, aplikace) – přístup k appce = slug `opravneni` v `profily.aplikace`. Výsledky průzkumu (ostatní appky) jsou v `opravneni-interni/INTERNI.md`.
- **Datový model (001):** společná firemní data. `kategorie` (id = kód pro ?kat=), `druhy`, `technici`, `opravneni`, `doklady` (historie, nejvýš 1 aktuální, `technik_id` kopie se složeným FK, cesta `<technik_id>/<soubor>`), `nastaveni` (1 řádek, jen správce; technik čte `predstih_dni` a `vyrobci` přes `opravneni.nastaveni_vypocet()`), `tajne` (token_hash, žádná práva pro authenticated/anon, čte jen RPC), `uzivatele` (role spravce/technik + technik_id), `upozorneni_log` (zápis jen přes RPC).
- **Přístup:** `opravneni.smi()`, `je_spravce()`, `muj_technik()` (security definer, `search_path = ''`, jen authenticated). Správce vše; technik jen čte katalog, svůj řádek v technici/uzivatele, svoje oprávnění a doklady (i soubory ve své složce). anon nic. Pojistka na konci migrace: žádná funkce pro PUBLIC ani anon.
- **Seed:** 4 kategorie, 13 druhů (orientační lhůty), nastavení 90 dní + výrobci.
- **Přístup účtů mimo repo:** `sql/lokalni/001b_pristup.sql` + `001b_rollback.sql` (v .gitignore). Vladan = správce. Na novém PC soubor chybí – vzor je v hlavičce souboru a v `tests/sql.test.mjs` (smyšlené UUID; test použije skutečný soubor, když existuje). Ukázkoví technici do DB nejdou.
- **Spuštěno přes konektor:** `opravneni_001_init` (obsah `sql/001_init.sql` bez begin/commit – konektor obaluje transakcí sám) a `opravneni_001b_pristup`; pak `notify pgrst, 'reload schema'`. Ověřeno: 9 tabulek s RLS, anon nic, `tajne` nečitelná, 5 funkcí bez PUBLIC/anon, 14 politik ve schématu, storage politiky, bucket soukromý 10 MB, katalog 4 + 13.
- **Exposed schemas** obsahuje `opravneni` (anon dostane 401 `permission denied for schema opravneni`). Ověření s přihlášením: `scripts/overeni-api.ps1` (heslo zadává Vladan, Claude hesla nezadává).
- **Appka:** bez `?demo=1` běží proti Supabase (supabase-js 2.118.0 z jsDelivr, `sb.schema('opravneni')`, vlastní `storage` + `storageKey: 'opravneni-auth'` s kopií v paměti a odloženým zápisem – některé antiviry blokují synchronní zápis localStorage ze skriptu z CDN; smazání a start viz „Oprava odhlášení“). Po přihlášení `rpc smi` → bez přístupu hláška; `je_spravce` / `muj_technik` určí roli; správce navíc `nastaveni` a `uzivatele`, technik `rpc nastaveni_vypocet`. Ukládání `apiSupabase` (stejné metody jako `apiDemo`), chyby DB přeložené (`prelozChybu`).
- **Propojení účtu s technikem** zatím SQL podle vzoru `sql/lokalni/001b_pristup.sql` (účet musí existovat v Auth a mít `opravneni` v `profily.aplikace`); v appce jen „Propojený účet: ano/ne“.
- **Testy ostrého režimu:** `tests/supabase.spec.mjs` + `tests/supabase-mock.mjs` (napodobené Supabase s pravidly jako RLS: správce, technik, účet bez přístupu; kontroluje i Accept/Content-Profile = opravneni).

## Etapa 3 – doklady (2026-11-16, verze 5–6)

- Fotka (fotoaparát `capture=environment` nebo soubor) se zmenší v prohlížeči na delší stranu 2000 px, JPEG 0,8; PDF beze změny, limit 10 MB. Cesta `<technik_id>/<uuid>.jpg|.pdf` v bucketu `opravneni-doklady`.
- Pořadí: uložit oprávnění → upload → dosavadní aktuální doklad `aktualni = false` → insert `doklady`. Když zápis do DB selže: předchozí doklad se vrátí jako aktuální, nahraný soubor se smaže, hláška „údaje oprávnění jsou uložené, doklad ne“. Během ukládání jsou tlačítka zablokovaná.
- Zobrazení: jedna dávka podepsaných URL (`createSignedUrls`, 1 h), po 50 min se obnoví. Historie dokladů = řádky s `aktualni = false`.
- Smazání oprávnění: DB smaže řádky dokladů kaskádou, appka pak smaže soubory ze Storage.
- Technik vidí jen své doklady, nahrávat nemůže. HEIC: když prohlížeč obrázek nepřečte, hláška „Soubor není čitelný obrázek“.
- **Objednáno po nahrání dokladu (verze 6):** zruší se jen když se zároveň posune `platnost_do` (nebo nově doba neurčitá) – `Calc.platnostPosunuta`. Jinak dotaz „Zrušit objednání?“.
- **Debug panel (`?debug=1`):** nepřekrývá obsah – „▾ Sbalit log / ▸ Log (N)“ (`localStorage opr_dbg_sbaleny`), stránka má `padding-bottom` podle výšky panelu, chyba = červený rámeček.
- Testy: mock Storage v `tests/supabase-mock.mjs`; celá Playwright sada běží i s `?debug=1` v každé adrese (`tests/s-debugem.mjs`, `DEBUG_PANEL=1`). Screenshoty ostrého režimu: `node tests/nahledy-ostry.mjs`.

## Etapa 4 – upozornění (hotovo 2026-11-17, verze 7)

- **Testovací e-mail:** tlačítko v Nastavení je odkaz na `https://github.com/vm73-prace/opravneni/actions/workflows/upozorneni.yml` (Run workflow → režim test) + výsledek posledního testu z `upozorneni_log` (Obnovit výsledek). Žádná Edge Function ani GitHub token v appce. **[TEST] e-mail jen správcům, nikdy technikům.**
- **Migrace `sql/002_upozorneni.sql`** (+ rollback): `grant usage on schema opravneni to anon`; `over_token(token)` (SHA-256 vs `tajne.token_hash`, null hash = vše odmítne, chyba 28000); `upozorneni_data(token)` (bez poznámek a dokladů, log 400 dní); `zapis_upozorneni(token, zaznamy jsonb)` (max 200 řádků). Obě jen pro `anon`. Pojistka: anon jen tyto 2 funkce, žádná tabulka. Spuštěno přes konektor (`opravneni_002_upozorneni`) a ověřeno.
- **Skript `scripts/upozorneni.py`** (stdlib + `tzdata`; vždy STARTTLS s ověřením certifikátu i jména, port 465 = SSL): k řešení = v předstihu, propadlé, objednané po termínu; typ `vstup` = poprvé od `updated_at` záznamu; `tydenni` = pondělí; příjemce max 1 e-mail denně; správci (`nastaveni.prijemci`) souhrn, technik s e-mailem jen svoje; chyba u jednoho příjemce → log `chyba`, ostatní se pošlou, exit 1. Režimy `--dry-run`, `--nahled f`, `--test-email`, `--sonda-smtp`.
- **Výpis do logu Actions je veřejný:** bez jmen a e-mailů (jen „spravce #1“), u tokenu jen délka (žádný hash ani jeho části; při chybě 28000 nápověda vygenerovat token znovu), u SMTP jen délky a tvar hodnot (`SMTP nastavení:`), při chybě SMTP jen fáze, typ a kód (celé hlášení serveru jen do `upozorneni_log`), sonda jen verze TLS, „certifikát ověřen“ a metody AUTH (bez vydavatele a platnosti certifikátu). Hodnoty secrets GitHub v logu maskuje.
- **Workflow `.github/workflows/upozorneni.yml`:** cron `17 5 * * *`, Run workflow s volbou `rezim` (test / nahled / ostry / smtp-sonda), testy před během, log jako artefakt při chybě (7 dní). Secrets (jen názvy): `OPRAVNENI_SUPABASE_URL`, `OPRAVNENI_SUPABASE_PUBLISHABLE_KEY`, `OPRAVNENI_NOTIFY_TOKEN`, `OPRAVNENI_SMTP_HOST`, `OPRAVNENI_SMTP_PORT`, `OPRAVNENI_SMTP_USER`, `OPRAVNENI_SMTP_FROM`, `OPRAVNENI_SMTP_PASSWORD`; variable `OPRAVNENI_APP_URL`.
- **Keepalive** `.github/workflows/keepalive.yml` (cron `41 4 1 * *`, `gh api -X PUT …/enable` s `GITHUB_TOKEN`, `permissions: actions: write`) proti vypnutí plánovaných workflow po 60 dnech neaktivity ve veřejném repu; ověřeno ručním během.
- **Výměna tokenu:** nový token → secret `OPRAVNENI_NOTIFY_TOKEN` → SHA-256 do `opravneni.tajne` → Run workflow `nahled`. Exchange: přihlašovací jméno ≠ e-mail → proto `OPRAVNENI_SMTP_FROM`. Průběh ladění v `opravneni-interni/INTERNI.md`.
- **Testy:** `tests/test_upozorneni.py` (Python: případy z `cases.json`, pravidla, celý běh s falešným Supabase a SMTP, bezpečnost SMTP s certifikáty z openssl, výpis bez adres a bez vydavatele certifikátu), SQL testy migrace 002.

## Etapa 5 – AI vyčtení (hotovo 2026-11-18, verze 8, funkce v5)

**Rozhodnutí (2026-11-17, Vladan):**
1. Zdroj dokladu: vybraný soubor ve formuláři (fotka se v appce nejdřív zmenší na 2000 px JPEG), jinak aktuální uložený doklad ze Storage (`opravneni_id`, JWT správce).
2. Log `opravneni.ai_log` (migrace 003): čas, user_id, zdroj, typ souboru, velikost, model, tokeny, cena USD, stav (probiha/ok/chyba), kód chyby, ms – **bez obsahu dokladu a vyčtených údajů**. Správce jen čte; zápis jen přes `ai_zacni` / `ai_dokonci` (security definer, jen authenticated, ověří správce).
3. Pojistka: **30 vyčtení za kalendářní den Europe/Prague** – konstanta `limit_den` v `opravneni.ai_zacni` (zámek `pg_advisory_xact_lock`, počítají se i chybná). Po překročení 429 `denni_limit` + ruční vyplnění.
4. Převzetí: porovnání Formulář ↔ AI po políčkách, rozdíly oranžově, „Převzít“ u pole + „Převzít vše“; „Vyčtení AI zbývá dnes N“.
5. CORS jen `https://vm73-prace.github.io` a `http://localhost:8124` (cizí původ 403; bez Origin projde); prompt: doklad = jen data, pokyny v něm ignorovat, chybějící = null; `na_dobu_neurcitou` odděleně od `platnost_do`; log funkce jen `{id, stav, kod, tokeny_vstup, tokeny_vystup, ms}`.

**Funkce** (`supabase/functions/opravneni-vycteni/`, `verify_jwt: false` – přihlášení ověřuje sama): `index.ts` (`npm:@anthropic-ai/sdk@1.5.0`, `npm:@supabase/supabase-js@2.118.0`, `Deno.serve`) + `vycteni.js` (čistý ES modul, testuje ho i Node). Postup: CORS → Bearer → `rpc je_spravce` → doklad (PDF/JPG/PNG/WebP/GIF, PDF ≤ 10 MB, obrázek ≤ 5 MB) → bez klíče 503 `chybi_klic` → katalog (aktivní technici, druhy s `[kategorie]`, vydavatelem, **popisem** (200 znaků) a **výchozí platností**, výrobci) → `ai_zacni` → Claude Haiku 5.5, `effort: low`, nástroj `navrh_opravneni` (`strict: true`, `tool_choice: auto`), `maxRetries: 1`, timeout 60 s → `ai_dokonci` → `{navrh, pouziti: {pocet, limit, zbyva, tokeny, cena_usd}}`. Chyby přes třídy SDK: kredit (402), `limit_api`, `klic`, `pretizeno`, `sit`, `odmitnuto`, `preruseno`, `bez_vysledku`. Druh vybírá podle významu (paragraf, popis, vydavatel, platnost); při více kandidátech null + kandidáti v poznámce. Poznámka max 500 znaků, ořez na celém slově (`zkrat`).
- Verze: v1 první nasazení, v2 mimo sezení, v3 oprava ořezu poznámky, **v4 výběr druhu podle významu** (nasazeno přes konektor, ověřeno: OPTIONS z Pages i localhost 204, cizí původ 403, POST bez přihlášení 401; skutečný doklad § 7 vyčten správně vč. druhu); **v5 (18. 11.) vydavatel jen název firmy:** popis pole „Jen obchodní název firmy nebo instituce, která doklad vydala (…), bez dalšího textu, adresy a vztahů k jiným firmám.“ + pojistka `upravVydavatele` – nad 80 znaků uřízne za první právní formou (a.s., s.r.o., spol. s r.o., GmbH, …; bez příznaku i, aby „se sídlem“ nebylo SE) a do poznámky připojí „vydavatel zkrácen – zkontroluj“; bez právní formy text zůstane (max 150) bez poznámky. Nasazeno přes konektor (verify_jwt: false), ověřeno: OPTIONS z Pages i localhost 204, cizí původ 403, POST bez přihlášení 401.
- Ověřeno dotazem: `ai_log` s RLS, jen SELECT pro správce; authenticated funkce `ai_dokonci, ai_zacni, je_spravce, muj_technik, nastaveni_vypocet, smi`; anon jen `upozorneni_data, zapis_upozorneni`; nic pro PUBLIC.
- **Pozor:** opětovné spuštění migrace 002 odebere práva všem funkcím schématu (i `ai_*`) → pak znovu 003 (nebo jen její grant).
- **Appka:** „✨ Vyčíst AI“ jen pro správce, „Čtu doklad…“, chyba = červený box `#aiChyba` (`data-kod`) s nabídkou ručního vyplnění; porovnání se při psaní jen aktualizuje (prvky zůstávají). Demo: `demoAiNavrh()` v `demo.js`.
- **Připomínka pro Vladana:** zkontrolovat lhůty a popisy druhů v katalogu – AI je používá při výběru druhu.

**Testy:** `npm test` = Node (calc + SQL vč. 003 + funkce se skutečným SDK proti napodobenému Anthropic API a Supabase) + Playwright (+ znovu s `?debug=1`); Python zvlášť. `npm run test:vycteni` samostatně.

## Etapa 6 – nasazení (hotovo 2026-11-18)

**Rozhodnutí (Vladan, 18. 11.):** repo `vm73-prace/opravneni` **veřejné** + GitHub Pages (větev `main`, kořen), adresa **https://vm73-prace.github.io/opravneni/**; zatím jen správce (Vladan), technici a propojení účtů později samostatně; vlastní doména později (společně pro pracovní appky). Interní podklady přesunuty do soukromého `vm73-prace/opravneni-interni`.

- **Kontrola před zveřejněním (18. 11.):** prošlý pracovní strom i celá historie (e-maily, servery, jména, klíče, hashe, interní náklady, soubory mimo repo). V gitu nebyly tajné klíče ani skutečné e-maily; historie ale obsahovala interní údaje → **historie zkrácena na 1 commit** (záloha bundle v `opravneni-interni`), NAKLADY.md přesunut, CLAUDE.md očištěn, sonda SMTP nevypisuje vydavatele certifikátu, staré běhy Actions smazány.
- **Nasazeno 18. 11.:** Vladan zveřejnil repo a zapnul Pages (`main`, `/ (root)`). Ověřeno: všechny soubory HTTP 200, `sw.js` s cache `opravneni-v8`, manifest `start_url`/`scope` = `/opravneni/`, ikony `image/png`, patička „verze 8“.
- **Smoke test** `node tests/smoke-ostry.mjs [adresa]` (není v `npm test`; iPhone 13 + PC 1280: HTTP 200, přihlašovací formulář, aktivní service worker, cache, manifest a ikony, „verze N · demo“, konzole bez chyb, žádný neúspěšný požadavek) – 28/28 ok.
- **Supabase Auth:** appka používá jen `signInWithPassword` (žádný magic link ani reset hesla e-mailem) → Redirect URLs se neměnily. Site URL je společná pro celý sdílený projekt – neměnit kvůli této appce. Kdyby přibyl reset hesla, doplnit `https://vm73-prace.github.io/opravneni/` do Auth → URL Configuration → Redirect URLs a předat `redirectTo`.
- **CORS funkce:** OPTIONS z `https://vm73-prace.github.io` 204 + ACAO, cizí původ 403, POST bez přihlášení 401.
- **Actions:** variable `OPRAVNENI_APP_URL = https://vm73-prace.github.io/opravneni/` (přes `gh variable set`); po zveřejnění ruční běh `upozorneni.yml` režim `nahled` ok (data 200, k řešení 0) a `keepalive.yml` ok; veřejný log bez e-mailů a názvů serverů.
- **README** = předávací balíček (co appka umí, adresa, správce a přidání technika, nasazení a verze, Supabase migrace, Edge Function, zálohy, secrets jen názvy, keepalive, testy).
- **Test na zařízeních (Vladan, 18. 11.):** iPhone – Safari → Přidat na plochu, přihlášení, Vyčíst AI z **fotky** skutečného oprávnění výrobce: druh, číslo, vydáno, platnost, výrobce i jméno správně, technik null (není v evidenci – správně). `ai_log` #4: JPEG zmenšený v appce, stav ok, ~4,9 s; cena v `../opravneni-interni/NAKLADY.md`. Postřeh: vydavatel občas jako celá věta z dokladu → otevřený bod 4.
- Nový PC: naklonovat `opravneni` i `opravneni-interni`, `npm ci`, `npx playwright install chromium`, `python -m pip install --user -r requirements.txt` (tzdata), git identita jen pro repo (`git config user.name/user.email` podle posledního commitu), GitHub CLI (`gh auth login`).
