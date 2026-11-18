# ZADANI – Evidence oprávnění techniků (opravneni)

16. 11. 2026 · Vladan · megaprompt pro Claude Code (desktop appka → Code → This computer → `C:\Projekty\opravneni`)

## 0. Jak začít (pro Claude Code)

1. `git pull` (pokud repo existuje), přečti `CLAUDE.md` a tento soubor `ZADANI.md`.
2. Řiď se pravidly skillu **vyvoj-appky-zaklad** (principy, diagnostika, testy, ikony, Supabase ve sdíleném projektu, předávka mezi PC). Vzory a známé pasti pro Supabase, Edge Function a AI převezmi ze skillu hlasova-terenni-appka-supabase (výběr v sekci 9a).
3. **Vzor:** appka Kalibrace (`C:\Projekty\kalibrace`, repo VM73/kalibrace) – stejný princip semaforu, upozornění a uložených protokolů. Převezmi co nejvíc hotového kódu a vzorů, nic tam neměň.
4. **Začni otázkami** – jedno kolo, max 4, jen k bodům v sekci 13 „Otevřené body“ (vše ostatní je rozhodnuto). Pak napiš blok „Zadání:“ (2–4 řádky vč. kritéria hotovo) a stav po etapách (sekce 11).
5. Akce navenek (založení repa/organizace, push, migrace ve sdíleném Supabase, secrets) vždy potvrzuje Vladan.

## 1. Cíl a kritérium hotovo

**Cíl:** mobilní webová appka (PWA) pro přehled a hlídání profesních oprávnění techniků HVAC firmy: kdo má jaké oprávnění, do kdy platí, co propadá a co je už objednané. Včasné upozornění tak, aby šlo s rezervou objednat školení / zkoušku v rezervačním systému vydavatele.

**Hotovo (1. verze):**

- **6 techniků** s realistickými ukázkovými doklady ze všech kategorií (platné, v předstihu, propadlé, objednané, doba neurčitá).
- Testovací upozornění **dorazí e-mailem** (správci souhrn, technikovi jen jeho položky).
- **Foto dokladu z iPhonu** (fotoaparát přímo z appky) i nahrání PDF funguje, náhled se zobrazí.
- Playwright testy projdou na **iPhone 13** a šířce **320 px** (plus Pixel 7, 768, 1280).

## 2. Uživatelé a role

- **Správce** (Vladan, případně kancelář): spravuje techniky, katalog oprávnění, doklady, nastavení upozornění.
- **Technik**: vlastní účet, **jen čte svou sekci** (svá oprávnění, stavy, doklady). Nic needituje.
- Přihlášení přes sdílený Supabase Auth (e-mail + heslo / magic link – stejně jako ostatní pracovní appky). Přístup řídí `profily.aplikace` obsahující `opravneni` + tabulka rolí ve schématu `opravneni`.
- Technik v evidenci nemusí mít účet (správce ho eviduje i bez přihlášení); účet lze propojit později.

## 3. Katalog druhů oprávnění (upravitelný)

Druhy oprávnění **nejsou natvrdo v kódu** – jsou v tabulce katalogu, správce je přidává/upravuje v Nastavení. Pole: název, kategorie, vydavatel, popis rozsahu, výchozí lhůta platnosti v měsících **nebo** „doba neurčitá“, výchozí předstih upozornění (dny, přepíše globální 90), aktivní ano/ne, pořadí.

### Kategorie a výchozí položky (seed)

Lhůty v seedu jsou **jen ukázka** – skutečné hodnoty doplní Vladan podle dokladů (každý vydavatel má individuální lhůty).

**A) PPK – požární klapky** (kontrola provozuschopnosti požárně bezpečnostních zařízení – PBZ, vyhláška č. 246/2001 Sb. o požární prevenci)

