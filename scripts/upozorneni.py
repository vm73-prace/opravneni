"""Denní kontrola oprávnění a e-mailová upozornění (GitHub Actions, jen standardní knihovna + tzdata).

Načte data přes opravneni.upozorneni_data(token) (publishable klíč + token z GitHub Secrets, žádný service_role),
spočítá stavy stejně jako calc.js, pošle e-maily z pracovní schránky (SMTP) a zapíše log přes
opravneni.zapis_upozorneni(token, zaznamy).

Pravidla (ZADANI sekce 5):
  - k řešení = v předstihu, propadlé, objednané po termínu (objednané v termínu = vyřízeno, nehlásí se),
  - první e-mail při vstupu do předstihu / propadnutí (typ 'vstup'): položka ještě nebyla v logu 'vstup'
    od poslední změny záznamu (updated_at) – nový doklad / nová platnost = nový záznam pro upozornění,
  - týdenní souhrn (typ 'tydenni') každé pondělí, dokud je co řešit,
  - správci (nastaveni.prijemci) dostanou souhrn za všechny aktivní techniky, technik (technici.email) jen svoje,
  - stejný příjemce nedostane týž den dva e-maily (opakované spuštění workflow).

Použití:
  python scripts/upozorneni.py              # ostrý běh
  python scripts/upozorneni.py --dry-run    # jen vypíše počty, nic neposílá ani nezapisuje
  python scripts/upozorneni.py --nahled f   # zapíše texty e-mailů do souboru f (lokálně, nic neposílá)
  python scripts/upozorneni.py --test-email # [TEST] jen správcům (příjemci souhrnu), nikdy technikům; log typ 'test'
  python scripts/upozorneni.py --sonda-smtp # jen ověří SMTP server (STARTTLS, certifikát, metody AUTH), bez přihlášení a odeslání
Proměnné prostředí (GitHub Secrets): OPRAVNENI_SUPABASE_URL, OPRAVNENI_SUPABASE_PUBLISHABLE_KEY, OPRAVNENI_NOTIFY_TOKEN,
  pro odeslání OPRAVNENI_SMTP_HOST, OPRAVNENI_SMTP_PORT (465 = SSL, jinak STARTTLS), OPRAVNENI_SMTP_USER, OPRAVNENI_SMTP_PASSWORD.
  Odesílatel = OPRAVNENI_SMTP_FROM (adresa schránky); když chybí, OPRAVNENI_SMTP_USER – jen pokud je to e-mailová adresa
  (Exchange se přihlašuje jménem bez domény, adresa odesílatele ale musí být e-mail, jinak 501 5.1.7 Invalid address).
  Volitelně OPRAVNENI_APP_URL (odkaz v patičce e-mailu).
Výpis neobsahuje jména, e-maily ani čísla dokladů (repo bude veřejné) – jen počty a pořadí příjemců.
"""
import json
import os
import smtplib
import socket
import ssl
import sys
import urllib.error
import urllib.request
from datetime import date, datetime
from email.message import EmailMessage

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(errors='replace')  # konzole Windows (cp1250) nesmí shodit skript

VYCHOZI_PREDSTIH = 90
TYDENNI_DEN = 0  # pondělí

# ---------- výpočty (zrcadlo calc.js; společné případy tests/cases.json) ----------


def den(iso):
    return date.fromisoformat(str(iso)[:10])


def format_datum(iso):
    d = den(iso)
    return f'{d.day}. {d.month}. {d.year}'


def format_kratce(iso):
    d = den(iso)
    return f'{d.day}. {d.month}.'


def dni(n):
    return '1 den' if n == 1 else (f'{n} dny' if 2 <= n <= 4 else f'{n} dní')


def pred_dny(n):
    return 'před 1 dnem' if n == 1 else f'před {n} dny'


def predstih(z, druh, nastaveni):
    if z and z.get('predstih_dni') is not None:
        return z['predstih_dni']
    if druh and druh.get('predstih_dni') is not None:
        return druh['predstih_dni']
    if nastaveni and nastaveni.get('predstih_dni') is not None:
        return nastaveni['predstih_dni']
    return VYCHOZI_PREDSTIH


