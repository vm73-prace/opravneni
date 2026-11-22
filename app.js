/* Evidence oprávnění techniků – appka (vanilla JS). Výpočty v calc.js, ukázková data v demo.js. */
var VERZE = 10;
var Q = new URLSearchParams(location.search);
var DEBUG = Q.get('debug') === '1';
var DEMO = Q.get('demo') === '1'; // ?demo=1 = ukázková data v paměti, jinak Supabase
// Sdílený projekt „servisní záznamy“, schéma opravneni. Publishable klíč je veřejný, data chrání RLS.
var SUPABASE_URL = 'https://pqehuuamgecmdmrdhmza.supabase.co';
var SUPABASE_KEY = 'sb_publishable_6SgwttYu1LHUrAeInwv1Qw_chrfScN7';
var SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
var SCHEMA = 'opravneni';
// Testovací e-mail se spouští na GitHubu (SMTP heslo je jen v GitHub Secrets): Run workflow → režim test
var WORKFLOW_URL = 'https://github.com/vm73-prace/opravneni/actions/workflows/upozorneni.yml';
var LIMIT_SOUBORU = 10 * 1024 * 1024;
// AI vyčtení dokladu: Edge Function (Claude Haiku 5.5). Vrací jen návrh, ukládá vždy správce sám. Denní limit hlídá DB (003).
var FUNKCE_AI = SUPABASE_URL + '/functions/v1/opravneni-vycteni';

/* ---------- Diagnostika ---------- */
// ?debug=1: panel s logem dole. Nepřekrývá obsah – jde sbalit tlačítkem (volba se pamatuje)
// a stránka má dole odsazení podle výšky panelu, takže se vše dá vyrolovat nad něj.
var dbgEl = document.getElementById('debug'), dbgLog = null, dbgTlacitko = null, dbgRadku = 0;
function dbgSbaleny() { try { return localStorage.getItem('opr_dbg_sbaleny') === '1'; } catch (e) { return false; } }
function dbgOdsazeni() { document.body.style.paddingBottom = DEBUG ? (dbgEl.offsetHeight + 16) + 'px' : ''; }
function dbgPopisek() {
  dbgTlacitko.textContent = (dbgEl.classList.contains('sbaleny') ? '▸ Log (' + dbgRadku + ')' : '▾ Sbalit log') + (dbgEl.classList.contains('chyba') ? ' · chyba' : '');
}
if (DEBUG) {
  dbgEl.innerHTML = '<button type="button" id="dbgPrepni" aria-controls="dbgLog"></button><div id="dbgLog"></div>';
  dbgLog = document.getElementById('dbgLog'); dbgTlacitko = document.getElementById('dbgPrepni');
  if (dbgSbaleny()) dbgEl.classList.add('sbaleny');
  dbgTlacitko.onclick = function () {
    var sbalit = !dbgEl.classList.contains('sbaleny');
    dbgEl.classList.toggle('sbaleny', sbalit);
    try { localStorage.setItem('opr_dbg_sbaleny', sbalit ? '1' : '0'); } catch (e) { /* bez úložiště */ }
    dbgTlacitko.setAttribute('aria-expanded', String(!sbalit));
    dbgPopisek(); dbgOdsazeni();
  };
  dbgTlacitko.setAttribute('aria-expanded', String(!dbgSbaleny()));
}
function zapisDbg(msg, cls) {
  if (!DEBUG) return;
  var d = document.createElement('div'); if (cls) d.className = cls;
  d.textContent = new Date().toLocaleTimeString('cs-CZ') + ' ' + msg; dbgLog.appendChild(d); dbgLog.scrollTop = 1e9;
  dbgRadku++; dbgPopisek(); dbgOdsazeni();
}
function log() {
  var msg = Array.prototype.map.call(arguments, function (a) { return typeof a === 'string' ? a : JSON.stringify(a); }).join(' ');
  zapisDbg(msg); console.log('[opr]', msg);
}
function logChyba(msg) { if (DEBUG) dbgEl.classList.add('chyba'); zapisDbg('CHYBA ' + msg, 'e'); console.error('[opr]', msg); }
if (DEBUG) { dbgEl.classList.add('on'); dbgPopisek(); dbgOdsazeni(); window.addEventListener('resize', dbgOdsazeni); }
window.addEventListener('error', function (e) { logChyba(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); });
window.addEventListener('unhandledrejection', function (e) { logChyba(String(e.reason && e.reason.message || e.reason)); });

/* ---------- Data ---------- */
var dnes = Calc.dnesPraha();
function prazdnaData() { return { kategorie: [], druhy: [], technici: [], opravneni: [], doklady: [], nastaveni: {}, uzivatele: [] }; }
var S = DEMO ? demoData(dnes) : prazdnaData();
// Role: správce vidí vše; technik jen svou sekci a nic needituje. V ukázce se přepíná ?jako=<id technika>.
var JAKO = Q.get('jako');
// Mimo ukázku roli určí databáze po přihlášení (nactiData): je_spravce() / muj_technik().
var role = DEMO && JAKO ? { typ: 'technik', technik_id: JAKO } : { typ: 'spravce' };
var SPRAVCE = role.typ === 'spravce';
var sb = null, db = null, uzivatel = null, pristup = null; // klient Supabase, schéma, přihlášený účet, smí do appky
var dokladUrl = {}; // path -> object URL (ukázka) / podepsaná URL ze Storage (platí 1 h, obnovuje se po 50 min)
var podepsanoCas = 0;
var BUCKET = 'opravneni-doklady';
var noveCislo = 0;
// Na http (testy) chybí crypto.randomUUID → záložní id
function noveId() { try { return crypto.randomUUID(); } catch (e) { return 'n' + Date.now().toString(36) + (++noveCislo); } }

// Rozhraní k datům: apiDemo (paměť) a apiSupabase mají stejné metody
function ulozDo(arr, o) {
  if (!o.id) { o.id = noveId(); arr.push(o); return Promise.resolve(o); }
  var i = arr.findIndex(function (x) { return x.id === o.id; });
  if (i >= 0) arr[i] = Object.assign({}, arr[i], o); else arr.push(o);
  return Promise.resolve(arr[i >= 0 ? i : arr.length - 1]);
}
var apiDemo = {
  ulozTechnika: function (t) { return ulozDo(S.technici, t); },
  ulozDruh: function (d) { return ulozDo(S.druhy, d); },
  ulozKategorii: function (k, nova) { return nova ? (S.kategorie.push(k), Promise.resolve(k)) : ulozDo(S.kategorie, k); },
  ulozZaznam: function (o) { return ulozDo(S.opravneni, o); },
  smazZaznam: function (id) {
    S.opravneni = S.opravneni.filter(function (x) { return x.id !== id; });
    S.doklady = S.doklady.filter(function (x) { return x.opravneni_id !== id; });
    return Promise.resolve();
  },
  ulozNastaveni: function (n) { Object.assign(S.nastaveni, n); return Promise.resolve(S.nastaveni); },
  // Nový doklad nahradí aktuální, starší zůstanou v archivu
  pridejDoklad: function (opravneniId, blob, nazev) {
    var path = najdi(S.opravneni, opravneniId).technik_id + '/' + noveId() + (blob.type === 'application/pdf' ? '.pdf' : '.jpg');
    dokladUrl[path] = URL.createObjectURL(blob);
    S.doklady.forEach(function (k) { if (k.opravneni_id === opravneniId) k.aktualni = false; });
    var k = { id: noveId(), opravneni_id: opravneniId, path: path, typ: blob.type, nazev: nazev, velikost: blob.size, nahrano: dnes, aktualni: true };
    S.doklady.push(k);
    log('doklad nahrán', path, Math.round(blob.size / 1024) + ' kB');
    return Promise.resolve(k);
  }
};
/* ---------- Supabase ---------- */
// Výsledek dotazu: do logu status a chyba (bez tokenů), při chybě výjimka se srozumitelnou hláškou
function q(popis, dotaz) {
  return Promise.resolve(dotaz).then(function (r) {
    log('supabase', popis, (r.status != null ? String(r.status) : 'ok') + (r.error ? ' ' + (r.error.code || '') + ' ' + r.error.message : ''));
    if (r.error) throw new Error(prelozChybu(r.error));
    return r.data;
  });
}
function prelozChybu(e) {
  var m = e.message || String(e);
  if (e.code === '42501' || /row-level security|permission denied/i.test(m)) return 'Na tuto změnu nemáš oprávnění.';
  if (e.code === '23503') return 'Záznam je použitý jinde (např. technik má oprávnění nebo oprávnění má doklady) – nejde smazat ani přesunout.';
  if (e.code === '23505') return 'Takový záznam už existuje.';
  if (e.code === '23514') return 'Hodnota nesplňuje pravidla (zkontroluj data a čísla).';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Nejde se spojit se serverem (jsi online?).';
  return m;
}
// Uloží do tabulky (insert bez id / update s id, jen pole, která přišla) a výsledek zapíše do S
function ulozSb(tabulka, o, sloupce) {
  var data = {};
  sloupce.forEach(function (k) { if (o[k] !== undefined) data[k] = o[k]; });
  var dotaz = o.id ? db.from(tabulka).update(data).eq('id', o.id) : db.from(tabulka).insert(data);
  return q((o.id ? 'update ' : 'insert ') + tabulka, dotaz.select().single()).then(function (row) {
    var arr = S[tabulka], i = arr.findIndex(function (x) { return x.id === row.id; });
    if (i >= 0) arr[i] = Object.assign({}, arr[i], row); else arr.push(row);
    return i >= 0 ? arr[i] : row;
  });
}
var SLOUPCE = {
  technici: ['jmeno', 'email', 'aktivni'],
  druhy: ['kategorie', 'nazev', 'vydavatel', 'popis', 'lhuta_mesicu', 'neurcita', 'predstih_dni', 'vice_vyrobcu', 'aktivni', 'poradi'],
  opravneni: ['technik_id', 'druh_id', 'cislo', 'vydavatel', 'vydano', 'platnost_do', 'neurcita', 'vyrobci', 'predstih_dni',
    'objednano_na', 'objednano_pozn', 'poznamka', 'bez_dokladu']
};
var apiSupabase = {
  ulozTechnika: function (t) { return ulozSb('technici', t, SLOUPCE.technici); },
  ulozDruh: function (d) { return ulozSb('druhy', d, SLOUPCE.druhy); },
  ulozKategorii: function (k, nova) {
    var data = { nazev: k.nazev, poradi: k.poradi };
    var dotaz = nova ? db.from('kategorie').insert(Object.assign({ id: k.id }, data)) : db.from('kategorie').update(data).eq('id', k.id);
    return q((nova ? 'insert' : 'update') + ' kategorie', dotaz.select().single()).then(function (row) {
      var i = S.kategorie.findIndex(function (x) { return x.id === row.id; });
      if (i >= 0) S.kategorie[i] = row; else S.kategorie.push(row);
      return row;
    });
  },
  ulozZaznam: function (o) { return ulozSb('opravneni', o, SLOUPCE.opravneni); },
  smazZaznam: function (id) { // řádky dokladů smaže databáze kaskádou, soubory pak appka (chyba jen do logu)
    var cesty = S.doklady.filter(function (x) { return x.opravneni_id === id; }).map(function (x) { return x.path; });
    return q('delete opravneni', db.from('opravneni').delete().eq('id', id)).then(function () {
      S.opravneni = S.opravneni.filter(function (x) { return x.id !== id; });
      S.doklady = S.doklady.filter(function (x) { return x.opravneni_id !== id; });
      if (cesty.length) q('remove ' + cesty.length + ' souborů', sb.storage.from(BUCKET).remove(cesty)).catch(function (e) { logChyba('soubory: ' + e.message); });
    });
  },
  ulozNastaveni: function (n) {
    return q('update nastaveni', db.from('nastaveni').update(n).eq('id', 1).select().single())
      .then(function (row) { S.nastaveni = row; return row; });
  },
  // Nový doklad: soubor do Storage ('<technik_id>/<uuid>.<přípona>'), dosavadní aktuální do historie, nový řádek.
  // Když zápis do DB selže, nahraný soubor se smaže a předchozí doklad zůstane aktuální.
  pridejDoklad: function (opravneniId, blob, nazev) {
    var o = najdi(S.opravneni, opravneniId);
    var path = o.technik_id + '/' + noveId() + (blob.type === 'application/pdf' ? '.pdf' : '.jpg');
    var predchozi = S.doklady.filter(function (k) { return k.opravneni_id === opravneniId && k.aktualni; });
    var zpetPredchozi = function () {
      return predchozi.length ? q('vrátit aktuální doklad', db.from('doklady').update({ aktualni: true }).in('id', predchozi.map(function (k) { return k.id; }))) : Promise.resolve();
    };
    return q('upload ' + Math.round(blob.size / 1024) + ' kB', sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false }))
      .then(function () {
        return predchozi.length ? q('historie dokladů', db.from('doklady').update({ aktualni: false }).eq('opravneni_id', opravneniId).eq('aktualni', true)) : null;
      })
      .then(function () {
        return q('insert doklady', db.from('doklady').insert({ opravneni_id: opravneniId, technik_id: o.technik_id, path: path, typ: blob.type, nazev: nazev, velikost: blob.size, aktualni: true }).select().single());
      })
      .then(function (row) {
        predchozi.forEach(function (k) { k.aktualni = false; });
        S.doklady.push(row);
        dokladUrl[path] = URL.createObjectURL(blob); // hned k zobrazení, podepsaná URL až při dalším načtení
        return row;
      }, function (err) {
        return zpetPredchozi().catch(function (e) { logChyba('návrat dokladu: ' + e.message); }).then(function () {
          return q('remove nepoužitý soubor', sb.storage.from(BUCKET).remove([path])).catch(function (e) { logChyba('úklid: ' + e.message); });
        }).then(function () { throw err; });
      });
  }
};
var api = DEMO ? apiDemo : apiSupabase;

