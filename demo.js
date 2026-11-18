/* Ukázková data pro ?demo=1 – fiktivní jména, data se počítají od dneška, aby stavy byly vždy stejné.
   Lhůty v katalogu jsou jen orientační, skutečné se doplní v Nastavení. */
function demoData(dnes) {
  var d = function (n) { return Calc.plusDni(dnes, n); };
  // Kategorie jsou v katalogu (upravitelné v Nastavení); id = kód do odkazu ?kat=
  var kategorie = [
    { id: 'ppk', nazev: 'PPK', poradi: 1 }, { id: 'vyrobci', nazev: 'Výrobci', poradi: 2 },
    { id: 'fplyny', nazev: 'F-plyny', poradi: 3 }, { id: 'elektro', nazev: 'Elektro', poradi: 4 }
  ];
  var druhy = [
    { id: 'd1', kategorie: 'ppk', nazev: 'Mandík – požární klapky', vydavatel: 'MANDÍK, a.s.', popis: 'Kontrola provozuschopnosti a montáž požárních klapek Mandík', lhuta_mesicu: 24 },
    { id: 'd2', kategorie: 'ppk', nazev: 'Systemair – požární klapky', vydavatel: 'Systemair a.s.', popis: 'Kontrola provozuschopnosti požárních klapek Systemair', lhuta_mesicu: 24 },
    { id: 'd3', kategorie: 'ppk', nazev: 'Ing. Švadlenka – PBZ více výrobců', vydavatel: 'Ing. Švadlenka', popis: 'Jeden doklad pro více výrobců požárních klapek', lhuta_mesicu: 24, vice_vyrobcu: true },
    { id: 'd4', kategorie: 'vyrobci', nazev: 'Daikin – tepelná čerpadla', vydavatel: 'Daikin', popis: 'Instalace a uvedení do provozu', lhuta_mesicu: 24, predstih_dni: 120 },
    { id: 'd5', kategorie: 'vyrobci', nazev: 'Daikin – VRV systémy', vydavatel: 'Daikin', popis: 'Instalace a uvedení do provozu', lhuta_mesicu: 24, predstih_dni: 120 },
    { id: 'd6', kategorie: 'vyrobci', nazev: 'Atrea – VZT jednotky', vydavatel: 'ATREA s.r.o.', popis: 'Instalace a uvedení do provozu', lhuta_mesicu: 36 },
    { id: 'd7', kategorie: 'fplyny', nazev: 'F-plyny – certifikát kat. I/II', vydavatel: 'Certifikační subjekt', popis: 'Chlazení, klimatizace, tepelná čerpadla – stávající certifikát', neurcita: true },
    { id: 'd8', kategorie: 'fplyny', nazev: 'F-plyny – certifikát dle 2024/2215', vydavatel: 'Certifikační subjekt', popis: 'Nový certifikát s opakovanou zkouškou', lhuta_mesicu: 60 },
    { id: 'd9', kategorie: 'fplyny', nazev: 'CO₂ (R744)', vydavatel: 'Certifikační subjekt', popis: 'Certifikát pro CO₂', lhuta_mesicu: 60 },
    { id: 'd10', kategorie: 'fplyny', nazev: 'Propan (R290)', vydavatel: 'Certifikační subjekt', popis: 'Certifikát pro propan – zařazení upřesnit', lhuta_mesicu: 60 },
    { id: 'd11', kategorie: 'elektro', nazev: '§ 6 – osoba znalá', vydavatel: 'Externí zkušební subjekt', popis: 'Samostatná činnost (NV 194/2022 Sb.)', lhuta_mesicu: 60 },
    { id: 'd12', kategorie: 'elektro', nazev: '§ 7 – vedoucí elektrotechnik', vydavatel: 'Externí zkušební subjekt', popis: 'Řízení činnosti (NV 194/2022 Sb.)', lhuta_mesicu: 60 },
    { id: 'd13', kategorie: 'elektro', nazev: 'Periodické přezkoušení', vydavatel: 'Externí zkušební subjekt', popis: 'Periodické školení a přezkoušení u externího subjektu, lze bez dokladu', lhuta_mesicu: 36 }
  ].map(function (x, i) { return Object.assign({ aktivni: true, poradi: i, predstih_dni: null, vice_vyrobcu: false, neurcita: false }, x); });

  var technici = [
    { id: 't1', jmeno: 'Jan Dvořák', email: 'jan.dvorak@example.cz', ucet: 'jan.dvorak@example.cz' },
    { id: 't2', jmeno: 'Petr Svoboda', email: 'petr.svoboda@example.cz' },
    { id: 't3', jmeno: 'Tomáš Král', email: 'tomas.kral@example.cz' },
    { id: 't4', jmeno: 'Martin Veselý', email: 'martin.vesely@example.cz' },
    { id: 't5', jmeno: 'Lukáš Černý', email: 'lukas.cerny@example.cz' },
    { id: 't6', jmeno: 'Ondřej Beneš', email: '' }
  ].map(function (t) { return Object.assign({ aktivni: true, ucet: null }, t); });

  // z(technik, druh, číslo, platnost od dneška ve dnech | null = neurčitá, další pole)
  var n = 0;
  function z(t, dr, cislo, plat, extra) {
    var druh = druhy.filter(function (x) { return x.id === dr; })[0];
    var o = { id: 'o' + (++n), technik_id: t, druh_id: dr, cislo: cislo, vydavatel: druh.vydavatel, vyrobci: [], predstih_dni: null,
      objednano_na: null, objednano_pozn: '', poznamka: '', bez_dokladu: false, neurcita: plat === null };
    if (plat !== null) { o.platnost_do = d(plat); o.vydano = Calc.pridejMesice(o.platnost_do, -(druh.lhuta_mesicu || 24)); }
    else o.vydano = d(-2100);
    return Object.assign(o, extra || {});
  }
  var opravneni = [
    z('t1', 'd1', 'MAN-2025-0412', 400),
    z('t1', 'd7', 'FP-I-118734', null),
    z('t1', 'd11', 'EZ-6-55102', 900),
    z('t1', 'd4', 'DKN-HP-2291', 60), // v předstihu (druh má předstih 120)
    z('t2', 'd3', 'SV-2024-087', -10, { vyrobci: ['Mandík', 'Systemair', 'Elektrodesign'] }), // propadlé
    z('t2', 'd7', 'FP-II-220481', null),
    z('t2', 'd6', 'ATR-1907', -5, { objednano_na: d(-2), objednano_pozn: 'Atrea Jablonec, rez. č. 4471' }), // objednáno po termínu
    z('t3', 'd2', 'SYS-PK-3310', 45, { objednano_na: d(20), objednano_pozn: 'Školicí středisko Praha, rez. č. 88-120' }), // objednáno
    z('t3', 'd5', 'DKN-VRV-1180', 500),
    z('t3', 'd12', 'EZ-7-10233', 1200),
    z('t3', 'd13', '', 200, { bez_dokladu: true, poznamka: 'Přezkoušení u zaměstnavatele, zápis v osobní složce' }),
    z('t4', 'd1', 'MAN-2024-1187', 30), // v předstihu
    z('t4', 'd9', 'CO2-00871', 1500),
    z('t4', 'd8', 'FP-N-00342', 1600),
    z('t5', 'd4', 'DKN-HP-3302', 300),
    z('t5', 'd11', 'EZ-6-61877', 700),
    z('t6', 'd7', 'FP-I-097311', null)
  ];

  // Doklady: střídavě foto a PDF, u prvního záznamu i starší doklad v archivu
  var doklady = [], k = 0;
  opravneni.forEach(function (o, i) {
    if (o.bez_dokladu) return;
    var pdf = i % 2 === 1;
    doklady.push({ id: 'k' + (++k), opravneni_id: o.id, path: 'demo:' + o.id + (pdf ? '.pdf' : '.jpg'), typ: pdf ? 'application/pdf' : 'image/jpeg',
      nazev: (pdf ? 'osvedceni.pdf' : 'foto-dokladu.jpg'), nahrano: o.vydano, aktualni: true });
  });
  doklady.push({ id: 'k' + (++k), opravneni_id: 'o1', path: 'demo:o1-stary.jpg', typ: 'image/jpeg', nazev: 'foto-dokladu.jpg', nahrano: d(-330), aktualni: false });

  return {
    kategorie: kategorie, druhy: druhy, technici: technici, opravneni: opravneni, doklady: doklady,
    nastaveni: { predstih_dni: 90, prijemci: 'spravce@example.cz', vyrobci: 'Mandík, Systemair, Elektrodesign, IMOS, Klimaoprema, Trox' },
    testLog: [
      { cas: d(-1) + 'T05:12:40+00:00', typ: 'test', prijemce: 'spravce@example.cz', stav: 'ok', chyba: null },
      { cas: d(-1) + 'T05:12:40+00:00', typ: 'test', prijemce: 'jan.dvorak@example.cz', stav: 'chyba', chyba: 'SMTPRecipientsRefused: 550 neznámý příjemce' }
    ]
  };
}