def stav_opravneni(z, druh, dnes, nastaveni=None):
    w = predstih(z, druh, nastaveni)
    if z.get('neurcita') or not z.get('platnost_do'):
        return {'stav': 'neurcita', 'zbyva': None, 'predstih': w, 'text': 'doba neurčitá', 'po_terminu': False}
    zbyva = (den(z['platnost_do']) - den(dnes)).days
    stav = 'propadle' if zbyva < 0 else ('predstih' if zbyva <= w else 'platne')
    text = 'propadlé ' + pred_dny(-zbyva) if zbyva < 0 else ('vyprší dnes' if zbyva == 0 else 'za ' + dni(zbyva))
    po = False
    if stav != 'platne' and z.get('objednano_na'):
        stav = 'objednano'
        po = str(z['objednano_na'])[:10] < str(dnes)[:10]
        termin = format_kratce(z['objednano_na']) if str(z['objednano_na'])[:4] == str(dnes)[:4] else format_datum(z['objednano_na'])
        text = f'termín {termin} proběhl – nahraj nový doklad' if po else f'objednáno · termín {termin}'
    return {'stav': stav, 'zbyva': zbyva, 'predstih': w, 'text': text, 'po_terminu': po}


def k_reseni(s):
    return s['stav'] in ('propadle', 'predstih') or (s['stav'] == 'objednano' and s['po_terminu'])


PORADI = {'propadle': 0, 'predstih': 1, 'objednano': 2}

# ---------- kdo dostane co ----------


def polozky_k_reseni(data, dnes):
    """Oprávnění aktivních techniků, která jsou k řešení, seřazená od nejhoršího."""
    nast = data.get('nastaveni') or {}
    druhy = {d['id']: d for d in data.get('druhy') or []}
    kat = {k['id']: k['nazev'] for k in data.get('kategorie') or []}
    technici = {t['id']: t for t in data.get('technici') or [] if t.get('aktivni', True)}
    r = []
    for z in data.get('opravneni') or []:
        t = technici.get(z['technik_id'])
        if not t:
            continue
        d = druhy.get(z['druh_id']) or {}
        s = stav_opravneni(z, d, dnes, nast)
        if k_reseni(s):
            r.append({'z': z, 'druh': d, 'kategorie': kat.get(d.get('kategorie'), ''), 'technik': t, 's': s})
    return sorted(r, key=lambda x: (PORADI[x['s']['stav']], x['s']['zbyva'] if x['s']['zbyva'] is not None else 0, x['technik']['jmeno']))


def je_nova(x, log):
    """Ještě nehlášená při vstupu do předstihu / propadnutí od poslední změny záznamu."""
    if x['s']['stav'] not in ('predstih', 'propadle'):
        return False
    zmena = str(x['z'].get('updated_at') or '')
    return not any(l['typ'] == 'vstup' and l.get('stav', 'ok') == 'ok' and x['z']['id'] in (l.get('polozky') or [])
                   and str(l['cas']) >= zmena for l in log)


def dnes_uz_poslano(prijemce, log, dnes):
    return any(l['prijemce'] == prijemce and l['typ'] in ('vstup', 'tydenni') and l.get('stav', 'ok') == 'ok'
               and str(l['cas'])[:10] == dnes for l in log)


def spravci(data):
    return [e.strip() for e in ((data.get('nastaveni') or {}).get('prijemci') or '').replace(';', ',').split(',') if e.strip()]


def plan(data, dnes, test=False):
    """Seznam e-mailů k odeslání: {kdo, prijemce, typ, polozky (seznam položek), nove (id)}."""
    log = data.get('log') or []
    polozky = polozky_k_reseni(data, dnes)
    nove = {x['z']['id'] for x in polozky if je_nova(x, log)}
    tydenni = den(dnes).weekday() == TYDENNI_DEN
    zpravy = []

    def pridej(kdo, prijemce, jeho):
        if test:
            zpravy.append({'kdo': kdo, 'prijemce': prijemce, 'typ': 'test', 'polozky': jeho, 'nove': set()})
            return
        jeho_nove = {x['z']['id'] for x in jeho} & nove
        if jeho_nove:
            typ = 'vstup'
        elif tydenni and jeho and not dnes_uz_poslano(prijemce, log, dnes):
            typ = 'tydenni'
        else:
            return
        zpravy.append({'kdo': kdo, 'prijemce': prijemce, 'typ': typ, 'polozky': jeho, 'nove': jeho_nove})

    for e in spravci(data):
        pridej('spravce', e, polozky)
    if test:  # [TEST] jen správcům / příjemcům souhrnu, nikdy technikům
        return zpravy
    for t in sorted((data.get('technici') or []), key=lambda t: t['jmeno']):
        jeho = [x for x in polozky if x['technik']['id'] == t['id']]
        if jeho and t.get('aktivni', True) and (t.get('email') or '').strip():  # technik jen když má co řešit
            pridej('technik', t['email'].strip(), jeho)
    return zpravy


