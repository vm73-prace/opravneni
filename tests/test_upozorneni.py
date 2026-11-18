"""Testy scripts/upozorneni.py: výpočty (stejné případy jako Node – tests/cases.json), pravidla rozesílání,
celý běh proti falešnému Supabase a SMTP a bezpečnost SMTP (vzor kalibrace). Spuštění: python -m unittest discover -s tests -p "test_*.py"
"""
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('upozorneni', ROOT / 'scripts' / 'upozorneni.py')
U = importlib.util.module_from_spec(spec)
spec.loader.exec_module(U)
C = json.loads((ROOT / 'tests' / 'cases.json').read_text(encoding='utf-8'))

DNES = '2026-11-16'  # pondělí
UTERY = '2026-11-17'


class Vypocty(unittest.TestCase):
    def test_stejne_pripady_jako_calc_js(self):
        for c in C['opravneni']:
            with self.subTest(c['nazev']):
                s = U.stav_opravneni(c['zaznam'], c.get('druh') or {}, c.get('dnes') or C['dnes'], c.get('nastaveni'))
                for k, v in c['ocekavano'].items():
                    self.assertEqual(s[k], v, k)

    def test_k_reseni(self):
        self.assertTrue(U.k_reseni({'stav': 'predstih', 'po_terminu': False}))
        self.assertTrue(U.k_reseni({'stav': 'propadle', 'po_terminu': False}))
        self.assertTrue(U.k_reseni({'stav': 'objednano', 'po_terminu': True}))
        self.assertFalse(U.k_reseni({'stav': 'objednano', 'po_terminu': False}))
        self.assertFalse(U.k_reseni({'stav': 'platne', 'po_terminu': False}))
        self.assertFalse(U.k_reseni({'stav': 'neurcita', 'po_terminu': False}))


def zaznam(id_, technik, platnost, **x):
    return {'id': id_, 'technik_id': technik, 'druh_id': 'd1', 'cislo': 'C-' + id_, 'platnost_do': platnost, 'neurcita': False,
            'predstih_dni': None, 'objednano_na': None, 'updated_at': '2026-01-01T00:00:00+00:00', **x}


def data(**x):
    d = {
        'nastaveni': {'predstih_dni': 90, 'prijemci': 'sef@firma.cz, kancelar@firma.cz'},
        'kategorie': [{'id': 'ppk', 'nazev': 'PPK', 'poradi': 1}],
        'druhy': [{'id': 'd1', 'kategorie': 'ppk', 'nazev': 'Mandík – požární klapky', 'predstih_dni': None}],
        'technici': [{'id': 'A', 'jmeno': 'Adam Alfa', 'email': 'adam@firma.cz', 'aktivni': True},
                     {'id': 'B', 'jmeno': 'Bára Beta', 'email': '', 'aktivni': True},
                     {'id': 'X', 'jmeno': 'Xaver Bývalý', 'email': 'x@firma.cz', 'aktivni': False}],
        'opravneni': [
            zaznam('a1', 'A', '2026-12-20'),                                   # v předstihu (34 dní)
            zaznam('a2', 'A', '2028-01-01'),                                   # platné
            zaznam('b1', 'B', '2026-11-01'),                                   # propadlé
            zaznam('b2', 'B', '2026-12-01', objednano_na='2026-12-10'),        # objednané v termínu → nehlásí se
            zaznam('b3', 'B', '2026-11-10', objednano_na='2026-11-12'),        # objednané po termínu → k řešení
            zaznam('x1', 'X', '2026-11-01'),                                   # neaktivní technik → nehlásí se
        ],
        'log': [],
    }
    d.update(x)
    return d


