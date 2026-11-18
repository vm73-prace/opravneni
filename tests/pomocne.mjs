// Společné pro Playwright testy.
// DEBUG_PANEL=1 (npm run test:debug): každá adresa otevřená přes page.goto dostane ?debug=1,
// aby celá sada ověřila, že debug panel nepřekrývá obsah (kliknutí na spodní tlačítka musí projít).
export const SDEBUGEM = process.env.DEBUG_PANEL === '1';

export function pridejDebug(adresa) {
  const [cesta, hash] = adresa.split('#');
  if (/[?&]debug=1/.test(cesta)) return adresa;
  return cesta + (cesta.includes('?') ? '&' : '?') + 'debug=1' + (hash !== undefined ? '#' + hash : '');
}

export function zapniDebugPanel(page) {
  if (!SDEBUGEM) return;
  const goto = page.goto.bind(page);
  page.goto = (adresa, volby) => goto(pridejDebug(adresa), volby);
}
