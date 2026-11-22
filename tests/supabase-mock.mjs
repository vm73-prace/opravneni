// Napodobené Supabase pro Playwright: přihlášení heslem, PostgREST pro schéma opravneni (v paměti) s pravidly
// jako RLS v sql/001_init.sql (správce vše, technik jen čte svou sekci, bez přístupu nic), supabase-js z node_modules.
// Testy tak nesahají na síť ani na produkční data.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const UMD = readFileSync(new URL('../node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url));
export const HESLO = 'spravne-heslo';
export const UCTY = {
  spravce: { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'spravce@example.cz' },
  technik: { id: 'aaaaaaaa-0000-4000-8000-000000000002', email: 'technik@example.cz' },
  bez: { id: 'aaaaaaaa-0000-4000-8000-000000000003', email: 'bez@example.cz' }
};
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ucetPodleEmailu = (e) => Object.values(UCTY).find((u) => u.email === e);
const ucetPodleId = (id) => Object.values(UCTY).find((u) => u.id === id);

function session(u, sid = randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const user = { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const token = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, session_id: sid }) + '.podpis';
  return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'obnova-' + u.id, user };
}
const obsahJwt = (h) => {
  const t = (h.authorization || '').replace('Bearer ', '').split('.')[1];
  try { return JSON.parse(Buffer.from(t, 'base64url').toString()); } catch { return {}; }
};
const kdoJe = (h) => ucetPodleId(obsahJwt(h).sub) || null;

// Výchozí obsah jako po migraci 001 (zkrácený katalog) + volitelná data testu
export function vychoziStore() {
  return {
    kategorie: [{ id: 'ppk', nazev: 'PPK', poradi: 1 }, { id: 'vyrobci', nazev: 'Výrobci', poradi: 2 }, { id: 'fplyny', nazev: 'F-plyny', poradi: 3 }, { id: 'elektro', nazev: 'Elektro', poradi: 4 }],
    druhy: [
      { id: 'd-mandik', kategorie: 'ppk', nazev: 'Mandík – požární klapky', vydavatel: 'MANDÍK, a.s.', popis: '', lhuta_mesicu: 24, neurcita: false, predstih_dni: null, vice_vyrobcu: false, aktivni: true, poradi: 1 },
      { id: 'd-svadlenka', kategorie: 'ppk', nazev: 'Ing. Švadlenka – PBZ více výrobců', vydavatel: 'Ing. Švadlenka', popis: '', lhuta_mesicu: 24, neurcita: false, predstih_dni: null, vice_vyrobcu: true, aktivni: true, poradi: 2 },
      { id: 'd-daikin', kategorie: 'vyrobci', nazev: 'Daikin – tepelná čerpadla', vydavatel: 'Daikin', popis: '', lhuta_mesicu: 24, neurcita: false, predstih_dni: 120, vice_vyrobcu: false, aktivni: true, poradi: 3 },
      { id: 'd-fplyny', kategorie: 'fplyny', nazev: 'F-plyny – certifikát kat. I/II', vydavatel: 'Certifikační subjekt', popis: '', lhuta_mesicu: null, neurcita: true, predstih_dni: null, vice_vyrobcu: false, aktivni: true, poradi: 4 },
      { id: 'd-par6', kategorie: 'elektro', nazev: '§ 6 – osoba znalá', vydavatel: 'Externí zkušební subjekt', popis: '', lhuta_mesicu: 60, neurcita: false, predstih_dni: null, vice_vyrobcu: false, aktivni: true, poradi: 5 }
    ],
    technici: [], opravneni: [], doklady: [],
    soubory: {}, // Storage bucket opravneni-doklady: cesta -> { body: Buffer, typ }
    selhani: {}, // { doklady: true } = zápis řádku dokladu selže (test úklidu); { logout / user: true } = výpadek Auth
    odhlaseni: new Set(), // účty odhlášené na serveru (signOut ruší všechna sezení účtu)
    nastaveni: [{ id: 1, predstih_dni: 90, prijemci: '', vyrobci: 'Mandík, Systemair, Elektrodesign' }],
    uzivatele: [{ user_id: UCTY.spravce.id, role: 'spravce', technik_id: null }],
    upozorneni_log: [], // zapisuje skript na GitHubu; správce čte
    // Edge Function opravneni-vycteni: odpověď (status, tělo) a zaznamenaná volání
    ai: { status: 200, body: { navrh: { technik_id: null, druh_id: 'd-mandik', jmeno_na_dokladu: 'Karel Doklad', cislo: 'MK-AI-2026', vydavatel: 'MANDÍK, a.s.',
      vydano: '2026-10-01', platnost_do: '2028-10-01', na_dobu_neurcitou: false, vyrobci: [], poznamka: null },
      pouziti: { pocet: 3, limit: 30, zbyva: 27, tokeny_vstup: 1800, tokeny_vystup: 240, cena_usd: 0.0003, model: 'claude-haiku-5-5' } } },
    aiVolani: []
  };
}