// Úložiště přihlášení: kopie v paměti a zápis do localStorage odložený (Avast AntiTrack blokuje synchronní zápis
// ze skriptu z CDN); když localStorage nejde, přihlášení platí do zavření stránky.
// Smazání = null v paměti (ne delete, jinak by getItem spadl zpět na starou session v localStorage).
// Paměť nepřežije obnovení stránky: co nejde smazat, přepíše se prázdnou hodnotou, a start() ověří sezení na serveru.
var AUTH_KLIC = 'opravneni-auth';
var authPamet = {};
var authStorage = {
  getItem: function (k) { if (k in authPamet) return authPamet[k]; try { return localStorage.getItem(k) || null; } catch (e) { return null; } },
  setItem: function (k, v) {
    authPamet[k] = v;
    setTimeout(function () { // mezitím odhlášeno (i v jiné záložce) → nezapisovat
      if (authPamet[k] !== v) return;
      try { localStorage.setItem(k, v); } catch (e) { log('auth: localStorage nejde zapsat'); }
    }, 0);
  },
  removeItem: function (k) {
    // Už smazané v této záložce (nebo v jiné, viz událost storage): opožděné odhlášení nesmí smazat nové přihlášení z jiné záložky
    if (authPamet[k] === null) return;
    authPamet[k] = null;
    setTimeout(function () {
      try { localStorage.removeItem(k); } catch (e) { log('auth: localStorage nejde smazat'); }
      try { if (localStorage.getItem(k)) localStorage.setItem(k, ''); } catch (e) { log('auth: localStorage nejde přepsat'); }
    }, 0);
  }
};
// Odhlášení jen tohoto zařízení (scope local). Povede se vždy: signOut při vypršeném tokenu a výpadku vrací chybu
// bez smazání session (až po 30 s opakování) a bez odpovědi serveru neskončí vůbec – proto při chybě nebo po limitu
// smaže session appka sama.
var ODHLASENI_LIMIT_MS = 5000;
var odhlasovani = null; // běžící signOut: nové přihlášení na něj čeká, jinak by mu opožděný signOut session smazal
var overovani = null; // běžící ověření sezení ze startu: jeho opožděné odmítnutí by smazalo nové přihlášení
var relace = 0; // zvýší se při každém odhlášení; opožděné načítání ze starší relace se zahodí
var startStav = null; // null = start hotový, 'nacitam', jinak text hlášky výpadku (obrazovka se Zkusit znovu)
function odhlasen() {
  if (!uzivatel && !startStav) return; // opožděná událost nesmí překreslit rozepsané přihlášení
  relace++; uzivatel = null; pristup = null; startStav = null; S = prazdnaData();
  history.replaceState(null, '', location.pathname + location.search);
  render();
}
function odhlasit() {
  var smazano = false;
  function jenLokalne(duvod) {
    if (smazano) return;
    smazano = true;
    log('odhlášení offline – session smazána jen lokálně', '(' + duvod + ')');
    authStorage.removeItem(AUTH_KLIC);
    odhlasen();
  }
  if (!sb) return jenLokalne('knihovna není načtená');
  var limit = setTimeout(function () { jenLokalne('server neodpověděl do ' + ODHLASENI_LIMIT_MS / 1000 + ' s'); }, ODHLASENI_LIMIT_MS);
  var beh = odhlasovani = sb.auth.signOut({ scope: 'local' }).catch(function (e) { return { error: e }; }).then(function (r) {
    clearTimeout(limit);
    if (r.error) jenLokalne((r.error.status || '') + ' ' + r.error.message); else { smazano = true; odhlasen(); }
    if (odhlasovani === beh) odhlasovani = null;
  });
}
// Odhlášení v jiné záložce: kopie v paměti této záložky by při obnově tokenu session zapsala zpět.
window.addEventListener('storage', function (e) {
  if (e.key !== AUTH_KLIC || e.newValue) return; // jen smazání nebo přepsání prázdnou hodnotou
  authPamet[AUTH_KLIC] = null;
  odhlasen();
});
function nactiSkript(src) {
  return new Promise(function (res, rej) {
    var el = document.createElement('script'); el.src = src; el.onload = res;
    el.onerror = function () { rej(new Error('Nepodařilo se načíst knihovnu Supabase (jsi online?)')); };
    document.head.appendChild(el);
  });
}
// Po přihlášení: přístup (smi), role, pak data. Technikovi RLS vrátí jen jeho řádky.
function nactiData() {
  var moje = relace;
  return q('rpc smi', db.rpc('smi')).then(function (smi) {
    if (moje !== relace) return;
    pristup = smi === true;
    if (!pristup) return;
    return Promise.all([q('rpc je_spravce', db.rpc('je_spravce')), q('rpc muj_technik', db.rpc('muj_technik'))]).then(function (r) {
      role = r[0] === true ? { typ: 'spravce' } : { typ: 'technik', technik_id: r[1] || null };
      SPRAVCE = role.typ === 'spravce';
      log('role', role.typ);
      return Promise.all([
        q('select kategorie', db.from('kategorie').select('*')),
        q('select druhy', db.from('druhy').select('*')),
        q('select technici', db.from('technici').select('*').order('jmeno')),
        q('select opravneni', db.from('opravneni').select('*')),
        q('select doklady', db.from('doklady').select('*')),
        SPRAVCE ? q('select nastaveni', db.from('nastaveni').select('*').eq('id', 1).maybeSingle())
          : q('rpc nastaveni_vypocet', db.rpc('nastaveni_vypocet')).then(function (x) { return (x && x[0]) || {}; }),
        SPRAVCE ? q('select uzivatele', db.from('uzivatele').select('user_id,role,technik_id')) : Promise.resolve([]),
        SPRAVCE ? nactiTestLog() : Promise.resolve([])
      ]);
    }).then(function (d) {
      if (moje !== relace) return;
      S = { kategorie: d[0], druhy: d[1], technici: d[2], opravneni: d[3], doklady: d[4], nastaveni: d[5] || {}, uzivatele: d[6], testLog: d[7] };
      // propojený účet technika (jen pro zobrazení v Nastavení)
      S.technici.forEach(function (t) { t.ucet = S.uzivatele.some(function (u) { return u.technik_id === t.id; }) ? 'propojen' : null; });
      log('načteno', S.technici.length + ' techniků, ' + S.opravneni.length + ' oprávnění, ' + S.druhy.length + ' druhů, ' + S.doklady.length + ' dokladů');
      return podepisDoklady();
    });
  });
}
function podepisDoklady() {
  var cesty = S.doklady.map(function (k) { return k.path; }).filter(function (p) { return !/^blob:/.test(dokladUrl[p] || ''); });
  if (!cesty.length) return Promise.resolve();
  return q('sign ' + cesty.length + ' dokladů', sb.storage.from(BUCKET).createSignedUrls(cesty, 3600)).then(function (d) {
    d.forEach(function (x) { if (x.signedUrl) dokladUrl[x.path]= x.signedUrl; else if (x.error) logChyba('doklad ' + x.path + ': ' + x.error); });
    podepsanoCas = Date.now();
  }, function (e) { logChyba('podepsané URL: ' + e.message); }); // chyba náhledů nebrání zobrazení dat
}
// Poslední testovací e-maily z upozorneni_log (zapisuje skript na GitHubu)
function nactiTestLog() {
  return q('select upozorneni_log (test)', db.from('upozorneni_log').select('cas,typ,prijemce,stav,chyba').eq('typ', 'test').order('cas', { ascending: false }).limit(20));
}
// Ověření sezení na serveru: tyto kódy = session neplatí, zahodí se jen na tomto zařízení (session_not_found zahodí supabase-js sám).
// Jiná chyba (síť, 5xx, 429) session nechá.
var AUTH_NEPLATNE = ['bad_jwt', 'user_not_found', 'user_banned'];
// Start bez odpovědi serveru (supabase-js při ní čeká bez konce): po limitu hláška výpadku s Odhlásit, odpověď ji pak nahradí
var START_LIMIT_MS = 35000;
var VYPADEK_AUTH = 'Server přihlášení není dostupný. Přihlášení zůstává uložené, zkus to za chvíli znovu.';
function start() {
  if (DEMO) { pripravDemoSoubory(); nastavKat(Q.has('kat') ? Q.get('kat') : aktKat()); return render(); }
  var moje = relace, hotovo = false;
  startStav = 'nacitam'; render();
  setTimeout(function () { if (!hotovo && moje === relace) { startStav = VYPADEK_AUTH; render(); } }, START_LIMIT_MS);
  nactiSkript(SUPABASE_JS).then(function () {
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storage: authStorage, storageKey: AUTH_KLIC, persistSession: true, autoRefreshToken: true } });
    db = sb.schema(SCHEMA);
    sb.auth.onAuthStateChange(function (udalost) {
      log('auth', udalost);
      if (udalost === 'SIGNED_OUT') odhlasen();
    });
    return sb.auth.getSession();
  }).then(function (r) {
    if (moje !== relace || !r.data.session) return r;
    // Session z localStorage může být po odhlášení (blokované mazání) – ověří se na serveru.
    overovani = sb.auth.getUser().then(function (u) {
      if (moje !== relace || !u.error) return;
      log('auth: ověření sezení', (u.error.code || u.error.status || '') + ' ' + u.error.message);
      if (AUTH_NEPLATNE.indexOf(u.error.code) >= 0) { authStorage.removeItem(AUTH_KLIC); odhlasen(); }
    }).catch(function (e) { log('auth: ověření sezení', e.message); });
    return overovani.then(function () { overovani = null; return sb.auth.getSession(); });
  }).then(function (r) {
    if (moje !== relace) return;
    // Vypršený token a výpadek: session v úložišti zůstává, přihlašovací formulář by vypadal jako odhlášení
    if (!r.data.session && r.error && authStorage.getItem(AUTH_KLIC)) throw new Error(VYPADEK_AUTH);
    uzivatel = r.data.session ? r.data.session.user : null;
    return uzivatel ? nactiData() : null;
  }).then(function () {
    hotovo = true;
    if (moje !== relace) return;
    startStav = null;
    nastavKat(Q.has('kat') ? Q.get('kat') : aktKat()); render();
  }).catch(function (e) {
    hotovo = true;
    logChyba(e.message);
    if (moje !== relace) return;
    startStav = e.message; render();
  });
}
// Načítání a hláška výpadku při startu. Odhlásit jen když je co odhlásit (session v úložišti).
function vStart() {
  if (startStav === 'nacitam') { app.innerHTML = '<main><h1>Oprávnění</h1><div class="empty">Načítám…</div></main>'; return; }
  app.innerHTML = '<main><h1>Oprávnění</h1><div class="err" role="alert">' + h(startStav) + '</div>' +
    '<button class="btn primary" style="width:100%" onclick="location.reload()">Zkusit znovu</button>' +
    (authStorage.getItem(AUTH_KLIC) ? ODHLASIT : '') + paticka() + '</main>';
}