class Pravidla(unittest.TestCase):
    def test_polozky_k_reseni(self):
        p = U.polozky_k_reseni(data(), DNES)
        self.assertEqual([x['z']['id'] for x in p], ['b1', 'a1', 'b3'])  # propadlé, předstih, po termínu

    def test_prvni_den_vstup_spravcum_i_technikovi_s_emailem(self):
        z = U.plan(data(), UTERY)
        self.assertEqual([(m['kdo'], m['prijemce'], m['typ']) for m in z],
                         [('spravce', 'sef@firma.cz', 'vstup'), ('spravce', 'kancelar@firma.cz', 'vstup'), ('technik', 'adam@firma.cz', 'vstup')])
        self.assertEqual({x['z']['id'] for x in z[0]['polozky']}, {'b1', 'a1', 'b3'})
        self.assertEqual(z[0]['nove'], {'a1', 'b1'})                        # po termínu není „vstup“
        self.assertEqual([x['z']['id'] for x in z[2]['polozky']], ['a1'])   # technik jen svoje

    def test_uz_hlasene_se_v_tydnu_neopakuje(self):
        log = [{'cas': '2026-11-10T05:00:00+00:00', 'typ': 'vstup', 'prijemce': 'sef@firma.cz', 'polozky': ['a1', 'b1', 'b3'], 'stav': 'ok'}]
        self.assertEqual(U.plan(data(log=log), UTERY), [])

    def test_pondeli_tydenni_souhrn(self):
        log = [{'cas': '2026-11-10T05:00:00+00:00', 'typ': 'vstup', 'prijemce': 'sef@firma.cz', 'polozky': ['a1', 'b1'], 'stav': 'ok'}]
        z = U.plan(data(log=log), DNES)
        self.assertEqual([(m['prijemce'], m['typ']) for m in z],
                         [('sef@firma.cz', 'tydenni'), ('kancelar@firma.cz', 'tydenni'), ('adam@firma.cz', 'tydenni')])

    def test_zmena_zaznamu_po_hlaseni_znamena_novy_vstup(self):
        # záznam a1 změněný (nový doklad, pořád v předstihu) po posledním hlášení → znovu „vstup“
        log = [{'cas': '2026-11-10T05:00:00+00:00', 'typ': 'vstup', 'prijemce': 'sef@firma.cz', 'polozky': ['a1', 'b1'], 'stav': 'ok'}]
        d = data(log=log)
        d['opravneni'][0]['updated_at'] = '2026-11-12T08:00:00+00:00'
        z = U.plan(d, UTERY)
        self.assertEqual({m['typ'] for m in z}, {'vstup'})
        self.assertEqual(z[0]['nove'], {'a1'})

    def test_neodeslany_vstup_se_zkusi_znovu(self):
        log = [{'cas': '2026-11-16T05:00:00+00:00', 'typ': 'vstup', 'prijemce': 'sef@firma.cz', 'polozky': ['a1', 'b1'], 'stav': 'chyba'}]
        self.assertEqual(U.plan(data(log=log), UTERY)[0]['typ'], 'vstup')

    def test_opakovany_beh_v_pondeli_neposle_podruhe(self):
        log = [{'cas': f'{DNES}T05:00:00+00:00', 'typ': t, 'prijemce': p, 'polozky': ['a1', 'b1', 'b3'], 'stav': 'ok'}
               for t, p in (('vstup', 'sef@firma.cz'), ('vstup', 'kancelar@firma.cz'), ('vstup', 'adam@firma.cz'))]
        self.assertEqual(U.plan(data(log=log), DNES), [])

    def test_nic_k_reseni_nic_neodchazi(self):
        d = data(opravneni=[zaznam('a2', 'A', '2028-01-01')])
        self.assertEqual(U.plan(d, DNES), [])

    def test_test_rezim_jen_spravcum(self):
        # [TEST] jen správcům / příjemcům souhrnu, nikdy technikům (i když mají e-mail a položky)
        z = U.plan(data(), DNES, test=True)
        self.assertEqual([(m['kdo'], m['prijemce'], m['typ']) for m in z],
                         [('spravce', 'sef@firma.cz', 'test'), ('spravce', 'kancelar@firma.cz', 'test')])
        self.assertEqual({x['z']['id'] for x in z[0]['polozky']}, {'b1', 'a1', 'b3'})  # souhrn za všechny
        z = U.plan(data(opravneni=[]), DNES, test=True)
        self.assertEqual([m['kdo'] for m in z], ['spravce', 'spravce'])

    def test_text_spravce_a_technika(self):
        z = U.plan(data(), UTERY)
        pr = U.predmet(z[0], UTERY)
        self.assertEqual(pr, 'Oprávnění: 1 propadlé, 1 v předstihu, 1 po termínu')
        t = U.text_emailu(z[0], UTERY, 'https://app.example/')
        self.assertIn('Oprávnění techniků – stav k 17. 11. 2026', t)
        self.assertIn('PROPADLÉ\n  • Bára Beta – Mandík – požární klapky (PPK): propadlé před 16 dny, platí do 1. 11. 2026 [NOVÉ]', t)
        self.assertIn('Adam Alfa – Mandík – požární klapky (PPK): za 33 dní, platí do 20. 12. 2026 [NOVÉ]', t)
        self.assertIn('termín 12. 11. proběhl – nahraj nový doklad', t)
        self.assertIn('Otevřít appku: https://app.example/', t)
        self.assertNotIn('Xaver', t)
        t2 = U.text_emailu(z[2], UTERY)
        self.assertIn('Tvoje oprávnění', t2)
        self.assertNotIn('Bára', t2)
        self.assertNotIn('Adam Alfa –', t2)  # technikovi se jeho jméno neopakuje
        zt = U.plan(data(), DNES, test=True)
        self.assertTrue(U.predmet(zt[0], DNES).startswith('[TEST] Oprávnění:'))
        self.assertIn('Zkušební e-mail', U.text_emailu(zt[0], DNES))
        zt = U.plan(data(opravneni=[]), DNES, test=True)
        self.assertIn('Nic k vyřízení', U.text_emailu(zt[0], DNES))