- Mandík – oprávnění ke kontrole provozuschopnosti / montáži požárních klapek Mandík (jen jejich výrobky).
- Systemair – oprávnění k požárním klapkám Systemair (jen jejich výrobky).
- Ing. Švadlenka – **jeden doklad pro více výrobců** → u záznamu seznam „Pokrytí výrobci“ (multi-výběr / štítky). V přehledu zobrazit jako jeden doklad se štítky výrobců.

**B) Školení výrobců – instalace a uvedení do provozu**

- Daikin – tepelná čerpadla (instalace a uvedení do provozu).
- Daikin – VRV systémy (instalace a uvedení do provozu).
- Atrea – vzduchotechnické jednotky (instalace a uvedení do provozu).

**C) F-plyny a chladiva** (nařízení (EU) 2024/573, prováděcí nařízení (EU) 2024/2215, zákon č. 73/2012 Sb.)

- Certifikát pro chlazení, klimatizace a tepelná čerpadla – stávající kategorie I/II, **doba neurčitá**.
- Nový certifikát dle 2024/2215 (opakovaná zkouška) – předpoklad obnovy **každých 5 let** (novela zákona 73/2012 Sb. je v legislativním procesu – lhůtu ponechat upravitelnou).
- CO₂ (R744) – nový certifikát.
- Propan (R290) – nový certifikát, evidovat zvlášť; zařazení do kategorie upřesní Vladan.
- Poznámka: přesné označení kategorií (A1/A2, B …) bere appka z katalogu – nepsat do kódu.

**D) Elektro – odborná způsobilost v elektrotechnice** (zákon č. 250/2021 Sb. a nařízení vlády č. 194/2022 Sb.; dříve vyhláška 50/1978 Sb.)

- § 6 – osoba znalá pro samostatnou činnost.
- § 7 – osoba znalá pro řízení činnosti (vedoucí elektrotechnik).
- Periodické přezkoušení / školení u zaměstnavatele – lze evidovat i **bez dokladu** (příznak „bez dokladu“, jen datum a poznámka).

## 4. Záznam oprávnění u technika

Pole záznamu:

- technik, druh (z katalogu), číslo dokladu, vydavatel (předvyplní katalog), datum vydání
- **platnost do** (nebo příznak doba neurčitá); při zadání data vydání appka nabídne „platnost do“ podle výchozí lhůty druhu – vždy jde přepsat
- pokrytí výrobci (jen u druhů, které to mají povoleno – Švadlenka)
- předstih upozornění (prázdné = z druhu, jinak globální 90 dní)
- stav **Objednáno**: datum termínu školení/zkoušky + poznámka (kde, rezervační číslo)
- poznámka, příznak „bez dokladu“
- doklady (soubory) – **historie**: nový doklad nahradí aktuální, starší zůstanou v archivu u technika

### Stavy a semafor

| Stav | Barva | Pravidlo |
|---|---|---|
| Platné | zelená | platnost do > dnes + předstih |
| V předstihu | oranžová | dnes ≤ platnost do ≤ dnes + předstih |
| Propadlé | červená | platnost do < dnes |
| Objednáno | modrá | v předstihu nebo propadlé, ale je zadán termín školení |
| Doba neurčitá | šedá | bez data konce |

U každého záznamu zobrazit zbývající dny („za 42 dní“, „propadlé před 10 dny“). Stav technika = nejhorší stav jeho oprávnění (červená > oranžová > modrá > zelená > šedá).

Po uplynutí termínu u stavu Objednáno appka připomene „Nahraj nový doklad“ (záznam zůstane modrý s vykřičníkem, dokud se nenahraje nový doklad nebo nezmění termín).

Výpočet stavu **jedna čistá funkce** (`// <calc>` … `// </calc>`), testovaná v Node na hraničních datech (dnes, přesně na hranici předstihu, přechod roku, přestupný rok).

## 5. Upozornění