function pripravDemoSoubory() {
  S.doklady.forEach(function (k) {
    if (dokladUrl[k.path]) return;
    var o = najdi(S.opravneni, k.opravneni_id), dr = druhOf(o), t = najdi(S.technici, o.technik_id);
    var text = (dr ? dr.nazev : '') + ' – ' + (t ? t.jmeno : '');
    dokladUrl[k.path] = URL.createObjectURL(k.typ === 'application/pdf' ? demoPdf('Osvedceni ' + o.cislo) : demoObrazek(text));
  });
}

/* ---------- Pomocné ---------- */
function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function $(sel) { return document.querySelector(sel); }
function najdi(arr, id) { return arr.find(function (o) { return o.id === id; }); }
function druhOf(o) { return o && najdi(S.druhy, o.druh_id); }
var pamet = {}; // záloha localStorage v paměti (soukromé okno, blokované úložiště)
function lsGet(k, d) {
  if (k in pamet) return pamet[k];
  try { var v = localStorage.getItem('opr_' + k); if (v !== null) return v; } catch (e) { /* bez úložiště */ }
  return d;
}
function lsSet(k, v) { pamet[k] = v; try { localStorage.setItem('opr_' + k, v); } catch (e) { log('localStorage nejde zapsat, volba platí do zavření'); } }
// Kategorie z katalogu jako [kód, název] seřazené podle pořadí
function kategorie() { return S.kategorie.slice().sort(function (a, b) { return (a.poradi || 0) - (b.poradi || 0); }).map(function (k) { return [k.id, k.nazev]; }); }
function nazevKat(kod) { var k = kategorie().find(function (x) { return x[0] === kod; }); return k ? k[1] : kod; }
// Filtr kategorie: odkaz ?kat=… má přednost, jinak zapamatovaná volba; neznámý kód = Vše
function platnaKat(v) { return v === 'vse' || kategorie().some(function (k) { return k[0] === v; }) ? v : 'vse'; }
function aktKat() { return platnaKat(lsGet('kat', 'vse')); }
function nastavKat(v) {
  v = platnaKat(v);
  lsSet('kat', v);
  try { // adresa vždy odpovídá filtru, aby šla poslat odkazem
    var u = new URL(location.href);
    if (v === 'vse') u.searchParams.delete('kat'); else u.searchParams.set('kat', v);
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  } catch (e) { logChyba('kat url: ' + e.message); }
  return v;
}
function segKat(kat) {
  return '<div class="seg kat" role="group" aria-label="Kategorie">' + [['vse', 'Vše']].concat(kategorie()).map(function (k) {
    return '<button data-act="kat" data-v="' + h(k[0]) + '" aria-pressed="' + (kat === k[0]) + '">' + h(k[1]) + '</button>';
  }).join('') + '</div>';
}
function aktualniDoklad(oid) { return S.doklady.find(function (k) { return k.opravneni_id === oid && k.aktualni; }); }
function stavZaznamu(o) { return Calc.stavOpravneni(o, druhOf(o), dnes, S.nastaveni); }
function vsechnyPolozky() {
  return S.opravneni.map(function (o) { var d = druhOf(o); return { o: o, druh: d, technik_id: o.technik_id, kategorie: d ? d.kategorie : '', s: stavZaznamu(o) }; });
}
var STAV_NAZEV = { platne: 'Platné', predstih: 'V předstihu', propadle: 'Propadlé', objednano: 'Objednáno', neurcita: 'Doba neurčitá', bez: 'Bez oprávnění' };
var PDF_IKONA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M6 2.5h8l4.5 4.5v14.5H6z"/><path d="M14 2.5V7h4.5"/><text x="12" y="17.5" font-size="5.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="Arial" font-weight="700">PDF</text></svg>';
var BEZ_IKONA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>';
var GEAR = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

function thumb(k, velky) {
  var cls = 'thumb' + (velky ? ' velky' : '');
  if (!k) return '<div class="' + cls + '">' + BEZ_IKONA + '</div>';
  if (k.typ === 'application/pdf') return '<div class="' + cls + ' pdf">' + PDF_IKONA + '</div>';
  return '<div class="' + cls + '"><img src="' + h(dokladUrl[k.path] || '') + '" alt="náhled dokladu"></div>';
}
function dot(stav) { return '<span class="dot ' + stav + '" aria-hidden="true"></span>'; }
function tag(s) { return '<span class="tag ' + s.stav + '" data-stav="' + s.stav + '">' + (s.po_terminu ? '! ' : '') + h(s.text) + '</span>'; }
function chips(arr) { return (arr || []).length ? '<div class="chips">' + arr.map(function (v) { return '<span class="chip">' + h(v) + '</span>'; }).join('') + '</div>' : ''; }

/* ---------- Obrazovky ---------- */
var app = document.getElementById('app');
function bar(levy, pravy) { return '<div class="bar">' + (levy || '') + '<span class="spacer"></span>' + (pravy || '') + '</div>'; }
function zpet(href, text) { return '<a class="btn-text" href="' + href + '">‹ ' + h(text || 'Zpět') + '</a>'; }
function banner() { return DEMO ? '<div class="banner">Ukázkový režim – data jsou smyšlená a změny se po obnovení stránky ztratí.</div>' : ''; }
function prihlasenJako() {
  var ucet = !DEMO && uzivatel ? uzivatel.email + ' – ' : '';
  if (SPRAVCE) return ucet ? ucet + 'správce' : 'Správce' + (DEMO ? ' (ukázka)' : '');
  var t = najdi(S.technici, role.technik_id);
  return ucet + (t ? t.jmeno : '?') + ' (technik)';
}
var ODHLASIT = '<div class="actions"><button class="btn danger full" data-act="odhlasit">Odhlásit</button></div>';
// Chyba uložení: do formuláře, jinak hláška
function selhalo(err) {
  logChyba(err.message);
  var el = $('#chyba') || $('#chybaObj');
  if (el) el.textContent = 'Uložení selhalo: ' + err.message; else alert('Uložení selhalo: ' + err.message);
}
function paticka() { return '<footer>verze ' + VERZE + (DEMO ? ' · demo' : '') + ' · dnes ' + Calc.formatDatum(dnes) + '</footer>'; }

function radekVyrizeni(x) {
  var t = najdi(S.technici, x.technik_id);
  return '<a class="row" href="#/o/' + x.o.id + '" data-vyrizeni="' + h(t ? t.jmeno : '') + '">' + dot(x.s.stav) +
    '<div class="info"><div class="t wrap">' + h(t ? t.jmeno : '?') + ' – ' + h(x.druh ? x.druh.nazev : '?') + '</div>' +
    '<div class="stavradek">' + tag(x.s) + (x.o.platnost_do ? '<span class="sub">platí do ' + Calc.formatDatum(x.o.platnost_do) + '</span>' : '') + '</div></div></a>';
}
function radekTechnika(r) {
  return '<a class="row" href="#/t/' + r.technik.id + '" data-technik="' + h(r.technik.jmeno) + '" data-stav="' + r.stav + '">' + dot(r.stav) +
    '<div class="info"><div class="t">' + h(r.technik.jmeno) + '</div><div class="sub' + (r.stav === 'bez' ? ' sede' : '') + '">' + h(r.popis) + '</div></div>' +
    '<span class="chev">›</span></a>';
}

