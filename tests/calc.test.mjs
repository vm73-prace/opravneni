import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../calc.js', import.meta.url), 'utf8');
const blok = src.slice(src.indexOf('// <calc>'), src.indexOf('// </calc>'));
const Calc = vm.runInNewContext(blok + '\nCalc', { Intl, Date, Math, String, Number });
const C = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));

for (const c of C.opravneni) {
  test('oprávnění: ' + c.nazev, () => {
    const s = Calc.stavOpravneni(c.zaznam, c.druh || {}, c.dnes || C.dnes, c.nastaveni);
    for (const [k, v] of Object.entries(c.ocekavano)) assert.equal(s[k], v, k);
  });
}

for (const [od, n, ocek] of C.mesice) {
  test(`přidej ${n} měs. k ${od}`, () => assert.equal(Calc.pridejMesice(od, n), ocek));
}

const S = (stav, zbyva = null, po_terminu = false) => ({ stav, zbyva, po_terminu });

test('stav technika = nejhorší (červená > oranžová > modrá > zelená > šedá)', () => {
  assert.equal(Calc.stavTechnika([S('platne', 300), S('propadle', -3), S('predstih', 20)]).stav, 'propadle');
  assert.equal(Calc.stavTechnika([S('platne', 300), S('objednano', 20), S('predstih', 50)]).stav, 'predstih');
  assert.equal(Calc.stavTechnika([S('platne', 300), S('objednano', 20)]).stav, 'objednano');
  assert.equal(Calc.stavTechnika([S('neurcita'), S('platne', 300)]).stav, 'platne');
  assert.equal(Calc.stavTechnika([S('neurcita')]).stav, 'neurcita');
});

test('popisek a počty technika', () => {
  const t = Calc.stavTechnika([S('propadle', -1), S('propadle', -9), S('predstih', 5), S('platne', 400), S('objednano', 3, true)]);
  assert.equal(t.popis, '2 propadlé · 1 v předstihu · 1 objednané');
  assert.equal(t.k_vyrizeni, 4); // 2 propadlé, 1 v předstihu, 1 objednané po termínu
  assert.equal(Calc.stavTechnika([S('platne', 400), S('neurcita')]).popis, 'vše platné · 1 na dobu neurčitou');
  assert.equal(Calc.stavTechnika([S('neurcita')]).popis, 'doba neurčitá');
  assert.equal(Calc.stavTechnika([]).popis, 'bez oprávnění');
});

test('k vyřízení: oranžové, červené, objednané po termínu', () => {
  assert.equal(Calc.kVyrizeni(S('predstih', 5)), true);
  assert.equal(Calc.kVyrizeni(S('propadle', -5)), true);
  assert.equal(Calc.kVyrizeni(S('objednano', 5, false)), false);
  assert.equal(Calc.kVyrizeni(S('objednano', -5, true)), true);
  assert.equal(Calc.kVyrizeni(S('platne', 500)), false);
  assert.equal(Calc.kVyrizeni(S('neurcita')), false);
});

test('přehled s filtrem kategorie: technik bez oprávnění zůstane šedě na konci', () => {
  const technici = [{ id: 'a', jmeno: 'Adam' }, { id: 'b', jmeno: 'Bohumil' }, { id: 'c', jmeno: 'Cyril' }, { id: 'd', jmeno: 'Dan', aktivni: false }];
  const pol = [
    { technik_id: 'a', kategorie: 'ppk', s: S('platne', 400) },
    { technik_id: 'a', kategorie: 'fplyny', s: S('propadle', -2) },
    { technik_id: 'b', kategorie: 'fplyny', s: S('neurcita') },
    { technik_id: 'c', kategorie: 'ppk', s: S('predstih', 10) },
    { technik_id: 'd', kategorie: 'ppk', s: S('propadle', -50) }
  ];
  const vse = Calc.prehled(technici, pol, 'vse');
  assert.deepEqual(vse.map((x) => x.technik.id + ':' + x.stav), ['a:propadle', 'c:predstih', 'b:neurcita']);
  const ppk = Calc.prehled(technici, pol, 'ppk');
  assert.deepEqual(ppk.map((x) => x.technik.id + ':' + x.stav), ['c:predstih', 'a:platne', 'b:bez']);
  assert.equal(ppk[2].popis, 'bez oprávnění');
  const el = Calc.prehled(technici, pol, 'elektro');
  assert.deepEqual(el.map((x) => x.stav), ['bez', 'bez', 'bez']);
  // šedá „doba neurčitá“ je před „bez oprávnění“
  const fp = Calc.prehled(technici, pol, 'fplyny');
  assert.deepEqual(fp.map((x) => x.technik.id + ':' + x.stav), ['a:propadle', 'b:neurcita', 'c:bez']);
});

test('stejný stav: řazení podle zbývajících dní, pak jména', () => {
  const t = [{ id: 'x', jmeno: 'Žofie' }, { id: 'y', jmeno: 'Čeněk' }, { id: 'z', jmeno: 'Adam' }];
  const pol = [{ technik_id: 'x', kategorie: 'ppk', s: S('predstih', 10) }, { technik_id: 'y', kategorie: 'ppk', s: S('predstih', 40) },
    { technik_id: 'z', kategorie: 'ppk', s: S('predstih', 40) }];
  assert.deepEqual(Calc.prehled(t, pol, 'vse').map((x) => x.technik.jmeno), ['Žofie', 'Adam', 'Čeněk']);
});

test('nový doklad ruší Objednáno jen při posunu platnosti', () => {
  const P = (platnost_do, neurcita = false) => ({ platnost_do, neurcita });
  assert.equal(Calc.platnostPosunuta(P('2026-12-01'), P('2028-12-01')), true);
  assert.equal(Calc.platnostPosunuta(P('2026-12-01'), P('2026-12-01')), false); // beze změny
  assert.equal(Calc.platnostPosunuta(P('2026-12-01'), P('2026-11-01')), false); // dřívější
  assert.equal(Calc.platnostPosunuta(P('2026-12-31'), P('2027-01-01')), true);  // přes konec roku
  assert.equal(Calc.platnostPosunuta(P('2026-12-01'), P(null, true)), true);    // nově doba neurčitá
  assert.equal(Calc.platnostPosunuta(P(null, true), P(null, true)), false);
  assert.equal(Calc.platnostPosunuta(null, P('2028-12-01')), false);           // nový záznam
});

test('hledání bez diakritiky', () => {
  assert.equal(Calc.bezDiakritiky('Tomáš Král'), 'tomas kral');
  assert.ok(Calc.bezDiakritiky('Ondřej Černý').includes('cerny'));
});

test('předstih: záznam > druh > nastavení > 90', () => {
  assert.equal(Calc.predstih({}, {}, {}), 90);
  assert.equal(Calc.predstih({}, {}, { predstih_dni: 60 }), 60);
  assert.equal(Calc.predstih({}, { predstih_dni: 120 }, { predstih_dni: 60 }), 120);
  assert.equal(Calc.predstih({ predstih_dni: 0 }, { predstih_dni: 120 }, {}), 0);
});