class Beh(unittest.TestCase):
    """Celý main(): falešný Supabase (lokální HTTP, obě RPC) a falešné SMTP – nic nejde ven."""

    def setUp(self):
        import http.server
        import os
        import threading
        self.pozadavky, self.zapsano = [], []
        self.data = data()
        test = self

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                test.pozadavky.append((self.path, dict(self.headers), body))
                ok = body.get('token') == 'tajny-token'
                if not ok:
                    vysledek, kod = {'code': '28000', 'message': 'neplatný token'}, 400
                elif self.path.endswith('/upozorneni_data'):
                    vysledek, kod = test.data, 200
                else:
                    test.zapsano += body['zaznamy']
                    vysledek, kod = len(body['zaznamy']), 200
                self.send_response(kod)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(vysledek).encode())

            def log_message(self, *a):
                pass

        self.srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.puvodni_env = dict(os.environ)
        os.environ.update({'OPRAVNENI_SUPABASE_URL': f'http://127.0.0.1:{self.srv.server_address[1]}', 'OPRAVNENI_SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_x',
                           'OPRAVNENI_NOTIFY_TOKEN': 'tajny-token', 'OPRAVNENI_SMTP_HOST': 'smtp.firma.cz', 'OPRAVNENI_SMTP_PORT': '587',
                           'OPRAVNENI_SMTP_USER': 'upozorneni@firma.cz', 'OPRAVNENI_SMTP_PASSWORD': 'heslo'})
        self.odeslane, self.selhat = [], set()
        odeslane, selhat = self.odeslane, self.selhat

        class FakeSMTP:
            def __init__(self, host, port, timeout=None, context=None):
                self.info = {'host': host, 'port': port, 'tls': False}

            def ehlo(self):
                pass

            def starttls(self, context=None):
                self.info['tls'] = context is not None

            def login(self, u, p):
                self.info['login'] = u

            def send_message(self, m):
                if m['To'] in selhat:
                    raise U.smtplib.SMTPRecipientsRefused({m['To']: (550, b'neznamy prijemce')})
                self.info['msg'] = m
                odeslane.append(self.info)

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        self.puvodni = (U.smtplib.SMTP, U.smtplib.SMTP_SSL, U.dnes_praha, U.socket.getaddrinfo)
        U.smtplib.SMTP = U.smtplib.SMTP_SSL = FakeSMTP
        self.dns_chyba = None
        test_ = self

        puvodni_getaddrinfo = U.socket.getaddrinfo

        def fake_getaddrinfo(host, port, *a, **k):  # jen testovací SMTP server; ostatní (falešné Supabase) beze změny
            if host != 'smtp.firma.cz':
                return puvodni_getaddrinfo(host, port, *a, **k)
            if test_.dns_chyba:
                raise test_.dns_chyba
            return [(2, 1, 6, '', ('192.0.2.1', port))]
        U.socket.getaddrinfo = fake_getaddrinfo
        U.dnes_praha = lambda: UTERY

    def tearDown(self):
        import os
        self.srv.shutdown()
        os.environ.clear()
        os.environ.update(self.puvodni_env)
        U.smtplib.SMTP, U.smtplib.SMTP_SSL, U.dnes_praha, U.socket.getaddrinfo = self.puvodni

    def test_ostry_beh_posle_a_zapise_log(self):
        U.main([])
        self.assertEqual([p[0] for p in self.pozadavky], ['/rest/v1/rpc/upozorneni_data', '/rest/v1/rpc/zapis_upozorneni'])
        h = {k.lower(): v for k, v in self.pozadavky[0][1].items()}
        self.assertEqual(h['content-profile'], 'opravneni')
        self.assertEqual(h['apikey'], 'sb_publishable_x')
        self.assertNotIn('authorization', h)  # žádný service_role ani jiný JWT
        self.assertEqual([o['msg']['To'] for o in self.odeslane], ['sef@firma.cz', 'kancelar@firma.cz', 'adam@firma.cz'])
        self.assertTrue(all(o['tls'] and o['login'] == 'upozorneni@firma.cz' and o['msg']['From'] == 'upozorneni@firma.cz' for o in self.odeslane))
        self.assertEqual([(z['typ'], z['prijemce'], z['stav']) for z in self.zapsano],
                         [('vstup', 'sef@firma.cz', 'ok'), ('vstup', 'kancelar@firma.cz', 'ok'), ('vstup', 'adam@firma.cz', 'ok')])
        self.assertEqual(sorted(self.zapsano[2]['polozky']), ['a1'])

    def test_chyba_smtp_u_jednoho_prijemce(self):
        import contextlib
        import io
        self.selhat.add('kancelar@firma.cz')
        out = io.StringIO()
        with self.assertRaises(SystemExit), contextlib.redirect_stdout(out):
            U.main([])
        self.assertNotIn('@firma.cz', out.getvalue())  # výpis (log Actions) bez adres i při chybě SMTP
        self.assertIn('SMTP CHYBA spravce #2 fáze odeslání SMTPRecipientsRefused', out.getvalue())
        self.assertEqual(len(self.odeslane), 2)  # ostatní odešly
        chyba = [z for z in self.zapsano if z['stav'] == 'chyba']
        self.assertEqual(len(chyba), 1)
        self.assertEqual(chyba[0]['prijemce'], 'kancelar@firma.cz')
        self.assertIn('SMTPRecipientsRefused', chyba[0]['chyba'])
        self.assertNotIn('heslo', chyba[0]['chyba'])

    def test_dry_run_a_nahled_nic_neposilaji_ani_nezapisuji(self):
        import tempfile
        U.main(['--dry-run'])
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / 'nahled.txt'
            U.main(['--nahled', str(f)])
            obsah = f.read_text(encoding='utf-8')
        self.assertEqual(self.odeslane, [])
        self.assertEqual(self.zapsano, [])
        self.assertIn('KOMU: adam@firma.cz', obsah)
        self.assertIn('[NOVÉ]', obsah)

    def test_test_email_log_typ_test(self):
        U.main(['--test-email', '--dry-run'])  # test má přednost před dry-run
        self.assertTrue(all(o['msg']['Subject'].startswith('[TEST]') for o in self.odeslane))
        self.assertEqual({z['typ'] for z in self.zapsano}, {'test'})
        self.assertEqual([o['msg']['To'] for o in self.odeslane], ['sef@firma.cz', 'kancelar@firma.cz'])  # technik ne

    def test_test_email_bez_spravcu_chyba(self):
        self.data['nastaveni']['prijemci'] = ''
        with self.assertRaises(SystemExit):
            U.main(['--test-email'])
        self.assertEqual(self.odeslane, [])

    def test_nic_k_odeslani(self):
        self.data['opravneni'] = []
        U.main([])
        self.assertEqual(self.odeslane, [])
        self.assertEqual([p[0] for p in self.pozadavky], ['/rest/v1/rpc/upozorneni_data'])  # log se nezapisuje

    def test_spatny_tvar_smtp_hostu_bez_pripojeni_a_s_logem(self):
        import contextlib
        import io
        import os
        os.environ['OPRAVNENI_SMTP_HOST'] = 'smtp://smtp.firma.cz:587'
        out = io.StringIO()
        with self.assertRaises(SystemExit), contextlib.redirect_stdout(out):
            U.main([])
        self.assertEqual(self.odeslane, [])  # k serveru se nepřipojuje
        self.assertEqual({z['stav'] for z in self.zapsano}, {'chyba'})  # důvod vidí správce v appce
        self.assertIn('OPRAVNENI_SMTP_HOST obsahuje schéma', self.zapsano[0]['chyba'])
        self.assertIn('CHYBA OPRAVNENI_SMTP_HOST obsahuje schéma', out.getvalue())
        self.assertNotIn('smtp.firma.cz', out.getvalue())  # hodnota secretu se nevypisuje

    def test_chyba_dns_faze_a_diagnostika_bez_hodnot(self):
        import contextlib
        import hashlib
        import io
        self.dns_chyba = U.socket.gaierror(-3, 'Temporary failure in name resolution')
        out = io.StringIO()
        with self.assertRaises(SystemExit), contextlib.redirect_stdout(out):
            U.main([])
        v = out.getvalue()
        self.assertEqual(self.odeslane, [])
        self.assertIn('SMTP CHYBA spravce #1 fáze DNS gaierror', v)
        self.assertIn('DNS errno -3', v)
        h = hashlib.sha256(b'smtp.firma.cz').hexdigest()
        self.assertIn("SMTP nastavení: HOST délka 13 (před ořezem 13), teček 2, '@' ne, mezera ne, znaků mimo ASCII 0 | PORT 587 | USER délka 19, '@' ano", v)
        for citlive in ('smtp.firma.cz', 'upozorneni@', 'heslo', h, h[:4], h[-4:], 'SHA-256'):
            self.assertNotIn(citlive, v)
        self.assertNotRegex(v, r'[0-9a-f]{4}…[0-9a-f]{4}')  # žádné okraje hashů (log Actions je veřejný)
        self.assertTrue(all(z['chyba'].startswith('fáze DNS – gaierror') for z in self.zapsano))

    def test_faze_auth(self):
        import contextlib
        import io
        out = io.StringIO()
        smtp = U.smtplib.SMTP
        puvodni_login = smtp.login

        def login_selze(self, u, p):
            raise U.smtplib.SMTPAuthenticationError(535, b'5.7.3 Authentication unsuccessful')
        smtp.login = login_selze
        try:
            with self.assertRaises(SystemExit), contextlib.redirect_stdout(out):
                U.main([])
        finally:
            smtp.login = puvodni_login
        self.assertIn('fáze AUTH SMTPAuthenticationError 535 (přihlášení odmítnuto', out.getvalue())
        self.assertTrue(self.zapsano[0]['chyba'].startswith('fáze AUTH – SMTPAuthenticationError'))

    def test_odesilatel_z_from_prihlaseni_z_user(self):
        import os
        os.environ['OPRAVNENI_SMTP_USER'] = 'upozor'           # Exchange: jméno bez domény
        os.environ['OPRAVNENI_SMTP_FROM'] = 'upozorneni@firma.cz'
        U.main([])
        self.assertTrue(all(o['login'] == 'upozor' and o['msg']['From'] == 'upozorneni@firma.cz' for o in self.odeslane))
        self.assertEqual(len(self.odeslane), 3)

    def test_odesilatel_bez_zavinace_chyba_pred_pripojenim(self):
        import contextlib
        import io
        import os
        os.environ['OPRAVNENI_SMTP_USER'] = 'upozor'
        os.environ.pop('OPRAVNENI_SMTP_FROM', None)
        out = io.StringIO()
        with self.assertRaises(SystemExit), contextlib.redirect_stdout(out):
            U.main([])
        self.assertEqual(self.odeslane, [])
        self.assertIn('nastav secret OPRAVNENI_SMTP_FROM', out.getvalue())
        self.assertIn("FROM (nevyplněný → USER), odesílatel má '@' ne", out.getvalue())
        self.assertTrue(all(z['stav'] == 'chyba' and 'OPRAVNENI_SMTP_FROM' in z['chyba'] for z in self.zapsano))
        self.assertNotIn('upozor', out.getvalue().replace('upozorneni', ''))  # hodnota USER se nevypisuje

    def test_spatny_token(self):
        import contextlib
        import hashlib
        import io
        import os
        os.environ['OPRAVNENI_NOTIFY_TOKEN'] = 'spatny'
        out = io.StringIO()
        with self.assertRaises(SystemExit), contextlib.redirect_stdout(out):
            U.main([])
        self.assertEqual(self.odeslane, [])
        v = out.getvalue()
        self.assertIn('token: délka 6 znaků (před ořezem 6)', v)
        self.assertIn('token nesouhlasí s hashem v DB – vygeneruj token znovu, přepiš secret OPRAVNENI_NOTIFY_TOKEN a pošli nový hash ke kontrole', v)
        h = hashlib.sha256(b'spatny').hexdigest()
        for cast in ('spatny', h[:4], h[-4:], 'SHA-256'):
            self.assertNotIn(cast, v)
        self.assertNotRegex(v, r'[0-9a-f]{4}…[0-9a-f]{4}')

    def test_vypis_bez_emailu_a_jmen(self):
        import contextlib
        import io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            U.main([])
        vypis = out.getvalue()
        for citlive in ('@firma.cz', 'Adam', 'Bára', 'C-a1', 'tajny-token', 'heslo'):
            self.assertNotIn(citlive, vypis)
        self.assertIn('spravce #2', vypis)
        import hashlib
        h = hashlib.sha256(b'tajny-token').hexdigest()
        self.assertIn('token: délka 11 znaků (před ořezem 11)', vypis)
        for cast in (h, h[:4], h[-4:], 'SHA-256'):
            self.assertNotIn(cast, vypis)  # ani hash, ani jeho okraje
        self.assertNotRegex(vypis, r'[0-9a-f]{4}…[0-9a-f]{4}')