- **Výchozí předstih 90 dní**, přepisovatelný u druhu oprávnění (např. Daikin 120) i u jednotlivého záznamu.
- **E-mail:** první e-mail při vstupu do předstihu, pak **týdenní souhrn** do vyřízení (vyřízeno = nový doklad nebo stav Objednáno).
- **Příjemci:** správce dostává **souhrn za všechny techniky**; technik dostává **jen svá** oprávnění (pokud má e-mail v evidenci).
- Odesílatel: **pracovní e-mail** (ne osobní Gmail), SMTP údaje jen v GitHub Secrets.
- **V appce:** odznak s počtem položek k řešení + nahoře na hlavní obrazovce blok „K vyřízení“ (oranžové, červené, objednané po termínu).
- Tlačítko u záznamu: **„Objednáno na termín…“** (datum) → upozornění ztichne.
- Správce může spustit **„Poslat testovací e-mail“** (pro ověření kritéria hotovo).
- Log odeslaných upozornění (kdy, komu, které položky) – kvůli diagnostice a aby nechodily duplicity.

## 6. Doklady – vstup

- **Vyfotit** fotoaparátem z appky (`<input type=file accept="image/*" capture="environment">`) nebo **nahrát PDF / obrázek**.
- Fotku zmenšit v prohlížeči (delší strana ~2000 px, JPEG ~0,8 → cca 200–400 kB). PDF beze změny, limit velikosti (např. 10 MB) s hláškou.
- **Dva režimy vyplnění (oba):**
  1. **Ručně** – zdarma, správce vyplní údaje sám.
  2. **„Vyčíst AI“** – Edge Function `opravneni-vycteni` pošle doklad modelu s vizí, vrátí návrh: jméno, druh/vydavatel, číslo, datum vydání, platnost do, pokrytí výrobci. Správce **vždy potvrdí / opraví** před uložením. Nic se neukládá automaticky.
- AI: samostatný API klíč jen pro tuto appku (secret `OPRAVNENI_<SLUŽBA>_API_KEY`), levný model s vizí – konkrétní službu a model navrhni a nech potvrdit (viz sekce 13). Log volání (počet, chyba) bez obsahu dokladu.
- Otevírání dokladů jen přes podepsané URL (soukromý bucket).

## 7. Obrazovky (iOS vzhled dle skillu)

1. **Přehled** – nahoře „K vyřízení“, pod tím **seznam techniků** se semaforem a počty (např. „2 propadlé · 1 v předstihu“), řazeno od nejhoršího stavu. Hledání podle jména. Filtr kategorií (viz níže). Navigace nahoře, ne spodní lišta.
2. **Detail technika** – seskupené seznamy po kategoriích **PPK · Výrobci · F-plyny · Elektro**; řádek = druh, barevná tečka, platnost do, zbývající dny, náhled dokladu. Technik vidí jen tuto obrazovku pro sebe.
3. **Detail / úprava záznamu** – formulář (sekce 4), fotka/PDF, Vyčíst AI, Objednáno, historie dokladů.
4. **Nastavení** (správce) – technici (jméno, e-mail, aktivní, propojený účet), katalog druhů, globální předstih, příjemci souhrnu, testovací e-mail, „Přihlášen jako“, verze.

**Filtr kategorií A–D:** segmentový přepínač **Vše · PPK · Výrobci · F-plyny · Elektro** na Přehledu i v Detailu technika (na 320 px vodorovně posuvný).

- Na Přehledu se po výběru kategorie přepočítá semafor, počty i řazení techniků jen z oprávnění té kategorie; technici bez oprávnění v kategorii se skryjí (nebo šedě „bez oprávnění“ – zeptat se).
- Blok „K vyřízení“ respektuje zvolenou kategorii.
- V Detailu technika filtr zobrazí jen danou sekci.
- Volba se pamatuje (localStorage v try/catch) a jde nastavit i odkazem `?kat=ppk|vyrobci|fplyny|elektro`.
- Kategorie se berou z katalogu (sekce 3), ne natvrdo z kódu – nová kategorie se v přepínači objeví sama.
- Test: Playwright přepne každou kategorii a ověří počty na ukázkových datech.