function vPrehled() {
  if (!SPRAVCE) return vTechnik(role.technik_id);
  var kat = aktKat();
  var pol = vsechnyPolozky();
  var vKat = pol.filter(function (x) { return kat === 'vse' || x.kategorie === kat; });
  var tech = S.technici.filter(function (t) { return t.aktivni !== false; }).map(function (t) { return t.id; });
  var kv = vKat.filter(function (x) { return tech.indexOf(x.technik_id) >= 0 && Calc.kVyrizeni(x.s); }).sort(function (a, b) { return Calc.porovnej(a.s, b.s); });
  var celkem = pol.filter(function (x) { return tech.indexOf(x.technik_id) >= 0 && Calc.kVyrizeni(x.s); }).length;
  odznak(celkem);
  var html = bar('', '<a class="btn-text" href="#/nastaveni" aria-label="Nastavení">' + GEAR + '</a>');
  html += '<main><h1>Oprávnění' + (celkem ? ' <span class="badge" id="odznak" title="Položek k řešení">' + celkem + '</span>' : '') + '</h1>' + banner();
  html += segKat(kat);
  html += '<h2>K vyřízení' + (kv.length ? ' (' + kv.length + ')' : '') + '</h2><section class="group" id="vyrizeni">' +
    (kv.length ? kv.map(radekVyrizeni).join('') : '<div class="empty">Nic k vyřízení ✓</div>') + '</section>';
  html += '<h2>Technici</h2><input type="search" id="hledat" class="search" placeholder="Hledat technika" autocomplete="off" value="' + h(lsGet('hledat', '')) + '">' +
    '<section class="group" id="seznam"></section>' + paticka() + '</main>';
  app.innerHTML = html;
  var vypis = function () {
    var q = Calc.bezDiakritiky($('#hledat').value.trim());
    lsSet('hledat', $('#hledat').value);
    var rows = Calc.prehled(S.technici, pol, kat).filter(function (r) { return !q || Calc.bezDiakritiky(r.technik.jmeno).indexOf(q) >= 0; });
    $('#seznam').innerHTML = rows.length ? rows.map(radekTechnika).join('') : '<div class="empty">Nikdo nenalezen</div>';
  };
  $('#hledat').oninput = vypis;
  vypis();
}
// Odznak na ikoně appky (kde to systém umí)
function odznak(n) {
  try { if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(function () {}); } catch (e) { /* nepodporováno */ }
}

function vTechnik(tid) {
  if (!SPRAVCE && tid !== role.technik_id) tid = role.technik_id;
  var t = najdi(S.technici, tid);
  if (!t) return nenalezeno();
  var pol = vsechnyPolozky().filter(function (x) { return x.technik_id === tid; });
  var st = Calc.stavTechnika(pol.map(function (x) { return x.s; }));
  if (!SPRAVCE) odznak(st.k_vyrizeni);
  var html = SPRAVCE ? bar(zpet('#/', 'Přehled'), '<a class="btn-text" href="#/nastaveni/t/' + tid + '">Upravit</a>') : bar('', '');
  html += '<main><div class="hero"><div class="avatar ' + st.stav + '">' + h(t.jmeno.split(' ').map(function (s) { return s[0]; }).join('').slice(0, 2)) + '</div>' +
    '<div><h1>' + h(t.jmeno) + '</h1><div class="sub" id="stav-technika" data-stav="' + st.stav + '">' + dot(st.stav) + ' ' + h(st.popis) + '</div></div></div>' + banner();
  var kat = aktKat(); // stejný filtr jako v Přehledu
  html += segKat(kat);
  kategorie().filter(function (k) { return kat === 'vse' || k[0] === kat; }).forEach(function (k) {
    var v = pol.filter(function (x) { return x.kategorie === k[0]; }).sort(function (a, b) { return Calc.porovnej(a.s, b.s); });
    html += '<h2>' + h(k[1]) + '</h2><section class="group" data-kategorie="' + k[0] + '">' + (v.length ? v.map(function (x) {
      var k2 = aktualniDoklad(x.o.id);
      var sub = x.o.neurcita ? '' : 'platí do ' + Calc.formatDatum(x.o.platnost_do);
      return '<a class="row" href="#/o/' + x.o.id + '" data-druh="' + h(x.druh.nazev) + '">' + thumb(k2) +
        '<div class="info"><div class="t wrap">' + dot(x.s.stav) + h(x.druh.nazev) + '</div><div class="stavradek">' + tag(x.s) +
        '<span class="sub">' + h([sub, x.o.bez_dokladu ? 'bez dokladu' : ''].filter(Boolean).join(' · ')) + '</span></div>' + chips(x.o.vyrobci) + '</div><span class="chev">›</span></a>';
    }).join('') : '<div class="row bez"><span class="dot bez"></span><div class="info"><div class="sub">bez oprávnění</div></div></div>') + '</section>';
  });
  if (SPRAVCE) html += '<div class="actions"><a class="btn primary full" href="#/t/' + tid + '/nove">Přidat oprávnění</a></div>';
  if (!SPRAVCE) html += '<p class="hint" id="prihlasen">Přihlášen jako ' + h(prihlasenJako()) + (DEMO ? ' · <a href="?demo=1">Ukázka: zpět na správce</a>' : '') + '</p>' + (DEMO ? '' : ODHLASIT);
  app.innerHTML = html + paticka() + '</main>';
}

// Po nahrání dokladu bez posunu platnosti se na detailu zeptá „Zrušit objednání?“ (id oprávnění)
var dotazObjednani = null;
function vZaznam(oid) {
  var o = najdi(S.opravneni, oid);
  if (!o || (!SPRAVCE && o.technik_id !== role.technik_id)) return nenalezeno();
  var d = druhOf(o), t = najdi(S.technici, o.technik_id), s = stavZaznamu(o), k = aktualniDoklad(oid);
  var zdroj = o.predstih_dni != null ? 'u záznamu' : (d.predstih_dni != null ? 'z druhu' : 'výchozí');
  var html = bar(zpet('#/t/' + o.technik_id, t.jmeno), SPRAVCE ? '<a class="btn-text" href="#/o/' + oid + '/upravit">Upravit</a>' : '');
  html += '<main><h1 class="mensi">' + h(d.nazev) + '</h1><p class="souhrn">' + h(t.jmeno) + ' · ' + h(nazevKat(d.kategorie)) + '</p>' + tag(s);
  if (SPRAVCE && dotazObjednani === oid && o.objednano_na) {
    html += '<div class="banner dotaz" id="dotazObjednani" role="alertdialog" aria-label="Zrušit objednání?"><b>Zrušit objednání?</b> Doklad je nahraný, ale platnost se neposunula ' +
      '(objednáno na ' + Calc.formatDatum(o.objednano_na) + ').<div class="actions"><button class="btn primary" data-act="zrusitObj" data-id="' + oid + '">Zrušit objednání</button>' +
      '<button class="btn" data-act="ponechatObj">Ponechat</button></div></div>';
  } else if (s.po_terminu) html += '<div class="banner varovani" role="alert">! Termín školení ' + Calc.formatDatum(o.objednano_na) + ' proběhl – nahraj nový doklad nebo změň termín.</div>';
  var radky = [['Vydavatel', o.vydavatel || '–'], ['Číslo dokladu', o.cislo || '–'], ['Vydáno', Calc.formatDatum(o.vydano) || '–'],
    ['Platnost do', o.neurcita ? 'doba neurčitá' : Calc.formatDatum(o.platnost_do)], ['Předstih upozornění', s.predstih + ' dní (' + zdroj + ')']];
  if (o.bez_dokladu) radky.push(['Doklad', 'bez dokladu']);
  if (o.poznamka) radky.push(['Poznámka', o.poznamka]);
  html += '<div class="group" style="margin-top:12px">' + radky.map(function (r) { return '<div class="kv"><span>' + h(r[0]) + '</span><span>' + h(r[1]) + '</span></div>'; }).join('') +
    (o.vyrobci && o.vyrobci.length ? '<div class="kv"><span>Pokrytí výrobci</span>' + chips(o.vyrobci) + '</div>' : '') + '</div>';

  // Objednání školení / zkoušky
  if (o.objednano_na || s.stav === 'predstih' || s.stav === 'propadle') {
    html += '<h2>Objednání</h2>';
    if (o.objednano_na) html += '<div class="group"><div class="kv"><span>Termín</span><span>' + Calc.formatDatum(o.objednano_na) + '</span></div>' +
      (o.objednano_pozn ? '<div class="kv"><span>Kde / rezervace</span><span>' + h(o.objednano_pozn) + '</span></div>' : '') + '</div>';
    if (SPRAVCE) {
      html += '<details class="obj"' + (s.po_terminu ? ' open' : '') + '><summary class="btn">' + (o.objednano_na ? 'Změnit termín…' : 'Objednáno na termín…') + '</summary>' +
        '<form id="frmObj" class="group"><div class="field"><label for="f_obj">Termín</label><input id="f_obj" name="objednano_na" type="date" required value="' + h(o.objednano_na || '') + '"></div>' +
        '<div class="field"><label for="f_objp">Kde / rezervace</label><input id="f_objp" name="objednano_pozn" value="' + h(o.objednano_pozn || '') + '" placeholder="např. rez. č. 1234"></div>' +
        '<div class="err" id="chybaObj"></div><button class="btn primary" type="submit" style="margin:8px 16px 12px">Uložit termín</button></form></details>';
      if (o.objednano_na) html += '<div class="actions"><button class="btn danger full" data-act="zrusitObj" data-id="' + oid + '" data-confirm="Klepni znovu pro zrušení">Zrušit objednání</button></div>';
    }
  }

  html += '<h2>Doklad</h2>';
  if (k) {
    html += '<div class="group doklad">' + (k.typ === 'application/pdf'
      ? '<div class="row">' + thumb(k) + '<div class="info"><div class="t">' + h(k.nazev) + '</div><div class="sub">nahráno ' + Calc.formatDatum(k.nahrano) + '</div></div></div>'
      : '<img class="nahled" id="nahled" src="' + h(dokladUrl[k.path]) + '" alt="náhled dokladu">') +
      '</div><div class="actions"><a class="btn full" href="' + h(dokladUrl[k.path]) + '" target="_blank" rel="noopener">Otevřít doklad</a></div>';
  } else html += '<div class="group"><div class="empty">' + (o.bez_dokladu ? 'Evidováno bez dokladu' : 'Doklad není nahraný') + '</div></div>';
  if (SPRAVCE) html += '<div class="actions"><a class="btn primary full" href="#/o/' + oid + '/upravit#doklad">Nahrát nový doklad</a></div>';
  var arch = S.doklady.filter(function (x) { return x.opravneni_id === oid && !x.aktualni; }).sort(function (a, b) { return a.nahrano < b.nahrano ? 1 : -1; });
  if (arch.length) html += '<h2>Historie dokladů</h2><div class="group" id="historie">' + arch.map(function (x) {
    return '<a class="row" href="' + h(dokladUrl[x.path]) + '" target="_blank" rel="noopener">' + thumb(x) + '<div class="info"><div class="t">' + h(x.nazev) + '</div><div class="sub">nahráno ' + Calc.formatDatum(x.nahrano) + '</div></div><span class="chev">›</span></a>';
  }).join('') + '</div>';
  app.innerHTML = html + paticka() + '</main>';
  var f = $('#frmObj');
  if (f) f.onsubmit = function (e) {
    e.preventDefault();
    var fd = new FormData(f);
    if (!fd.get('objednano_na')) { $('#chybaObj').textContent = 'Zadej datum termínu.'; return; }
    api.ulozZaznam({ id: oid, objednano_na: fd.get('objednano_na'), objednano_pozn: fd.get('objednano_pozn').trim() }).then(render).catch(selhalo);
  };
}