class TvarHostu(unittest.TestCase):
    def test_kontrola_hostu(self):
        for h in ('mail.example.cz', 'smtp.example.com', ' smtp.firma.cz ', 'mail.firma.cz.'):
            self.assertIsNone(U.kontrola_hostu(h), h)
        for h, cast in (('', 'prázdný'), ('smtp://smtp.firma.cz', 'schéma'), ('smtp.firma.cz:587', 'port'), ('upozorneni@firma.cz', "'@'"),
                        ('"smtp.firma.cz"', 'uvozovky'), ('smtp firma.cz', 'mezeru'), ('localhost', 'platný'), ('smtp.firma.cz/x', 'platný')):
            self.assertIn(cast, U.kontrola_hostu(h), h)

    def test_popis_chyb(self):
        import socket
        self.assertIn('DNS', U.popis_os_chyby(socket.gaierror(-2, 'Name or service not known')))
        self.assertIn('PORT', U.popis_os_chyby(ConnectionRefusedError()))
        self.assertEqual(U.popis_os_chyby(OSError('x')), '')


class FalesnySMTP:
    """Lokální SMTP server (skutečný socket a TLS) pro test skutečného smtplib ve skriptu (převzato z kalibrace).
    rezim: 'bez_starttls', 'starttls_454', 'starttls_rozbity', 'tls' (řádné TLS s certifikátem)."""

    def __init__(self, rezim, cert=None, klic=None):
        import socket
        import threading
        self.rezim, self.cert, self.klic, self.prikazy = rezim, cert, klic, []
        self.sock = socket.socket()
        self.sock.bind(('127.0.0.1', 0))
        self.sock.listen(1)
        self.sock.settimeout(10)
        self.port = self.sock.getsockname()[1]
        self.vlakno = threading.Thread(target=self._obsluha, daemon=True)
        self.vlakno.start()

    def _obsluha(self):
        import ssl
        try:
            conn, _ = self.sock.accept()
        except OSError:
            return
        conn.settimeout(10)
        f = conn.makefile('rwb')
        tls = False

        def posli(t):
            f.write((t + '\r\n').encode())
            f.flush()

        posli('220 falesny ESMTP')
        try:
            while True:
                radek = f.readline().decode().strip()
                if not radek:
                    return
                cmd = radek.split()[0].upper()
                self.prikazy.append(cmd)
                if cmd in ('EHLO', 'HELO'):
                    rozsireni = []
                    if self.rezim != 'bez_starttls' and not tls:
                        rozsireni.append('STARTTLS')
                    if tls or self.rezim == 'bez_starttls':
                        rozsireni.append('AUTH LOGIN')
                    for x in ['falesny'] + rozsireni:
                        posli('250-' + x)
                    posli('250 OK')
                elif cmd == 'STARTTLS':
                    if self.rezim == 'starttls_454':
                        posli('454 TLS not available')
                    elif self.rezim == 'starttls_rozbity':
                        posli('220 go ahead')
                        conn.close()
                        return
                    else:
                        posli('220 go ahead')
                        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                        ctx.load_cert_chain(self.cert, self.klic)
                        try:
                            conn = ctx.wrap_socket(conn, server_side=True)
                        except (ssl.SSLError, OSError):
                            return
                        f = conn.makefile('rwb')
                        tls = True
                elif cmd == 'AUTH':
                    posli('334 UGFzc3dvcmQ6')
                    f.readline()
                    self.prikazy.append('AUTH-HESLO')
                    posli('235 ok')
                elif cmd == 'DATA':
                    posli('354 data')
                    while f.readline().strip() != b'.':
                        pass
                    posli('250 prijato')
                elif cmd == 'QUIT':
                    posli('221 bye')
                    return
                else:
                    posli('250 OK')
        except OSError:
            return
        finally:
            for x in (f, conn, self.sock):
                try:
                    x.close()
                except OSError:
                    pass