# ---------- text e-mailu ----------

NADPISY = [('propadle', 'PROPADLÉ'), ('predstih', 'V PŘEDSTIHU – objednej školení / zkoušku'), ('objednano', 'OBJEDNANÉ – TERMÍN PROBĚHL, nahraj nový doklad')]


def predmet(zprava, dnes):
    pocty = {k: sum(1 for x in zprava['polozky'] if x['s']['stav'] == k) for k, _ in NADPISY}
    casti = [f"{pocty['propadle']} propadlé", f"{pocty['predstih']} v předstihu"]
    if pocty['objednano']:
        casti.append(f"{pocty['objednano']} po termínu")
    zaklad = 'Oprávnění: ' + ', '.join(casti)
    if zprava['typ'] == 'tydenni':
        zaklad += ' (týdenní souhrn)'
    return ('[TEST] ' if zprava['typ'] == 'test' else '') + zaklad


def text_emailu(zprava, dnes, app_url=''):
    pro_spravce = zprava['kdo'] == 'spravce'
    radky = []
    if zprava['typ'] == 'test':
        radky += ['Zkušební e-mail ze skriptu upozornění (spuštěno ručně: Run workflow → režim test).', '']
    radky.append(('Oprávnění techniků' if pro_spravce else 'Tvoje oprávnění') + f' – stav k {format_datum(dnes)}')
    radky.append('')
    if not zprava['polozky']:
        radky += ['Nic k vyřízení – vše platné nebo objednané.', '']
    for kod, nadpis in NADPISY:
        cast = [x for x in zprava['polozky'] if x['s']['stav'] == kod]
        if not cast:
            continue
        radky.append(nadpis)
        for x in cast:
            z, s = x['z'], x['s']
            kdo = (x['technik']['jmeno'] + ' – ') if pro_spravce else ''
            nove = ' [NOVÉ]' if z['id'] in zprava['nove'] else ''
            kat = f" ({x['kategorie']})" if x['kategorie'] else ''
            platnost = f", platí do {format_datum(z['platnost_do'])}" if z.get('platnost_do') else ''
            radky.append(f"  • {kdo}{x['druh'].get('nazev', 'Oprávnění')}{kat}: {s['text']}{platnost}{nove}")
        radky.append('')
    if zprava['typ'] == 'tydenni':
        radky.append('Týdenní souhrn chodí každé pondělí, dokud nejsou položky vyřízené (nový doklad nebo stav Objednáno).')
    if app_url:
        radky.append('Otevřít appku: ' + app_url)
    return '\n'.join(radky).rstrip() + '\n'


# ---------- běh ----------


def log(*a):
    print(datetime.now().strftime('%Y-%m-%d %H:%M:%S'), *a, flush=True)


def dnes_praha():
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo('Europe/Prague')).date().isoformat()


def env(nazev):
    v = os.environ.get(nazev, '').strip()
    if not v:
        raise SystemExit(f'Chybí proměnná prostředí {nazev} (GitHub Secrets).')
    return v