Světlý/tmavý režim přes CSS proměnné, použitelné od 320 px. Viditelné „verze N“.

## 8. Technika a nasazení

- **PWA na GitHub Pages**, repo `opravneni` v **pracovní GitHub organizaci** (pokud ještě neexistuje: první krok = připravit návod k založení, založení potvrdí Vladan). Soubory v kořeni repa, `sw.js` s verzí cache, manifest + ikony.
- **Supabase:** sdílený pracovní projekt **„servisní záznamy“** (ref `pqehuuamgecmdmrdhmza`), **nový projekt nezakládat**. Schéma `opravneni` (+ komentář schématu, přidat do Exposed schemas), v appce `supabase.schema('opravneni')`.
- **Tabulky (návrh):** `technici`, `druhy` (katalog), `opravneni` (záznamy), `doklady` (soubory + historie), `nastaveni`, `uzivatele` (role správce/technik + vazba na technika), `upozorneni_log`.
- **Přístup:** funkce `opravneni.smi()` (security definer, `search_path = ''`, kontrola `aktivni` a slugu v `profily.aplikace`) + role. RLS: správce vše, technik **jen čtení vlastních** záznamů a dokladů. Granty jen `authenticated`, `anon` nic. Na konci každé migrace revoke execute + kontrola, viz skill sekce 4a.
- **Storage:** soukromý bucket `opravneni-doklady`, cesta `<technik_id>/<soubor>`, politiky jen pro tento bucket.
- **Denní kontrola upozornění:** GitHub Actions (cron 1× denně) → skript volá RPC chráněné tokenem (v DB jen SHA-256, token v GitHub Secrets, volání s publishable klíčem – **žádný service_role**) → odešle e-maily přes SMTP pracovního e-mailu → zapíše log. Při chybě log + artefakt.
- **Edge Function** `opravneni-vycteni` (AI) – ověří přihlášeného správce, loguje status a chyby bez tajných údajů.
- **Migrace:** průzkum jen ke čtení → migrace v jedné transakci → `NNN_rollback.sql` → lokální test (PGlite/Postgres se stubem `auth.uid()`, RLS druhým uživatelem) → **kontrola v chatu před spuštěním** → spuštění (přednostně konektor Supabase).
- **Připraveno k předání:** žádné osobní účty, jména ani e-maily natvrdo v kódu; konfigurace na jednom místě; README (nasazení, názvy secrets, zálohy).

## 9. Diagnostika, testy, ikona