class SmtpBezpecnost(unittest.TestCase):
    """a) bez úspěšného STARTTLS se skript nikdy nepřihlásí; b) certifikát i jméno serveru se ověřují."""

    @classmethod
    def setUpClass(cls):
        import shutil
        import subprocess
        import tempfile
        cls.tmp = tempfile.TemporaryDirectory()
        openssl = shutil.which('openssl') or r'C:\Program Files\Git\usr\bin\openssl.exe'
        cls.cert, cls.klic = str(Path(cls.tmp.name) / 'cert.pem'), str(Path(cls.tmp.name) / 'klic.pem')
        cls.cert_jiny, cls.klic_jiny = str(Path(cls.tmp.name) / 'jiny.pem'), str(Path(cls.tmp.name) / 'jiny-klic.pem')
        for cn, san, klic, cert in (('localhost', 'DNS:localhost,IP:127.0.0.1', cls.klic, cls.cert),
                                    ('jiny.example', 'DNS:jiny.example', cls.klic_jiny, cls.cert_jiny)):
            subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=' + cn,
                            '-addext', 'subjectAltName=' + san, '-keyout', klic, '-out', cert], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def posli(self, server):
        import os
        stare = dict(os.environ)
        os.environ.update({'OPRAVNENI_SMTP_HOST': '127.0.0.1', 'OPRAVNENI_SMTP_PORT': str(server.port),
                           'OPRAVNENI_SMTP_USER': 'upozorneni@firma.cz', 'OPRAVNENI_SMTP_PASSWORD': 'tajne-heslo'})
        try:
            U.posli('prijemce@example.com', 'Test', 'text')
        finally:
            os.environ.clear()
            os.environ.update(stare)
            server.vlakno.join(5)

    def assertNeprihlasil(self, server):
        for p in ('AUTH', 'AUTH-HESLO', 'MAIL'):
            self.assertNotIn(p, server.prikazy)

    def test_a_server_bez_starttls_chyba_bez_prihlaseni(self):
        s = FalesnySMTP('bez_starttls')
        with self.assertRaises(U.smtplib.SMTPNotSupportedError):
            self.posli(s)
        self.assertNeprihlasil(s)

    def test_a_odmitnuty_starttls_chyba_bez_prihlaseni(self):
        s = FalesnySMTP('starttls_454')
        with self.assertRaises(U.smtplib.SMTPResponseException):
            self.posli(s)
        self.assertNeprihlasil(s)

    def test_a_selhany_tls_handshake_chyba_bez_prihlaseni(self):
        s = FalesnySMTP('starttls_rozbity')
        with self.assertRaises((U.ssl.SSLError, OSError, U.smtplib.SMTPException)):
            self.posli(s)
        self.assertNeprihlasil(s)

    def test_b_neduveryhodny_certifikat_odmitnut(self):
        s = FalesnySMTP('tls', self.cert, self.klic)
        with self.assertRaises(U.ssl.SSLCertVerificationError):
            self.posli(s)
        self.assertNeprihlasil(s)

    def test_b_cizi_jmeno_serveru_odmitnuto(self):
        puvodni = U.ssl.create_default_context
        U.ssl.create_default_context = lambda: puvodni(cafile=self.cert_jiny)
        try:
            s = FalesnySMTP('tls', self.cert_jiny, self.klic_jiny)
            with self.assertRaises(U.ssl.SSLCertVerificationError) as e:
                self.posli(s)
        finally:
            U.ssl.create_default_context = puvodni
        self.assertIn('mismatch', str(e.exception).lower())
        self.assertNeprihlasil(s)

    def test_b_kontrola_duveryhodny_certifikat_projde(self):
        puvodni = U.ssl.create_default_context
        U.ssl.create_default_context = lambda: puvodni(cafile=self.cert)
        try:
            s = FalesnySMTP('tls', self.cert, self.klic)
            self.posli(s)
        finally:
            U.ssl.create_default_context = puvodni
        self.assertEqual(s.prikazy[:3], ['EHLO', 'STARTTLS', 'EHLO'])
        self.assertIn('AUTH-HESLO', s.prikazy)
        self.assertIn('MAIL', s.prikazy)

    def test_c_sonda_bez_prihlaseni(self):
        import contextlib
        import io
        import os
        puvodni = U.ssl.create_default_context
        U.ssl.create_default_context = lambda: puvodni(cafile=self.cert)
        s = FalesnySMTP('tls', self.cert, self.klic)
        stare = dict(os.environ)
        os.environ.update({'OPRAVNENI_SMTP_HOST': 'localhost', 'OPRAVNENI_SMTP_PORT': str(s.port)})
        out = io.StringIO()
        try:
            with self.assertRaises(SystemExit), contextlib.redirect_stdout(out):
                U.main(['--sonda-smtp'])  # 'localhost' bez tečky → odmítnuto kontrolou tvaru, nepřipojí se
            os.environ['OPRAVNENI_SMTP_HOST'] = '127.0.0.1'  # platný tvar, certifikát má SAN IP:127.0.0.1
            with contextlib.redirect_stdout(out):
                U.main(['--sonda-smtp'])
        finally:
            os.environ.clear()
            os.environ.update(stare)
            U.ssl.create_default_context = puvodni
            s.vlakno.join(5)
        self.assertIn('sonda: metody AUTH LOGIN', out.getvalue())
        self.assertIn('certifikát ověřen', out.getvalue())
        self.assertNotIn('vydal', out.getvalue())  # vydavatel ani platnost certifikátu do veřejného logu nejdou
        self.assertNotIn('platí do', out.getvalue())
        self.assertEqual(s.prikazy[:3], ['EHLO', 'STARTTLS', 'EHLO'])
        self.assertNotIn('AUTH', s.prikazy)  # nikdy se nepřihlásí
        self.assertNotIn('MAIL', s.prikazy)  # nic neodešle

    def test_b_skript_nikde_nevypina_overovani(self):
        zdroj = (ROOT / 'scripts' / 'upozorneni.py').read_text(encoding='utf-8')
        kod = '\n'.join(r for r in zdroj.splitlines() if not r.strip().startswith('#'))
        for zakazane in ('CERT_NONE', 'check_hostname = False', '_create_unverified_context', '_create_stdlib_context', '.starttls()'):
            self.assertNotIn(zakazane, kod)


class Praha(unittest.TestCase):
    def test_dnes_v_praze(self):
        self.assertRegex(U.dnes_praha(), r'^\d{4}-\d{2}-\d{2}$')


if __name__ == '__main__':
    unittest.main()