// supabase-js posílá Blob jako multipart/form-data (pole cacheControl + soubor) – vybere část se souborem
function rozbalUpload(buf, typ) {
  const m = /boundary=(.+)$/.exec(typ);
  if (!m) return { body: buf, typ };
  const hranice = Buffer.from('--' + m[1]);
  let i = buf.indexOf(hranice);
  while (i >= 0) {
    const dalsi = buf.indexOf(hranice, i + hranice.length);
    if (dalsi < 0) break;
    const cast = buf.subarray(i + hranice.length + 2, dalsi - 2); // bez CRLF kolem
    const konecHlavicek = cast.indexOf('\r\n\r\n');
    const hlavicky = cast.subarray(0, konecHlavicek).toString();
    const ct = /content-type:\s*([^\r\n]+)/i.exec(hlavicky);
    if (ct) return { body: Buffer.from(cast.subarray(konecHlavicek + 4)), typ: ct[1].trim() };
    i = dalsi;
  }
  return { body: buf, typ };
}

export async function mockSupabase(page, store = vychoziStore()) {
  const hlavicky = []; // Accept-Profile / Content-Profile všech REST dotazů
  const ctx = page.context();
  await ctx.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@*/**', (r) => r.fulfill({ body: UMD, contentType: 'application/javascript' }));
  await ctx.route('https://pqehuuamgecmdmrdhmza.supabase.co/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), m = req.method(), h = req.headers();
    const json = (status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

    if (url.pathname === '/auth/v1/token') {
      const b = req.postDataJSON(), u = ucetPodleEmailu(b.email);
      if (!u || b.password !== HESLO) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      store.odhlaseni.delete(u.id);
      return json(200, session(u));
    }
    // Jako produkce: odhlášení zruší sezení na serveru, JWT ale REST bere dál až do vypršení
    if (url.pathname === '/auth/v1/logout') {
      if (store.selhani.logout) return json(500, { code: 500, msg: 'výpadek' });
      const u = kdoJe(h);
      if (u) store.odhlaseni.add(u.id);
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (url.pathname === '/auth/v1/user') {
      if (store.selhani.user) return json(503, { code: 503, msg: 'výpadek' });
      const u = kdoJe(h);
      if (!u) return json(401, { code: 401, error_code: 'no_authorization', msg: 'This endpoint requires a valid Bearer token' });
      if (store.odhlaseni.has(u.id)) return json(403, { code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' });
      return json(200, session(u, obsahJwt(h).session_id).user);
    }

    const u = kdoJe(h);
    const smi = !!u && u !== UCTY.bez;
    const spravce = smi && store.uzivatele.some((x) => x.user_id === u.id && x.role === 'spravce');
    const mujTechnik = smi ? (store.uzivatele.find((x) => x.user_id === u.id && x.role === 'technik') || {}).technik_id || null : null;

    // Edge Function opravneni-vycteni: správce dostane store.ai (výchozí návrh), jinak 403 jako skutečná funkce
    if (url.pathname === '/functions/v1/opravneni-vycteni') {
      const telo = req.postDataBuffer() || Buffer.alloc(0);
      store.aiVolani.push({ auth: h.authorization || '', apikey: h.apikey || '', typ: h['content-type'] || '', telo: telo.toString('latin1') });
      if (!u) return json(401, { chyba: 'neprihlasen', zprava: 'Nejsi přihlášený – přihlas se znovu.' });
      if (!spravce) return json(403, { chyba: 'jen_spravce', zprava: 'Vyčíst AI může jen správce.' });
      return json(store.ai.status, store.ai.body);
    }

    // Storage: bucket opravneni-doklady s pravidly jako politiky v 001_init.sql
    const B = 'opravneni-doklady';
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const zbytek = decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length));
      const smiCist = (p) => spravce || (mujTechnik && p.split('/')[0] === mujTechnik);
      if (zbytek.startsWith('sign/')) {
        const cil = zbytek.slice(5);
        if (m === 'GET') { // stažení přes podepsanou URL (bez přihlášení, jen token v adrese)
          const p = cil.slice(B.length + 1), f = store.soubory[p];
          return f && url.searchParams.get('token') ? route.fulfill({ status: 200, headers: CORS, body: f.body, contentType: f.typ }) : json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        }
        const b = req.postDataJSON();
        if (b.paths) return json(200, b.paths.map((p) => (store.soubory[p] && smiCist(p))
          ? { path: p, signedURL: `/object/sign/${B}/${p}?token=t`, error: null }
          : { path: p, signedURL: null, error: 'Either the object does not exist or you do not have access to it' }));
        const p = cil.slice(B.length + 1);
        return store.soubory[p] && smiCist(p) ? json(200, { signedURL: `/object/sign/${cil}?token=t` }) : json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      }
      if (m === 'POST') {
        const p = zbytek.slice(B.length + 1);
        if (!spravce) return json(400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
        if (store.soubory[p]) return json(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
        store.soubory[p] = rozbalUpload(req.postDataBuffer() || Buffer.alloc(0), h['content-type'] || '');
        return json(200, { Id: randomUUID(), Key: zbytek });
      }
      if (m === 'DELETE') {
        if (!spravce) return json(200, []);
        const smazane = req.postDataJSON().prefixes.filter((p) => store.soubory[p]);
        smazane.forEach((p) => delete store.soubory[p]);
        return json(200, smazane.map((p) => ({ name: p })));
      }
    }

    const cesta = url.pathname.replace('/rest/v1/', '');
    hlavicky.push(m === 'GET' ? h['accept-profile'] : h['content-profile']);
    // anon jako produkce: po migraci 002 má USAGE na schéma, takže zamítá až tabulka / funkce
    if (!u) {
      const co = cesta.startsWith('rpc/') ? 'function ' + cesta.slice(4) : 'table ' + cesta;
      return json(401, { code: '42501', details: null, hint: null, message: 'permission denied for ' + co });
    }

    if (cesta === 'rpc/smi') return json(200, smi);
    if (cesta === 'rpc/je_spravce') return json(200, spravce);
    if (cesta === 'rpc/muj_technik') return json(200, mujTechnik);
    if (cesta === 'rpc/nastaveni_vypocet') return json(200, smi ? store.nastaveni.map((n) => ({ predstih_dni: n.predstih_dni, vyrobci: n.vyrobci })) : []);

    const t = store[cesta];
    if (!t) return json(404, { code: 'PGRST205', message: 'neznámá tabulka ' + cesta });
    // RLS: co uživatel smí vidět
    const vidi = (r) => {
      if (spravce) return true;
      if (!smi) return false;
      if (cesta === 'kategorie' || cesta === 'druhy') return true;
      if (cesta === 'technici') return r.id === mujTechnik;
      if (cesta === 'opravneni' || cesta === 'doklady') return r.technik_id === mujTechnik;
      if (cesta === 'uzivatele') return r.user_id === u.id;
      return false;
    };
    const jeden = (h.accept || '').includes('vnd.pgrst.object');
    const vrat = (rows, status = 200) => (jeden ? (rows.length === 1 ? json(status, rows[0]) : json(406, { code: 'PGRST116', message: 'počet řádků ' + rows.length })) : json(status, rows));
    const filtr = (r) => [...url.searchParams].every(([k, v]) => {
      if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
      if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/"/g, '')).includes(String(r[k]));
      return true;
    });
    const viditelne = t.filter(vidi).filter(filtr);

    if (m === 'GET') return vrat(viditelne);
    if (!spravce) return json(403, { code: '42501', message: 'new row violates row-level security policy for table "' + cesta + '"' });
    if (m === 'POST') {
      const b = req.postDataJSON(), radky = Array.isArray(b) ? b : [b];
      if (cesta === 'kategorie' && radky.some((r) => t.some((x) => x.id === r.id))) return json(409, { code: '23505', message: 'duplicate key value' });
      if (cesta === 'doklady' && store.selhani.doklady) return json(400, { code: '23514', message: 'new row violates check constraint' });
      if (cesta === 'doklady' && radky.some((r) => r.aktualni && t.some((x) => x.opravneni_id === r.opravneni_id && x.aktualni))) return json(409, { code: '23505', message: 'duplicate key value violates unique constraint "doklady_jeden_aktualni"' });
      const nove = radky.map((r) => {
        const novy = { id: randomUUID(), created_at: new Date().toISOString(), ...(cesta === 'doklady' ? { nahrano: new Date().toISOString() } : {}), ...(cesta === 'opravneni' ? { vyrobci: [], objednano_na: null, objednano_pozn: '', poznamka: '', bez_dokladu: false, predstih_dni: null } : {}), ...r };
        t.push(novy); return novy;
      });
      return vrat(nove, 201);
    }
    if (m === 'PATCH') { viditelne.forEach((r) => Object.assign(r, req.postDataJSON())); return vrat(viditelne); }
    if (m === 'DELETE') {
      if (cesta === 'technici' && viditelne.some((r) => store.opravneni.some((o) => o.technik_id === r.id))) return json(409, { code: '23503', message: 'violates foreign key constraint' });
      store[cesta] = t.filter((r) => !viditelne.includes(r));
      if (cesta === 'opravneni') store.doklady = store.doklady.filter((d) => store.opravneni.some((o) => o.id === d.opravneni_id));
      return route.fulfill({ status: 204, headers: CORS });
    }
    return json(405, { message: 'nepodporováno v mocku' });
  });
  return { store, hlavicky };
}
