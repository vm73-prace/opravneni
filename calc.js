// Čisté výpočty – bez DOM a sítě. Testuje se v Node (tests/calc.test.mjs, případy v tests/cases.json).
// <calc>
var Calc = (function () {
  'use strict';
  var VYCHOZI_PREDSTIH = 90;

  // 'YYYY-MM-DD' -> počet dní od epochy (UTC, bez vlivu časových zón)
  function denCislo(iso) {
    var p = String(iso).slice(0, 10).split('-');
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }
  function dnyMezi(od, do_) { return denCislo(do_) - denCislo(od); }
  function plusDni(iso, n) { return new Date((denCislo(iso) + n) * 86400000).toISOString().slice(0, 10); }
  function dnesPraha(now) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(now || new Date());
  }
  // Datum + n měsíců; konec měsíce se zarovná (29. 2. + 12 = 28. 2.)
  function pridejMesice(iso, n) {
    var p = iso.split('-').map(Number);
    var m = p[1] - 1 + n, y = p[0] + Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    var posledni = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(Math.min(p[2], posledni)).padStart(2, '0');
  }
  function formatDatum(iso) {
    if (!iso) return '';
    var p = iso.slice(0, 10).split('-');
    return (+p[2]) + '. ' + (+p[1]) + '. ' + p[0];
  }
  function formatDatumKratce(iso) { var p = iso.slice(0, 10).split('-'); return (+p[2]) + '. ' + (+p[1]) + '.'; }
  function dni(n) { return n === 1 ? '1 den' : (n >= 2 && n <= 4 ? n + ' dny' : n + ' dní'); }
  function predDny(n) { return n === 1 ? 'před 1 dnem' : 'před ' + n + ' dny'; }

  // Hledání bez diakritiky a velikosti písmen
  function bezDiakritiky(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  // Účinný předstih: záznam > druh > globální nastavení > 90
  function predstih(zaznam, druh, nastaveni) {
    if (zaznam && zaznam.predstih_dni != null) return zaznam.predstih_dni;
    if (druh && druh.predstih_dni != null) return druh.predstih_dni;
    if (nastaveni && nastaveni.predstih_dni != null) return nastaveni.predstih_dni;
    return VYCHOZI_PREDSTIH;
  }

  // Stav jednoho oprávnění: platne | predstih | propadle | objednano | neurcita
  // po_terminu = objednaný termín už proběhl → „Nahraj nový doklad“
  function stavOpravneni(z, druh, dnes, nastaveni) {
    var w = predstih(z, druh, nastaveni);
    if (z.neurcita || !z.platnost_do) return { stav: 'neurcita', zbyva: null, predstih: w, text: 'doba neurčitá', po_terminu: false };
    var zbyva = dnyMezi(dnes, z.platnost_do);
    var stav = zbyva < 0 ? 'propadle' : (zbyva <= w ? 'predstih' : 'platne');
    var text = zbyva < 0 ? 'propadlé ' + predDny(-zbyva) : (zbyva === 0 ? 'vyprší dnes' : 'za ' + dni(zbyva));
    var po = false;
    if (stav !== 'platne' && z.objednano_na) {
      stav = 'objednano';
      po = z.objednano_na < dnes;
      // Datum termínu školení (ne platnosti); rok jen když není letošní
      var termin = z.objednano_na.slice(0, 4) === dnes.slice(0, 4) ? formatDatumKratce(z.objednano_na) : formatDatum(z.objednano_na);
      text = po ? 'termín ' + termin + ' proběhl – nahraj nový doklad' : 'objednáno · termín ' + termin;
    }
    return { stav: stav, zbyva: zbyva, predstih: w, text: text, po_terminu: po };
  }

  // Posunula se platnost na pozdější datum (nebo nově na dobu neurčitou)? Jen tehdy nový doklad ruší stav Objednáno.
  function platnostPosunuta(pred, po) {
    if (!pred) return false;
    if (po.neurcita) return !pred.neurcita;
    return !!(po.platnost_do && pred.platnost_do && !pred.neurcita && po.platnost_do > pred.platnost_do);
  }

  // Pořadí naléhavosti (nižší = horší); 'bez' = technik nemá v kategorii žádné oprávnění
  var PORADI = { propadle: 0, predstih: 1, objednano: 2, platne: 3, neurcita: 4, bez: 5 };
  var POPISY = [['propadle', 'propadlé'], ['predstih', 'v předstihu'], ['objednano', 'objednané']];

  // Řádek k vyřízení: oranžové, červené a objednané po termínu
  function kVyrizeni(s) { return s.stav === 'propadle' || s.stav === 'predstih' || (s.stav === 'objednano' && s.po_terminu); }

  function porovnej(a, b) {
    var d = PORADI[a.stav] - PORADI[b.stav];
    if (d) return d;
    var za = a.zbyva == null ? 1e9 : a.zbyva, zb = b.zbyva == null ? 1e9 : b.zbyva;
    return za - zb;
  }

  // Stav technika ze stavů jeho oprávnění: nejhorší, počty a popisek
  function stavTechnika(stavy) {
    if (!stavy.length) return { stav: 'bez', pocty: {}, popis: 'bez oprávnění', zbyva: null, k_vyrizeni: 0 };
    var nej = stavy.slice().sort(porovnej)[0], pocty = {};
    stavy.forEach(function (s) { pocty[s.stav] = (pocty[s.stav] || 0) + 1; });
    var casti = POPISY.filter(function (p) { return pocty[p[0]]; }).map(function (p) { return pocty[p[0]] + ' ' + p[1]; });
    var popis = casti.length ? casti.join(' · ')
      : (pocty.platne ? 'vše platné' + (pocty.neurcita ? ' · ' + pocty.neurcita + ' na dobu neurčitou' : '') : 'doba neurčitá');
    return { stav: nej.stav, pocty: pocty, popis: popis, zbyva: nej.zbyva,
      k_vyrizeni: stavy.filter(kVyrizeni).length };
  }

  // Přehled techniků. polozky: [{ technik_id, kategorie, s: stavOpravneni(...) }], kat: 'vse' | kód kategorie.
  // Technici bez oprávnění v kategorii zůstávají (stav 'bez', na konci) – je vidět, komu školení chybí.
  function prehled(technici, polozky, kat) {
    return technici.filter(function (t) { return t.aktivni !== false; }).map(function (t) {
      var stavy = polozky.filter(function (x) { return x.technik_id === t.id && (kat === 'vse' || x.kategorie === kat); })
        .map(function (x) { return x.s; });
      var st = stavTechnika(stavy);
      st.technik = t;
      return st;
    }).sort(function (a, b) {
      return porovnej(a, b) || String(a.technik.jmeno).localeCompare(String(b.technik.jmeno), 'cs');
    });
  }

  return {
    VYCHOZI_PREDSTIH: VYCHOZI_PREDSTIH, denCislo: denCislo, dnyMezi: dnyMezi, plusDni: plusDni,
    dnesPraha: dnesPraha, pridejMesice: pridejMesice, formatDatum: formatDatum, bezDiakritiky: bezDiakritiky,
    predstih: predstih, stavOpravneni: stavOpravneni, platnostPosunuta: platnostPosunuta, kVyrizeni: kVyrizeni, porovnej: porovnej,
    stavTechnika: stavTechnika, prehled: prehled
  };
})();
// </calc>