def rpc(funkce, telo):
    url = env('OPRAVNENI_SUPABASE_URL').rstrip('/') + '/rest/v1/rpc/' + funkce
    req = urllib.request.Request(url, data=json.dumps(telo).encode(), method='POST', headers={
        'apikey': env('OPRAVNENI_SUPABASE_PUBLISHABLE_KEY'), 'Content-Profile': 'opravneni', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            log('Supabase', funkce, r.status)
            return json.load(r)
    except urllib.error.HTTPError as e:
        telo_chyby = e.read().decode(errors='replace')[:500]
        log('Supabase CHYBA', funkce, e.code, telo_chyby)
        if '28000' in telo_chyby:
            log('neplatný token – SHA-256 z řádku „token:“ výše musí sedět s opravneni.tajne.token_hash')
        raise SystemExit(1)


def popis_tokenu(t):
    """Diagnostika bez prozrazení tokenu: délka a okraje jeho SHA-256 (hash není tajný)."""
    import hashlib
    h = hashlib.sha256(t.strip().encode()).hexdigest()
    return f'délka {len(t.strip())} znaků (před ořezem {len(t)}), SHA-256 {h[:4]}…{h[-4:]}'


def popis_os_chyby(e):
    """Srozumitelná nápověda k síťovým chybám (bez adres a hesel)."""
    if isinstance(e, socket.gaierror):
        return f'(DNS errno {e.errno}: název serveru nejde přeložit – zkontroluj secret OPRAVNENI_SMTP_HOST)'
    if isinstance(e, ssl.SSLCertVerificationError):
        return '(certifikát serveru neprošel ověřením)'
    if isinstance(e, (ConnectionRefusedError, TimeoutError, socket.timeout)):
        return '(server nepřijal spojení – zkontroluj OPRAVNENI_SMTP_PORT)'
    if isinstance(e, smtplib.SMTPAuthenticationError):
        return '(přihlášení odmítnuto – zkontroluj OPRAVNENI_SMTP_USER a OPRAVNENI_SMTP_PASSWORD)'
    return ''


def _sha_okraje(text):
    import hashlib
    h = hashlib.sha256(text.encode()).hexdigest()
    return f'{h[:4]}…{h[-4:]}'


def popis_smtp_nastaveni():
    """Diagnostika secrets SMTP bez prozrazení hodnot: délky, tvar, okraje SHA-256 názvu serveru, port."""
    host = os.environ.get('OPRAVNENI_SMTP_HOST', '')
    user = os.environ.get('OPRAVNENI_SMTP_USER', '')
    od = os.environ.get('OPRAVNENI_SMTP_FROM', '')
    h = host.strip()
    ano = lambda b: 'ano' if b else 'ne'
    return (f"HOST délka {len(h)} (před ořezem {len(host)}), teček {h.count('.')}, '@' {ano('@' in h)}, "
            f"mezera {ano(any(c.isspace() for c in h))}, znaků mimo ASCII {sum(1 for c in h if ord(c) > 127)}, SHA-256 {_sha_okraje(h)} | "
            f"PORT {os.environ.get('OPRAVNENI_SMTP_PORT', '').strip() or '(prázdný)'} | "
            f"USER délka {len(user.strip())}, '@' {ano('@' in user)} | "
            f"FROM {'(nevyplněný → USER)' if not od.strip() else f'délka {len(od.strip())}'}, odesílatel má '@' {ano('@' in odesilatel())}")


def odesilatel():
    """Adresa odesílatele: OPRAVNENI_SMTP_FROM, jinak OPRAVNENI_SMTP_USER (přihlašovací jméno nemusí být e-mail)."""
    return (os.environ.get('OPRAVNENI_SMTP_FROM', '').strip() or os.environ.get('OPRAVNENI_SMTP_USER', '').strip())


def kontrola_hostu(host):
    """Vrátí popis chyby tvaru OPRAVNENI_SMTP_HOST, nebo None. Hodnotu nevypisuje (v logu Actions je stejně maskovaná)."""
    import re
    h = host.strip()
    if not h:
        return 'je prázdný'
    if '://' in h:
        return 'obsahuje schéma (např. smtp://) – zadej jen název serveru'
    if '@' in h:
        return "obsahuje '@' – vypadá jako e-mailová adresa, ne název serveru"
    if ':' in h:
        return "obsahuje ':' – port patří do OPRAVNENI_SMTP_PORT, ne do názvu serveru"
    if any(c in h for c in '"\'<>'):
        return 'obsahuje uvozovky nebo závorky'
    if any(c.isspace() for c in h):
        return 'obsahuje mezeru nebo nový řádek uvnitř'
    if not re.fullmatch(r'[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+\.?', h):
        return f'není platný název serveru (délka {len(h)} znaků, čekám např. smtp.firma.cz)'
    return None


def pripoj(host, port, ctx, faze):
    """Otevře zabezpečené spojení; faze[0] průběžně ukazuje, kde se právě je (pro diagnostiku chyby)."""
    faze[0] = 'DNS'
    socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)  # samostatně, aby šlo poznat chybu DNS od spojení
    faze[0] = 'spojení'
    s = smtplib.SMTP_SSL(host, port, timeout=30, context=ctx) if port == 465 else smtplib.SMTP(host, port, timeout=30)
    try:
        if port != 465:
            s.ehlo()
            faze[0] = 'STARTTLS'
            s.starttls(context=ctx)  # výjimka při chybě → přihlášení se nikdy nezkusí
            s.ehlo()
    except BaseException:
        s.close()
        raise
    return s


def sonda_smtp():
    """Ověří SMTP bez přihlášení a bez odeslání: spojení, EHLO, STARTTLS s ověřením certifikátu, EHLO, metody AUTH."""
    host, port = env('OPRAVNENI_SMTP_HOST'), int(env('OPRAVNENI_SMTP_PORT'))
    chyba = kontrola_hostu(host)
    if chyba:
        log('CHYBA OPRAVNENI_SMTP_HOST', chyba, '|', popis_smtp_nastaveni())
        raise SystemExit(1)
    log('SMTP nastavení:', popis_smtp_nastaveni())
    faze = ['?']
    try:
        s = pripoj(host, port, ssl.create_default_context(), faze)
    except BaseException as e:
        e.faze = faze[0]
        raise
    with s:
        # Vydavatele ani platnost certifikátu nevypisovat – log Actions je ve veřejném repu veřejný.
        log('sonda: TLS', s.sock.version(), '| certifikát ověřen')
        log('sonda: metody AUTH', s.esmtp_features.get('auth', '(žádné)').strip(), '| přihlášení se nezkouší, nic se neodesílá')


def posli(prijemce, predmet_, telo):
    """Odešle z pracovní schránky; port 465 = SMTP přes SSL, jinak (587) povinně STARTTLS.

    Bezpečnost (ověřeno testy proti lokálnímu SMTP serveru v tests/test_upozorneni.py, vzor kalibrace):
      - certifikát i jméno serveru se ověřují (ssl.create_default_context, nic se nevypíná);
        pozor: starttls bez parametru context certifikát NEověřuje, proto se context předává vždy,
      - když STARTTLS chybí, server ho odmítne nebo selže TLS handshake, skončí chybou –
        nikdy se nepřihlásí ani nepošle heslo bez šifrování (žádný fallback).
    """
    host, port, user = env('OPRAVNENI_SMTP_HOST'), int(env('OPRAVNENI_SMTP_PORT')), env('OPRAVNENI_SMTP_USER')
    msg = EmailMessage()
    msg['From'] = odesilatel()  # přihlašuje se USER, odesílá se z FROM (u Exchange se liší)
    msg['To'] = prijemce
    msg['Subject'] = predmet_
    msg.set_content(telo)
    faze = ['?']
    try:
        s = pripoj(host, port, ssl.create_default_context(), faze)
        with s:
            faze[0] = 'AUTH'
            s.login(user, env('OPRAVNENI_SMTP_PASSWORD'))
            faze[0] = 'odeslání'
            s.send_message(msg)
    except BaseException as e:
        e.faze = faze[0]  # DNS / spojení / STARTTLS / AUTH / odeslání
        raise


def main(argv):
    if '--sonda-smtp' in argv:  # jen ověření SMTP serveru, bez Supabase a bez odeslání
        log('start sonda SMTP')
        try:
            sonda_smtp()
        except (smtplib.SMTPException, ssl.SSLError, OSError) as e:
            log('SONDA CHYBA fáze', getattr(e, 'faze', '?'), type(e).__name__, getattr(e, 'smtp_code', '') or '', popis_os_chyby(e))
            raise SystemExit(1)
        return
    test = '--test-email' in argv  # má přednost před --dry-run
    dry = '--dry-run' in argv and not test
    nahled = argv[argv.index('--nahled') + 1] if '--nahled' in argv else None
    dnes = dnes_praha()
    app_url = os.environ.get('OPRAVNENI_APP_URL', '').strip()
    log('start', 'dnes', dnes, '(dry-run)' if dry else '', '(náhled)' if nahled else '', '(test)' if test else '')
    token = env('OPRAVNENI_NOTIFY_TOKEN')
    log('token:', popis_tokenu(os.environ.get('OPRAVNENI_NOTIFY_TOKEN', '')))
    data = rpc('upozorneni_data', {'token': token})
    polozky = polozky_k_reseni(data, dnes)
    pocty = {k: sum(1 for x in polozky if x['s']['stav'] == k) for k in PORADI}
    log('k řešení:', len(polozky), pocty, '| pondělí' if den(dnes).weekday() == TYDENNI_DEN else '')
    if not spravci(data):
        log('POZOR: v appce (Nastavení → Příjemci souhrnu) není vyplněný žádný správce')
        if test:
            raise SystemExit(1)
    zpravy = plan(data, dnes, test)
    poradi = {'spravce': 0, 'technik': 0}
    for z in zpravy:  # bez e-mailů a jmen – jen kdo (pořadí), typ a počty
        poradi[z['kdo']] += 1
        z['oznaceni'] = f"{z['kdo']} #{poradi[z['kdo']]}"
        log('e-mail', z['oznaceni'], z['typ'], 'položek', len(z['polozky']), 'nových', len(z['nove']))
    if not zpravy:
        log('nic k odeslání')
    if nahled:
        with open(nahled, 'w', encoding='utf-8') as f:
            for z in zpravy:
                f.write(f"KOMU: {z['prijemce']}\nPŘEDMĚT: {predmet(z, dnes)}\n\n{text_emailu(z, dnes, app_url)}\n{'=' * 60}\n")
        log('náhled zapsán do', nahled)
        return
    if dry or not zpravy:
        return
    zaznamy, chyby = [], 0
    chyba_hostu = kontrola_hostu(os.environ.get('OPRAVNENI_SMTP_HOST', ''))
    if not chyba_hostu and '@' not in odesilatel():  # Exchange: USER je jméno bez domény → odesílatel z FROM
        chyba_od = ('odesílatel není e-mailová adresa (OPRAVNENI_SMTP_USER je přihlašovací jméno) – '
                    'nastav secret OPRAVNENI_SMTP_FROM na adresu schránky')
        log('CHYBA', chyba_od, '|', popis_smtp_nastaveni())
        rpc('zapis_upozorneni', {'token': token, 'zaznamy': [
            {'typ': z['typ'], 'prijemce': z['prijemce'], 'polozky': [x['z']['id'] for x in z['polozky']], 'stav': 'chyba',
             'chyba': 'Před odesláním: ' + chyba_od} for z in zpravy]})
        raise SystemExit(1)
    if chyba_hostu:  # nepřipojovat se; důvod do výpisu i do logu v appce (Nastavení → poslední test)
        log('CHYBA OPRAVNENI_SMTP_HOST', chyba_hostu, '|', popis_smtp_nastaveni())
        zaznamy = [{'typ': z['typ'], 'prijemce': z['prijemce'], 'polozky': [x['z']['id'] for x in z['polozky']], 'stav': 'chyba',
                    'chyba': 'Secret OPRAVNENI_SMTP_HOST ' + chyba_hostu} for z in zpravy]
        rpc('zapis_upozorneni', {'token': token, 'zaznamy': zaznamy})
        raise SystemExit(1)
    log('SMTP nastavení:', popis_smtp_nastaveni())
    for z in zpravy:
        zaznam = {'typ': z['typ'], 'prijemce': z['prijemce'], 'polozky': [x['z']['id'] for x in z['polozky']], 'stav': 'ok'}
        try:
            posli(z['prijemce'], predmet(z, dnes), text_emailu(z, dnes, app_url))
            log('odesláno', z['oznaceni'])
        except (smtplib.SMTPException, ssl.SSLError, OSError) as e:
            chyby += 1
            zaznam.update(stav='chyba', chyba=f"fáze {getattr(e, 'faze', '?')} – {type(e).__name__}: {str(e)[:300]}")
            # do výpisu (veřejný log Actions) jen typ a kód – hlášení serveru může obsahovat adresu příjemce;
            # celé hlášení je jen v upozorneni_log (vidí jen správce)
            kod = getattr(e, 'smtp_code', None) or ''
            log('SMTP CHYBA', z['oznaceni'], 'fáze', getattr(e, 'faze', '?'), type(e).__name__, kod, popis_os_chyby(e))
        zaznamy.append(zaznam)
    n = rpc('zapis_upozorneni', {'token': token, 'zaznamy': zaznamy})
    log('log zapsán, řádků', n)
    if chyby:
        raise SystemExit(1)


if __name__ == '__main__':
    main(sys.argv[1:])