/* ---------- Formuláře ---------- */
function pole(label, name, value, attrs) {
  return '<div class="field"><label for="f_' + name + '">' + label + '</label><input id="f_' + name + '" name="' + name + '" value="' + h(value) + '" ' + (attrs || '') + '></div>';
}
function zaskrt(label, name, checked) {
  return '<div class="field check"><label for="f_' + name + '">' + label + '</label><input type="checkbox" id="f_' + name + '" name="' + name + '"' + (checked ? ' checked' : '') + '></div>';
}
function formular(titul, zpetHref, obsah, extra) {
  return bar(zpet(zpetHref, 'Zrušit'), '<button class="btn-text" form="frm" type="submit" style="font-weight:600">Uložit</button>') +
    '<main><h1>' + titul + '</h1><form id="frm" novalidate>' + obsah + '<div class="err" id="chyba" role="alert"></div>' +
    '<button class="btn primary" type="submit" style="width:100%;margin-top:16px">Uložit</button></form>' + (extra || '') + '</main>';
}
function chyba(t) { $('#chyba').textContent = t; log('validace:', t); }
function cislo(fd, n) { var x = fd.get(n); return x === '' || x == null ? null : Number(x); }

function vFormZaznam(oid, tid) {
  if (!SPRAVCE) return nenalezeno();
  var o = oid ? najdi(S.opravneni, oid) : null;
  if (oid && !o) return nenalezeno();
  var v = o || { technik_id: tid, druh_id: '', vyrobci: [], vydano: dnes };
  var druhy = S.druhy.filter(function (d) { return d.aktivni || d.id === v.druh_id; }).sort(function (a, b) { return a.poradi - b.poradi; });
  var optDruhy = '<option value="">– vyber –</option>' + kategorie().map(function (k) {
    return '<optgroup label="' + k[1] + '">' + druhy.filter(function (d) { return d.kategorie === k[0]; }).map(function (d) {
      return '<option value="' + d.id + '"' + (d.id === v.druh_id ? ' selected' : '') + '>' + h(d.nazev) + '</option>';
    }).join('') + '</optgroup>';
  }).join('');
  var optTech = S.technici.filter(function (t) { return t.aktivni !== false || t.id === v.technik_id; }).map(function (t) {
    return '<option value="' + t.id + '"' + (t.id === v.technik_id ? ' selected' : '') + '>' + h(t.jmeno) + '</option>';
  }).join('');
  var vyrobci = (S.nastaveni.vyrobci || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  (v.vyrobci || []).forEach(function (x) { if (vyrobci.indexOf(x) < 0) vyrobci.push(x); });
  var obsah = '<div class="group"><div class="field"><label for="f_technik_id">Technik</label><select id="f_technik_id" name="technik_id">' + optTech + '</select></div>' +
    '<div class="field"><label for="f_druh_id">Druh *</label><select id="f_druh_id" name="druh_id">' + optDruhy + '</select></div>' +
    pole('Číslo dokladu', 'cislo', v.cislo) + pole('Vydavatel', 'vydavatel', v.vydavatel) + '</div>' +
    '<h2>Platnost</h2><div class="group">' + pole('Datum vydání', 'vydano', v.vydano, 'type="date"') +
    zaskrt('Doba neurčitá', 'neurcita', v.neurcita) + pole('Platnost do', 'platnost_do', v.platnost_do, 'type="date"') +
    pole('Předstih (dny)', 'predstih_dni', v.predstih_dni, 'type="number" inputmode="numeric" min="0" max="730"') + '</div>' +
    '<p class="hint" id="hintPlat"></p>' +
    '<div id="blokVyrobci"><h2>Pokrytí výrobci</h2><div class="group vyrobci">' + vyrobci.map(function (x, i) {
      return '<label class="field check"><span>' + h(x) + '</span><input type="checkbox" name="vyrobci" value="' + h(x) + '" id="f_vyr' + i + '"' + ((v.vyrobci || []).indexOf(x) >= 0 ? ' checked' : '') + '></label>';
    }).join('') + '</div><p class="hint">Seznam výrobců se upravuje v Nastavení.</p></div>' +
    '<h2>Další</h2><div class="group">' + zaskrt('Bez dokladu', 'bez_dokladu', v.bez_dokladu) +
    '<div class="field"><label for="f_poznamka">Poznámka</label><textarea id="f_poznamka" name="poznamka">' + h(v.poznamka) + '</textarea></div></div>' +
    '<h2 id="doklad">Doklad</h2><div class="group"><div class="soubory">' +
    '<label class="btn" for="f_foto">📷 Vyfotit</label><input id="f_foto" type="file" accept="image/*" capture="environment" hidden>' +
    '<label class="btn" for="f_soubor">📄 Nahrát PDF / obrázek</label><input id="f_soubor" type="file" accept="application/pdf,image/*" hidden></div>' +
    '<div id="vybrano"></div>' + (SPRAVCE ? '<div class="soubory"><button type="button" class="btn" data-act="vycistAI" id="btnAI"' +
      (o && aktualniDoklad(o.id) ? '' : ' disabled') + '>' + TEXT_AI + '</button></div>' : '') + '</div>' +
    (SPRAVCE ? '<p class="hint" id="hintAI">' + (o && aktualniDoklad(o.id) ? 'Vyčíst AI přečte vybraný soubor, jinak uložený doklad. ' : 'Pro Vyčíst AI vyber soubor. ') +
      'AI jen navrhne – údaje převezmeš a uložíš sám.</p><div id="aiNavrh" aria-live="polite"></div>' : '') +
    '<p class="hint">' + (o && aktualniDoklad(o.id) ? 'Nový doklad nahradí aktuální, starší zůstane v historii. ' : '') + 'Fotka se zmenší na max. 2000 px, PDF do 10 MB.</p>';
  var extra = o ? '<div class="actions"><button class="btn danger full" data-act="smazatZaznam" data-id="' + o.id + '" data-confirm="Klepni znovu pro smazání">Smazat záznam</button></div>' : '';
  var zpetHref = o ? '#/o/' + o.id : '#/t/' + (tid || '');
  app.innerHTML = formular(o ? 'Upravit oprávnění' : 'Nové oprávnění', zpetHref, obsah, extra);
  if (location.hash.indexOf('#doklad') > 0) setTimeout(function () { var d = $('#doklad'); if (d) d.scrollIntoView(); }, 0);

  var selDruh = $('#f_druh_id'), neur = $('#f_neurcita'), plat = $('#f_platnost_do'), vyd = $('#f_vydano'), vydav = $('#f_vydavatel');
  var minulyDruh = druhOf(v);
  function prepocti() { // platnost do = vydáno + výchozí lhůta druhu (vždy jde přepsat)
    var d = najdi(S.druhy, selDruh.value);
    if (d && d.lhuta_mesicu && vyd.value && !neur.checked) plat.value = Calc.pridejMesice(vyd.value, d.lhuta_mesicu);
  }
  function podleDruhu(zmena) {
    var d = najdi(S.druhy, selDruh.value);
    $('#blokVyrobci').hidden = !(d && d.vice_vyrobcu);
    if (zmena && d) {
      if (!vydav.value || (minulyDruh && vydav.value === minulyDruh.vydavatel)) vydav.value = d.vydavatel || '';
      neur.checked = !!d.neurcita;
      $('#f_predstih_dni').placeholder = 'z druhu ' + Calc.predstih({}, d, S.nastaveni);
      minulyDruh = d;
      prepocti();
    }
    plat.disabled = neur.checked;
    $('#hintPlat').textContent = d ? (d.neurcita ? 'Druh má výchozí platnost na dobu neurčitou.' : 'Platnost se předvyplní podle lhůty druhu (' + (d.lhuta_mesicu || '?') + ' měs.), uprav ji podle dokladu.') : '';
    if (d) $('#f_predstih_dni').placeholder = 'výchozí ' + Calc.predstih({}, d, S.nastaveni);
  }
  selDruh.onchange = function () { podleDruhu(true); };
  vyd.onchange = prepocti;
  neur.onchange = function () { plat.disabled = neur.checked; if (!neur.checked) prepocti(); };
  podleDruhu(false);

  var vybrany = null;
  function vyber(inp) {
    var f = inp.files[0];
    if (!f) return;
    if (f.type === 'application/pdf' && f.size > LIMIT_SOUBORU) { inp.value = ''; return chyba('PDF je větší než 10 MB – zmenši ho nebo vyfoť.'); }
    if (f.type !== 'application/pdf' && f.type.indexOf('image/') !== 0) { inp.value = ''; return chyba('Podporované jsou jen PDF a obrázky.'); }
    chyba('');
    vybrany = f;
    if ($('#btnAI')) $('#btnAI').disabled = false;
    $('#vybrano').innerHTML = '<div class="row" id="vybranySoubor">' + (f.type === 'application/pdf' ? '<div class="thumb pdf">' + PDF_IKONA + '</div>'
      : '<div class="thumb"><img src="' + URL.createObjectURL(f) + '" alt="vybraná fotka"></div>') +
      '<div class="info"><div class="t">' + h(f.name) + '</div><div class="sub">' + Math.round(f.size / 1024) + ' kB · uloží se s formulářem</div></div></div>';
    log('vybrán soubor', f.name, f.type, f.size + ' B');
  }
  $('#f_foto').onchange = function () { vyber(this); };
  $('#f_soubor').onchange = function () { vyber(this); };

  /* AI vyčtení: návrh vedle formuláře, rozdíly zvýrazněné, převzetí po políčkách nebo vše */
  var navrh = null;
  function hodnotaFormu(k) {
    if (k === 'platnost') return neur.checked ? 'neurcita' : (plat.value || null);
    if (k === 'vyrobci') return Array.prototype.map.call(document.querySelectorAll('input[name=vyrobci]:checked'), function (x) { return x.value; }).sort().join(', ') || null;
    var el = $('#f_' + k); return el && el.value.trim() ? el.value.trim() : null;
  }
  function hodnotaAI(k) {
    if (k === 'platnost') return navrh.na_dobu_neurcitou ? 'neurcita' : navrh.platnost_do;
    if (k === 'vyrobci') return (navrh.vyrobci || []).slice().sort().join(', ') || null;
    return navrh[k];
  }
  function zobrazHodnotu(k, x) {
    if (x == null || x === '') return k === 'platnost' ? 'nenalezena' : '–';
    if (k === 'technik_id') { var t = najdi(S.technici, x); return t ? t.jmeno : x; }
    if (k === 'druh_id') { var d = najdi(S.druhy, x); return d ? d.nazev : x; }
    if (x === 'neurcita') return 'doba neurčitá';
    if (k === 'vydano' || k === 'platnost') return Calc.formatDatum(x);
    return x;
  }
  function prevezmi(k) {
    var x = navrh[k];
    if (k === 'technik_id') $('#f_technik_id').value = x;
    else if (k === 'druh_id') { selDruh.value = x; podleDruhu(true); }
    else if (k === 'cislo' || k === 'vydavatel') $('#f_' + k).value = x;
    else if (k === 'vydano') vyd.value = x;
    else if (k === 'platnost') {
      neur.checked = !!navrh.na_dobu_neurcitou; plat.disabled = neur.checked;
      if (!neur.checked) plat.value = navrh.platnost_do;
    } else if (k === 'vyrobci') document.querySelectorAll('input[name=vyrobci]').forEach(function (c) { c.checked = navrh.vyrobci.indexOf(c.value) >= 0; });
  }
  function lzePrevzit(k) { var a = hodnotaAI(k); return a != null && a !== '' && a !== hodnotaFormu(k); }
  function vykresliNavrh() {
    if (!navrh) return;
    var d = najdi(S.druhy, selDruh.value);
    var pole = POLE_AI.filter(function (p) { return p[0] !== 'vyrobci' || (d && d.vice_vyrobcu) || (navrh.vyrobci || []).length; });
    var klice = pole.map(function (p) { return p[0]; }).join(',');
    var box = $('#aiNavrh');
    // Stejná sada řádků → jen aktualizovat texty a třídy. Tlačítka zůstanou stejné prvky, takže klik hned po psaní
    // (opuštění pole vyvolá change → překreslení) se neztratí.
    if (box.dataset.klice !== klice) vykresliKostru(box, pole, klice);
    var rozdilu = 0;
    pole.forEach(function (p) {
      var k = p[0], a = hodnotaAI(k), rozdil = lzePrevzit(k), r = box.querySelector('.ai-radek[data-pole="' + k + '"]');
      if (rozdil) rozdilu++;
      r.classList.toggle('rozdil', rozdil); r.dataset.rozdil = rozdil ? '1' : '0';
      r.querySelector('.ai-f').textContent = zobrazHodnotu(k, hodnotaFormu(k));
      r.querySelector('.ai-a').textContent = zobrazHodnotu(k, a);
      r.querySelector('button').hidden = !rozdil;
      r.querySelector('.ai-shoda').textContent = rozdil || a == null ? '' : '✓';
    });
    box.querySelector('.ai-hlava span').textContent = rozdilu ? 'Rozdílů: ' + rozdilu + ' – zkontroluj a převezmi' : 'Formulář odpovídá návrhu';
    box.querySelector('.ai-hlava button').hidden = !rozdilu;
  }
  function vykresliKostru(box, pole, klice) {
    box.dataset.klice = klice;
    box.innerHTML = '<h2>Návrh AI</h2><div class="group ai">' +
      '<div class="ai-hlava"><span></span><button type="button" class="btn primary" data-act="prevzitVseAI">Převzít vše</button></div>' +
      pole.map(function (p) {
        return '<div class="ai-radek" data-pole="' + p[0] + '"><div class="ai-nazev">' + h(p[1]) + '</div>' +
          '<div class="ai-hodnoty"><div><span class="ai-co">Formulář</span> <span class="ai-f"></span></div>' +
          '<div><span class="ai-co">AI</span> <span class="ai-a"></span></div></div>' +
          '<button type="button" class="btn" data-act="prevzitAI" data-pole="' + p[0] + '">Převzít</button><span class="ai-shoda"></span></div>';
      }).join('') +
      (navrh.jmeno_na_dokladu ? '<div class="kv"><span>Jméno na dokladu</span><span>' + h(navrh.jmeno_na_dokladu) + '</span></div>' : '') +
      (navrh.poznamka ? '<div class="kv"><span>Poznámka AI</span><span>' + h(navrh.poznamka) + '</span></div>' : '') +
      '</div><p class="hint" id="aiZbyva">' + (navrh.zbyva != null ? 'Vyčtení AI zbývá dnes ' + navrh.zbyva + '. ' : '') + 'Nic se neukládá, dokud neklepneš Uložit.</p>';
  }
  $('#frm').addEventListener('input', vykresliNavrh);
  $('#frm').addEventListener('change', vykresliNavrh);
  formAI = {
    prevzit: function (k) { prevezmi(k); log('AI převzato', k); vykresliNavrh(); },
    prevzitVse: function () { // pořadí polí: druh předvyplní vydavatele a platnost, údaje z dokladu je pak přepíšou
      var k = POLE_AI.map(function (p) { return p[0]; }).filter(lzePrevzit);
      k.forEach(prevezmi); log('AI převzato vše', k.length); vykresliNavrh();
    },
    vycist: function (b) {
      b.disabled = true; b.textContent = 'Čtu doklad…'; chyba('');
      $('#aiNavrh').innerHTML = ''; delete $('#aiNavrh').dataset.klice;
      var konec = function () { b.disabled = false; b.textContent = TEXT_AI; };
      var formular = { technik_id: $('#f_technik_id').value, druh_id: selDruh.value };
      var priprav = vybrany ? (vybrany.type === 'application/pdf' ? Promise.resolve(vybrany) : zmensiFoto(vybrany)) : Promise.resolve(null);
      priprav.then(function (blob) {
        if (DEMO) return new Promise(function (res) { setTimeout(function () { demoAiPocet++; res({ navrh: demoAiNavrh(S, formular, dnes), pouziti: { zbyva: Math.max(0, 30 - demoAiPocet) } }); }, 400); });
        var fd = new FormData();
        if (blob) fd.append('soubor', blob, vybrany.type === 'application/pdf' ? 'doklad.pdf' : 'doklad.jpg');
        else fd.append('opravneni_id', o.id);
        return vycistOstry(fd);
      }).then(function (r) {
        konec();
        navrh = Object.assign({}, r.navrh, { zbyva: r.pouziti ? r.pouziti.zbyva : null });
        log('AI návrh ok', 'zbývá', navrh.zbyva);
        vykresliNavrh();
        var el = $('#aiNavrh'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      }).catch(function (e) {
        konec();
        log('AI chyba', e.kod || e.message);
        $('#aiNavrh').innerHTML = '<div class="err" role="alert" id="aiChyba" data-kod="' + h(e.kod || 'neznama') + '">' + h(e.message) +
          (/ručně/.test(e.message) ? '' : ' Údaje vyplň ručně.') + '</div>';
      });
    }
  };

  $('#frm').onsubmit = function (e) {
    e.preventDefault();
    var fd = new FormData(e.target);
    var z = { id: oid || undefined, technik_id: fd.get('technik_id'), druh_id: fd.get('druh_id'), cislo: fd.get('cislo').trim(), vydavatel: fd.get('vydavatel').trim(),
      vydano: fd.get('vydano') || null, neurcita: !!fd.get('neurcita'), platnost_do: neur.checked ? null : plat.value || null,
      predstih_dni: cislo(fd, 'predstih_dni'), bez_dokladu: !!fd.get('bez_dokladu'), poznamka: fd.get('poznamka').trim() };
    var d = najdi(S.druhy, z.druh_id);
    z.vyrobci = d && d.vice_vyrobcu ? fd.getAll('vyrobci') : [];
    if (!z.technik_id || !z.druh_id) return chyba('Vyber technika a druh oprávnění.');
    if (!z.neurcita && !z.platnost_do) return chyba('Zadej platnost do, nebo zaškrtni dobu neurčitou.');
    if (z.vydano && z.platnost_do && z.platnost_do < z.vydano) return chyba('Platnost do je dřív než datum vydání.');
    if (vybrany) z.bez_dokladu = false;
    var tlacitka = document.querySelectorAll('button[type=submit]');
    var zamkni = function (ano) { tlacitka.forEach(function (b) { b.disabled = ano; }); };
    zamkni(true);
    chyba(vybrany ? 'Ukládám a nahrávám doklad…' : '');
    var ulozeny = null;
    var puvodni = o ? { platnost_do: o.platnost_do, neurcita: o.neurcita } : null; // platnost před úpravou
    (vybrany && vybrany.type !== 'application/pdf' ? zmensiFoto(vybrany) : Promise.resolve(vybrany))
      .then(function (blob) {
        return api.ulozZaznam(z).then(function (ul) {
          ulozeny = ul;
          if (!blob) return;
          return api.pridejDoklad(ul.id, blob, vybrany.type === 'application/pdf' ? vybrany.name : 'foto-dokladu.jpg').then(function () {
            if (!ul.objednano_na) return null;
            // Objednáno zrušit jen s novou (pozdější) platností; jinak se na detailu zeptat
            if (Calc.platnostPosunuta(puvodni, ul)) return api.ulozZaznam({ id: ul.id, objednano_na: null, objednano_pozn: '' });
            dotazObjednani = ul.id;
            log('Objednáno ponecháno – platnost se neposunula, dotaz na detailu');
            return null;
          });
        });
      })
      .then(function () { location.hash = '#/o/' + ulozeny.id; })
      .catch(function (err) {
        zamkni(false);
        // záznam se uložil, jen doklad ne → při dalším uložení už jde o úpravu
        if (ulozeny && !oid) { oid = ulozeny.id; z.id = ulozeny.id; }
        chyba('Uložení selhalo: ' + err.message + (ulozeny ? ' (údaje oprávnění jsou uložené, doklad ne)' : ''));
        logChyba(err.message);
      });
  };
}

var TEXT_AI = '✨ Vyčíst AI';
var POLE_AI = [['technik_id', 'Technik'], ['druh_id', 'Druh'], ['cislo', 'Číslo dokladu'], ['vydavatel', 'Vydavatel'], ['vydano', 'Datum vydání'], ['platnost', 'Platnost do'], ['vyrobci', 'Výrobci']];
var formAI = null, demoAiPocet = 0;
// Volání Edge Function s JWT přihlášeného správce; chyby vrací s českou hláškou z funkce
function vycistOstry(fd) {
  return sb.auth.getSession().then(function (r) {
    var token = r.data && r.data.session && r.data.session.access_token;
    if (!token) throw Object.assign(new Error('Nejsi přihlášený – přihlas se znovu.'), { kod: 'neprihlasen' });
    return fetch(FUNKCE_AI, { method: 'POST', headers: { Authorization: 'Bearer ' + token, apikey: SUPABASE_KEY }, body: fd }).catch(function () {
      throw Object.assign(new Error('Nepodařilo se spojit se serverem – zkus to znovu, nebo vyplň údaje ručně.'), { kod: 'sit' });
    });
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (b) {
      log('AI HTTP', res.status, b.chyba || 'ok');
      if (!res.ok || !b.navrh) throw Object.assign(new Error(b.zprava || 'Vyčtení se nepovedlo (HTTP ' + res.status + ') – vyplň údaje ručně.'), { kod: b.chyba || 'http' + res.status });
      return b;
    });
  });
}

// Zmenší fotku: delší strana max. 2000 px, JPEG 0,8 (cca 200–400 kB)
function zmensiFoto(file) {
  return new Promise(function (res, rej) {
    var img = new Image(), u = URL.createObjectURL(file);
    img.onload = function () {
      var k = Math.min(1, 2000 / Math.max(img.width, img.height));
      var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      c.toBlob(function (b) { if (b) { log('fotka zmenšena', c.width + '×' + c.height, Math.round(b.size / 1024) + ' kB'); res(b); } else rej(new Error('Fotku nejde zmenšit')); }, 'image/jpeg', 0.8);
    };
    img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('Soubor není čitelný obrázek')); };
    img.src = u;
  });
}