- `?debug=1` – panel s logem a chybami JS, „verze N“, „Přihlášen jako“.
- Playwright: iPhone 13, Pixel 7, 320/390/768/1280 – přehled, detail technika, uložení záznamu, nahrání fotky (testovací obrázek), stav Objednáno. Výpočet stavů v Node. Po každé změně celá sada.
- Ikona hned s prvním prototypem: **3 motivy A/B/C** v jednom náhledu, rodinná barva pracovních appek (přechod #4a8fd4 → #2c5f94, bílý symbol). Návrhy motivů: odznak/certifikát se zaškrtnutím · štít s fajfkou · karta s hodinami. Kompletní sada ikon dle skillu.

## 9a. Převzato ze skillu hlasova-terenni-appka-supabase

Hlasová část (Siri, diktování) se zde **nepoužívá**. Převzít jen tyto osvědčené vzory a pasti:

- **AI vyčtení dokladu** = strukturovaný výstup se striktním JSON schématem (u OpenAI `response_format: json_schema, strict: true`, u Anthropic ekvivalent přes tool use); pole platnosti jako datum `YYYY-MM-DD` nebo `null`, druh oprávnění jen z enum seznamu katalogu, jména techniků jen z enum seznamu evidovaných techniků.
- **API klíč** jen v Supabase Secrets, v Billingu nastavit **limit útraty** a vypnout auto-recharge. Chyba 429 `insufficient_quota` = chybí kredit – appka ji zobrazí srozumitelně a nabídne ruční vyplnění.
- Edge Function volá appka s **JWT přihlášeného uživatele**, funkce ověří roli správce; žádný token ani service_role v appce. CORS ošetřit.
- **Pasti na PC:** Avast AntiTrack blokuje zápis `localStorage` ze skriptu z CDN → v `createClient` vlastní `storage` s vlastním `storageKey`, kopie v paměti a zápis odložený `setTimeout(…, 0)`. Při testech na http chybí `crypto.randomUUID` → fallback `noveId()`.
- **Hledání techniků bez diakritiky** (normalizace v JS, případně `unaccent` v DB).
- **Pořadí nasazení:** nejdřív SQL migrace (s kontrolním `select` z `information_schema`) → Edge Function → soubory appky se zvýšenou verzí cache v `sw.js` a textem „verze N“. Bez migrace se appka nenačte.
- **Testy z PowerShellu** (funkce, RPC): blok s `try/catch`, výpis statusu i těla chyby, tělo jako UTF-8 bajty.
- Ikona: platí rodinná barva pracovních appek podle vyvoj-appky-zaklad (má přednost před barvami ze šablony tohoto skillu); šablonu generátoru PIL lze použít pro tvar a stín.

## 10. Ukázková data

6 techniků s fiktivními jmény (žádná skutečná osobní data v repu). Rozložení stavů tak, aby přehled ukázal vše: alespoň 1 propadlé, 2 v předstihu, 1 objednané, F-plyny I/II na dobu neurčitou, Švadlenka se 3 výrobci, elektro § 6 i § 7, 1 záznam „bez dokladu“. Ukázková data jen v režimu dema / seedu, ne v produkční DB.

## 11. Etapy

1. **Prototyp** – jeden soubor, ukázková data v paměti, všechny obrazovky, výpočet stavů + testy, 3 návrhy ikon → screenshoty ke kontrole v chatu.
2. **Supabase** – průzkum, migrace schématu `opravneni` + RLS + bucket → kontrola v chatu → spuštění; přihlášení, role, CRUD.
3. **Doklady** – foto/PDF, zmenšení, historie, podepsané URL.
4. **Upozornění** – GitHub Actions cron, RPC s tokenem, SMTP pracovní e-mail, log, testovací e-mail; odznak v appce.
5. **AI vyčtení** – Edge Function, potvrzovací formulář.
6. **Nasazení** – Pages, ikony, README, CLAUDE.md.

Každá etapa končí shrnutím dle skillu sekce 9 (co umí, co nahrát, jak ověřit, stav ikony, dopad na limity) a commitem + pushem (rozpracované do větve `rozpracovano`).

## 12. Dopad na náklady a limity

- **Claude Code:** stavba po etapách, velké soubory upravovat cílenými záměnami.
- **GitHub:** Pages zdarma; Actions ~1 min denně (cron) – zanedbatelné.
- **Supabase (free, sdílený):** malé tabulky; Storage – zmenšené fotky 200–400 kB, PDF do 10 MB → stovky dokladů = desítky MB z 1 GB sdílených. Denní cron drží projekt aktivní.
- **AI vyčtení:** jediná průběžně placená položka – platí se jen při stisku „Vyčíst AI“ (řádově korun za doklad, upřesnit podle zvoleného modelu).

## 13. Otevřené body (zeptat se na začátku, max 4)

1. Pracovní GitHub organizace – existuje už? Název?
2. Pracovní e-mail pro odesílání (SMTP: server, port, účet) – jen názvy secrets do repa, hodnoty zadá Vladan.
3. AI služba pro vyčtení dokladů (OpenAI vs. Anthropic) a model – s odhadem ceny za doklad.
4. Skutečné lhůty platnosti jednotlivých druhů (Mandík, Systemair, Švadlenka, Daikin, Atrea, elektro) – nebo nechat na doplnění v Nastavení.