// Ukázkový doklad jako obrázek (SVG) nebo jednostránkové PDF
function demoObrazek(text) {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="420" viewBox="0 0 600 420">' +
    '<rect width="600" height="420" fill="#f7f3e8"/><rect x="18" y="18" width="564" height="384" fill="none" stroke="#2c5f94" stroke-width="6"/>' +
    '<text x="300" y="120" text-anchor="middle" font-family="Georgia,serif" font-size="44" fill="#2c5f94">OSVĚDČENÍ</text>' +
    '<text x="300" y="190" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#333">' + text.replace(/[<&]/g, '') + '</text>' +
    '<circle cx="480" cy="320" r="46" fill="none" stroke="#b33" stroke-width="5"/><path d="M90 330h200" stroke="#333" stroke-width="2"/></svg>';
  return new Blob([svg], { type: 'image/svg+xml' });
}
function demoPdf(text) {
  var obsah = 'BT /F1 18 Tf 50 780 Td (' + text.replace(/[()\\]/g, '').replace(/[^\x20-\x7e]/g, '?') + ') Tj ET';
  var objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + obsah.length + ' >>\nstream\n' + obsah + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  var s = '%PDF-1.4\n', off = [];
  objs.forEach(function (o, i) { off.push(s.length); s += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  var xref = s.length;
  s += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  off.forEach(function (o) { s += String(o).padStart(10, '0') + ' 00000 n \n'; });
  s += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return new Blob([s], { type: 'application/pdf' });
}

// Napodobený návrh AI pro ?demo=1 (Edge Function se nevolá). Technik a druh podle formuláře, údaje dokladu smyšlené:
// číslo, vydání a platnost se od formuláře liší, aby bylo vidět zvýraznění rozdílů a převzetí.
function demoAiNavrh(S, formular, dnes) {
  var t = S.technici.filter(function (x) { return x.id === formular.technik_id; })[0] || S.technici[0];
  var d = S.druhy.filter(function (x) { return x.id === formular.druh_id; })[0] || S.druhy[0];
  var vydano = Calc.plusDni(dnes, -14);
  return {
    technik_id: t.id, druh_id: d.id, jmeno_na_dokladu: t.jmeno, cislo: 'DEMO-' + vydano.replace(/-/g, '').slice(2) + '-07',
    vydavatel: d.vydavatel || null, vydano: vydano, platnost_do: d.neurcita ? null : Calc.pridejMesice(vydano, d.lhuta_mesicu || 24),
    na_dobu_neurcitou: !!d.neurcita, vyrobci: d.vice_vyrobcu ? ['Mandík', 'Systemair'] : [], poznamka: 'Ukázkový návrh – v demo režimu se doklad nečte.'
  };
}