function vFormTechnik(tid) {
  if (!SPRAVCE) return nenalezeno();
  var t = tid ? najdi(S.technici, tid) : null;
  if (tid && !t) return nenalezeno();
  var v = t || { aktivni: true };
  var obsah = '<div class="group">' + pole('Jméno *', 'jmeno', v.jmeno, 'required autocomplete="off"') +
    pole('E-mail', 'email', v.email, 'type="email" inputmode="email" autocomplete="off" placeholder="pro upozornění"') + zaskrt('Aktivní', 'aktivni', v.aktivni !== false) + '</div>' +
    '<h2>Účet v appce</h2><div class="group">' + (DEMO ? pole('Propojený účet', 'ucet', v.ucet, 'type="email" autocomplete="off" placeholder="nepropojeno"')
      : '<div class="kv"><span>Propojený účet</span><span id="ucet">' + (v.ucet ? 'ano' : 'ne') + '</span></div>') + '</div>' +
    '<p class="hint">Technik může být v evidenci i bez účtu. Propojený účet vidí jen svou sekci a nic needituje.' +
    (DEMO ? '' : ' Účet zatím propojuje správce projektu v Supabase (vzor sql/lokalni/001b_pristup.sql).') + '</p>';
  app.innerHTML = formular(t ? 'Upravit technika' : 'Nový technik', t ? '#/t/' + t.id : '#/nastaveni', obsah);
  $('#frm').onsubmit = function (e) {
    e.preventDefault();
    var fd = new FormData(e.target);
    var o = { id: tid || undefined, jmeno: fd.get('jmeno').trim(), email: fd.get('email').trim(), aktivni: !!fd.get('aktivni') };
    if (DEMO) o.ucet = fd.get('ucet').trim() || null;
    if (!o.jmeno) return chyba('Vyplň jméno.');
    if (o.email && !/^\S+@\S+\.\S+$/.test(o.email)) return chyba('E-mail nevypadá správně.');
    api.ulozTechnika(o).then(function (ul) { location.hash = '#/t/' + ul.id; }).catch(selhalo);
  };
}

function vFormDruh(did) {
  if (!SPRAVCE) return nenalezeno();
  var d = did ? najdi(S.druhy, did) : null;
  if (did && !d) return nenalezeno();
  var v = d || { aktivni: true, kategorie: 'ppk', lhuta_mesicu: 24, poradi: S.druhy.length };
  var obsah = '<div class="group">' + pole('Název *', 'nazev', v.nazev, 'required') +
    '<div class="field"><label for="f_kategorie">Kategorie</label><select id="f_kategorie" name="kategorie">' + kategorie().map(function (k) {
      return '<option value="' + k[0] + '"' + (k[0] === v.kategorie ? ' selected' : '') + '>' + k[1] + '</option>';
    }).join('') + '</select></div>' + pole('Vydavatel', 'vydavatel', v.vydavatel) +
    '<div class="field"><label for="f_popis">Popis rozsahu</label><textarea id="f_popis" name="popis">' + h(v.popis) + '</textarea></div></div>' +
    '<h2>Výchozí hodnoty</h2><div class="group">' + zaskrt('Doba neurčitá', 'neurcita', v.neurcita) +
    pole('Lhůta platnosti (měsíce)', 'lhuta_mesicu', v.lhuta_mesicu, 'type="number" inputmode="numeric" min="1" max="240"') +
    pole('Předstih (dny)', 'predstih_dni', v.predstih_dni, 'type="number" inputmode="numeric" min="0" max="730" placeholder="globální ' + Calc.predstih({}, {}, S.nastaveni) + '"') +
    zaskrt('Pokrytí více výrobců', 'vice_vyrobcu', v.vice_vyrobcu) + zaskrt('Aktivní', 'aktivni', v.aktivni) +
    pole('Pořadí', 'poradi', v.poradi, 'type="number" inputmode="numeric"') + '</div>' +
    '<p class="hint">Lhůty v ukázce jsou orientační – doplň skutečné podle dokladů vydavatele.</p>';
  app.innerHTML = formular(d ? 'Upravit druh' : 'Nový druh', '#/nastaveni', obsah);
  $('#frm').onsubmit = function (e) {
    e.preventDefault();
    var fd = new FormData(e.target);
    var o = { id: did || undefined, nazev: fd.get('nazev').trim(), kategorie: fd.get('kategorie'), vydavatel: fd.get('vydavatel').trim(), popis: fd.get('popis').trim(),
      neurcita: !!fd.get('neurcita'), lhuta_mesicu: cislo(fd, 'lhuta_mesicu'), predstih_dni: cislo(fd, 'predstih_dni'),
      vice_vyrobcu: !!fd.get('vice_vyrobcu'), aktivni: !!fd.get('aktivni'), poradi: cislo(fd, 'poradi') || 0 };
    if (!o.nazev) return chyba('Vyplň název.');
    if (!o.neurcita && !o.lhuta_mesicu) return chyba('Zadej lhůtu v měsících, nebo zaškrtni dobu neurčitou.');
    api.ulozDruh(o).then(function () { location.hash = '#/nastaveni'; }).catch(selhalo);
  };
}

// Kategorie: kód je zároveň hodnota ?kat= a vazba druhů, proto se po založení nemění
function vFormKategorie(kid) {
  if (!SPRAVCE) return nenalezeno();
  var k = kid ? najdi(S.kategorie, kid) : null;
  if (kid && !k) return nenalezeno();
  var v = k || { poradi: S.kategorie.length + 1 };
  var obsah = '<div class="group">' + pole('Název *', 'nazev', v.nazev, 'required') +
    pole('Kód pro odkaz *', 'id', v.id, (k ? 'readonly ' : '') + 'autocapitalize="off" autocomplete="off" placeholder="např. chlazeni"') +
    pole('Pořadí', 'poradi', v.poradi, 'type="number" inputmode="numeric"') + '</div>' +
    '<p class="hint">Kód se použije v odkazu ?kat=… (malá písmena bez diakritiky a čísla). Po založení ho nejde změnit.</p>';
  app.innerHTML = formular(k ? 'Upravit kategorii' : 'Nová kategorie', '#/nastaveni', obsah);
  $('#frm').onsubmit = function (e) {
    e.preventDefault();
    var fd = new FormData(e.target);
    var o = { id: k ? k.id : fd.get('id').trim(), nazev: fd.get('nazev').trim(), poradi: cislo(fd, 'poradi') || 0 };
    if (!o.nazev) return chyba('Vyplň název.');
    if (!k && !/^[a-z0-9]{2,20}$/.test(o.id)) return chyba('Kód: 2–20 malých písmen bez diakritiky nebo čísel.');
    if (!k && (o.id === 'vse' || najdi(S.kategorie, o.id))) return chyba('Tento kód už existuje.');
    api.ulozKategorii(o, !k).then(function () { location.hash = '#/nastaveni'; }).catch(selhalo);
  };
}

// Výsledek posledního testovacího běhu (všechny řádky se stejným časem = jeden běh skriptu)
function posledniTest() {
  var log = (S.testLog || []).slice().sort(function (a, b) { return a.cas < b.cas ? 1 : -1; });
  var html = '<div class="group" id="posledniTest">';
  if (!log.length) html += '<div class="empty">Zatím žádný testovací e-mail</div>';
  else {
    var cas = log[0].cas, beh = log.filter(function (r) { return r.cas === cas; });
    var d = new Date(cas);
    html += '<div class="kv"><span>Poslední test</span><span>' + h(d.toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</span></div>' +
      beh.map(function (r) {
        return '<div class="kv" data-stav="' + h(r.stav) + '"><span>' + h(r.prijemce) + '</span><span class="tag ' + (r.stav === 'ok' ? 'platne' : 'propadle') + '">' +
          (r.stav === 'ok' ? 'ok' : 'chyba') + '</span></div>' + (r.chyba ? '<div class="hint err-radek">' + h(r.chyba) + '</div>' : '');
      }).join('');
  }
  return html + '</div>' + (DEMO ? '' : '<div class="actions"><button class="btn full" type="button" data-act="obnovitTest">Obnovit výsledek</button></div>');
}

function vNastaveni() {
  if (!SPRAVCE) return nenalezeno();
  var n = S.nastaveni;
  var html = bar(zpet('#/', 'Přehled'), '') + '<main><h1>Nastavení</h1>' + banner();
  html += '<h2>Upozornění</h2><form id="frmNast"><div class="group">' +
    pole('Výchozí předstih (dny)', 'predstih_dni', n.predstih_dni != null ? n.predstih_dni : Calc.VYCHOZI_PREDSTIH, 'type="number" inputmode="numeric" min="0" max="730"') +
    pole('Příjemci souhrnu', 'prijemci', n.prijemci, 'type="text" inputmode="email" placeholder="e-maily oddělené čárkou"') +
    '<div class="field"><label for="f_vyrobci">Výrobci pro pokrytí</label><textarea id="f_vyrobci" name="vyrobci">' + h(n.vyrobci) + '</textarea></div></div>' +
    '<div class="err" id="chyba" role="alert"></div><div class="actions"><button class="btn primary full" type="submit">Uložit</button></div>' +
    '<p class="hint" id="zprava" role="status"></p></form>' +
    '<h2>Testovací e-mail</h2><div class="actions"><a class="btn full" id="testEmail" href="' + WORKFLOW_URL + '" target="_blank" rel="noopener">Poslat testovací e-mail</a></div>' +
    '<p class="hint">Spustí se na GitHubu: Run workflow → režim test. E-mail dorazí do 1–2 min.</p>' + posledniTest();
  html += '<h2>Technici</h2><div class="group">' + S.technici.map(function (t) {
    return '<a class="row" href="#/nastaveni/t/' + t.id + '"><div class="info"><div class="t">' + h(t.jmeno) + (t.aktivni === false ? ' <span class="tag neurcita">neaktivní</span>' : '') +
      '</div><div class="sub">' + h(t.email || 'bez e-mailu') + ' · ' + (t.ucet ? 'účet propojen' : 'bez účtu') + '</div></div><span class="chev">›</span></a>';
  }).join('') + '<a class="row pridat" href="#/nastaveni/t/novy">+ Přidat technika</a></div>';
  html += '<h2>Kategorie</h2><div class="group" id="kategorie">' + kategorie().map(function (k) {
    var pocet = S.druhy.filter(function (d) { return d.kategorie === k[0]; }).length;
    return '<a class="row" href="#/nastaveni/k/' + h(k[0]) + '" data-kat="' + h(k[0]) + '"><div class="info"><div class="t">' + h(k[1]) + '</div><div class="sub">odkaz ?kat=' + h(k[0]) + ' · ' + pocet + ' druhů</div></div><span class="chev">›</span></a>';
  }).join('') + '<a class="row pridat" href="#/nastaveni/k/nova">+ Přidat kategorii</a></div>';
  html += '<h2>Katalog druhů oprávnění</h2>';
  kategorie().forEach(function (k) {
    var v = S.druhy.filter(function (d) { return d.kategorie === k[0]; }).sort(function (a, b) { return a.poradi - b.poradi; });
    html += '<h2 class="pod">' + h(k[1]) + '</h2><div class="group">' + (v.length ? v.map(function (d) {
      var sub = [d.neurcita ? 'doba neurčitá' : 'lhůta ' + d.lhuta_mesicu + ' měs.', 'předstih ' + Calc.predstih({}, d, n) + ' dní'];
      if (d.vice_vyrobcu) sub.push('více výrobců');
      return '<a class="row' + (d.aktivni ? '' : ' tlumeny') + '" href="#/nastaveni/d/' + d.id + '" data-druh="' + h(d.nazev) + '"><div class="info"><div class="t">' + h(d.nazev) + (d.aktivni ? '' : ' (neaktivní)') +
        '</div><div class="sub">' + h(sub.join(' · ')) + '</div></div><span class="chev">›</span></a>';
    }).join('') : '<div class="empty">Žádné druhy</div>') + '</div>';
  });
  html += '<div class="group" style="margin-top:12px"><a class="row pridat" href="#/nastaveni/d/novy">+ Přidat druh</a></div>';
  html += '<h2>Účet</h2><div class="group"><div class="kv"><span>Přihlášen jako</span><span id="prihlasen">' + h(prihlasenJako()) + '</span></div>' +
    (DEMO ? '<div class="field"><label for="f_jako">Ukázka: zobrazit jako</label><select id="f_jako"><option value="">Správce</option>' +
      S.technici.map(function (t) { return '<option value="' + t.id + '">' + h(t.jmeno) + ' (technik)</option>'; }).join('') + '</select></div>' : '') +
    '<div class="kv"><span>Verze</span><span>' + VERZE + '</span></div></div>' + (DEMO ? '' : ODHLASIT);
  app.innerHTML = html + paticka() + '</main>';
  $('#frmNast').onsubmit = function (e) {
    e.preventDefault();
    var fd = new FormData(e.target);
    var p = cislo(fd, 'predstih_dni');
    if (p == null || p < 0) return chyba('Zadej výchozí předstih ve dnech.');
    api.ulozNastaveni({ predstih_dni: p, prijemci: fd.get('prijemci').trim(), vyrobci: fd.get('vyrobci').trim() })
      .then(function () { chyba(''); $('#zprava').textContent = 'Uloženo.'; log('nastavení uloženo'); }).catch(selhalo);
  };
  var jako = $('#f_jako');
  if (jako) jako.onchange = function () { location.href = '?demo=1' + (DEBUG ? '&debug=1' : '') + (jako.value ? '&jako=' + jako.value : ''); };
}

function nenalezeno() { app.innerHTML = bar(zpet('#/', 'Přehled')) + '<main><h1>Nenalezeno</h1><div class="empty">Záznam neexistuje nebo k němu nemáš přístup.</div></main>'; }

function vPrihlaseni() {
  app.innerHTML = '<main><h1>Oprávnění</h1><form id="frm" novalidate><div class="group">' +
    pole('E-mail', 'email', '', 'type="email" autocomplete="username" autocapitalize="none" inputmode="email" required') +
    pole('Heslo', 'heslo', '', 'type="password" autocomplete="current-password" required') + '</div>' +
    '<div class="err" id="chyba" role="alert"></div><button class="btn primary" type="submit" style="width:100%;margin-top:16px">Přihlásit</button></form>' +
    '<p class="hint">Účet zakládá správce. <a href="?demo=1">Otevřít ukázku</a></p>' + paticka() + '</main>';
  $('#frm').onsubmit = function (e) {
    e.preventDefault();
    var f = new FormData(e.target), email = f.get('email').trim(), heslo = f.get('heslo');
    if (!email || !heslo) return chyba('Vyplň e-mail a heslo.');
    if (!sb) return chyba('Knihovna přihlášení se nenačetla – obnov stránku, až budeš online.');
    var btn = e.target.querySelector('button'); btn.disabled = true;
    var predchozi = odhlasovani || overovani;
    chyba(predchozi ? 'Dokončuji předchozí odhlášení… Kdyby to trvalo déle než půl minuty, obnov stránku.' : '');
    var moje;
    Promise.all([odhlasovani, overovani]).then(function () {
      moje = relace;
      return sb.auth.signInWithPassword({ email: email, password: heslo });
    }).then(function (r) {
      log('přihlášení', r.error ? (r.error.status + ' ' + r.error.message) : 'ok');
      if (r.error) throw new Error(/invalid login|invalid_credentials/i.test(r.error.message + ' ' + r.error.code) ? 'Špatný e-mail nebo heslo.' : prelozChybu(r.error));
      return sb.auth.getSession().then(function (s) {
        if (!s.data.session) { // bez session by dotazy šly jako anon (42501 permission denied)
          logChyba('session se neuložila');
          throw new Error('prohlížeč neuložil přihlášení. Povol pro tuto stránku ukládání dat (může ho blokovat antivir) a zkus to znovu.');
        }
        if (moje !== relace) throw new Error('mezitím proběhlo odhlášení, přihlas se znovu.');
        uzivatel = r.data.user;
        return nactiData();
      });
    }).then(function () { if (moje === relace) { location.hash = '#/'; render(); } })
      .catch(function (err) { btn.disabled = false; chyba('Přihlášení se nepovedlo: ' + err.message); });
  };
}
function vBezPristupu() {
  app.innerHTML = '<main><h1>Oprávnění</h1><div class="err" role="alert" id="bezPristupu">Účet ' + h(uzivatel.email) + ' nemá přístup k appce Oprávnění. ' +
    'Požádej správce o přidání „opravneni“ do profilu.</div>' + ODHLASIT + paticka() + '</main>';
}

/* ---------- Akce ---------- */
var AKCE = {
  kat: function (b) { nastavKat(b.dataset.v); render(); },
  zrusitObj: function (b) { dotazObjednani = null; api.ulozZaznam({ id: b.dataset.id, objednano_na: null, objednano_pozn: '' }).then(render).catch(selhalo); },
  ponechatObj: function () { dotazObjednani = null; render(); },
  smazatZaznam: function (b) {
    var o = najdi(S.opravneni, b.dataset.id);
    api.smazZaznam(b.dataset.id).then(function () { location.hash = '#/t/' + o.technik_id; }).catch(selhalo);
  },
  obnovitTest: function (b) {
    b.disabled = true;
    nactiTestLog().then(function (r) { S.testLog = r; render(); }).catch(selhalo);
  },
  vycistAI: function (b) { if (SPRAVCE && formAI) formAI.vycist(b); },
  prevzitAI: function (b) { if (formAI) formAI.prevzit(b.dataset.pole); },
  prevzitVseAI: function () { if (formAI) formAI.prevzitVse(); },
  odhlasit: function (b) { if (odhlasovani) return; b.disabled = true; b.textContent = 'Odhlašuji…'; odhlasit(); }
};
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-act]');
  if (!b || b.disabled || b.tagName === 'SELECT') return;
  e.preventDefault();
  if (b.dataset.confirm && !b.classList.contains('confirm')) { // potvrzení dvojím klepnutím
    var puvodni = b.textContent;
    b.classList.add('confirm'); b.textContent = b.dataset.confirm;
    setTimeout(function () { b.classList.remove('confirm'); b.textContent = puvodni; }, 3000);
    return;
  }
  log('akce', b.dataset.act);
  AKCE[b.dataset.act](b);
});

function render() {
  if (!DEMO && uzivatel && pristup && podepsanoCas && Date.now() - podepsanoCas > 50 * 60 * 1000) {
    podepsanoCas = 0; podepisDoklady().then(render); return;
  }
  var cesta = location.hash.replace(/^#\/?/, '').split('#')[0].split('?')[0].split('/');
  log('route', cesta.join('/') || 'prehled');
  try {
    if (!DEMO && startStav) vStart();
    else if (!DEMO && !uzivatel) vPrihlaseni();
    else if (!DEMO && !pristup) vBezPristupu();
    else if (cesta[0] === 't' && cesta[2] === 'nove') vFormZaznam(null, cesta[1]);
    else if (cesta[0] === 't') vTechnik(cesta[1]);
    else if (cesta[0] === 'o' && cesta[2] === 'upravit') vFormZaznam(cesta[1]);
    else if (cesta[0] === 'o') vZaznam(cesta[1]);
    else if (cesta[0] === 'nastaveni' && cesta[1] === 't') vFormTechnik(cesta[2] === 'novy' ? null : cesta[2]);
    else if (cesta[0] === 'nastaveni' && cesta[1] === 'k') vFormKategorie(cesta[2] === 'nova' ? null : cesta[2]);
    else if (cesta[0] === 'nastaveni' && cesta[1] === 'd') vFormDruh(cesta[2] === 'novy' ? null : cesta[2]);
    else if (cesta[0] === 'nastaveni') vNastaveni();
    else vPrehled();
    var zvolena = document.querySelector('.seg.kat [aria-pressed="true"]');
    if (zvolena) zvolena.parentNode.scrollLeft = zvolena.offsetLeft - zvolena.parentNode.offsetLeft - 8;
  } catch (e) { logChyba(e.stack || e.message); app.innerHTML = '<main><h1>Chyba</h1><div class="err">' + h(e.message) + '</div></main>'; }
}
window.addEventListener('hashchange', function () { render(); if (location.hash.indexOf('#doklad') < 0) window.scrollTo(0, 0); });

log('verze', VERZE, DEMO ? 'demo' : 'ostrý', 'dnes', dnes);
start(); // ?kat=ppk|vyrobci|fplyny|elektro se nastaví po načtení dat (kategorie jsou z katalogu)
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function (e) { logChyba('SW: ' + e.message); });
