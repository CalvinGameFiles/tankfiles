"""Builds the android/ folder: a full-screen landscape WebView app that plays www/ from inside the APK
(copied from FNAF Siege's wrapper), its launcher icons from www/img/icon-512.png, and (once) the signing key.
Run: python scripts/make-android.py"""
import os, io, secrets, shutil
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, 'android')
SRC = os.path.join(r'C:\Users\JesusFam\FnafSiege', 'android')

def put(rel, text):
    p = os.path.join(A, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    io.open(p, 'w', encoding='utf-8', newline='\n').write(text)

def from_siege(rel, dest=None, **subs):
    t = io.open(os.path.join(SRC, rel), encoding='utf-8').read()
    for a, b in subs.items(): t = t.replace(a, b)
    put(dest or rel, t)

common = {'com.calvingamefiles.fnafsiege': 'com.calvingamefiles.tankfiles', 'fnafsiege.p12': 'tankfiles.p12',
          "keyAlias 'fnafsiege'": "keyAlias 'tankfiles'", 'rootProject.name = "fnaf-siege"': 'rootProject.name = "tankfiles"'}
from_siege('app/build.gradle', **common)
from_siege('build.gradle'); from_siege('settings.gradle', **common); from_siege('gradle.properties')
from_siege('app/src/main/AndroidManifest.xml', **{'android:label="FNAF Siege"': 'android:label="TankFiles"',
    '<!-- LOCAL play: the two phones find each other through the internet, then talk directly -->': '<!-- LOCAL multiplayer: the phones find each other through the internet, then talk directly -->'})
from_siege('app/src/main/res/values/styles.xml', **{'#07060F': '#14365A'})
from_siege('app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml')
from_siege('app/src/main/java/com/calvingamefiles/fnafsiege/MainActivity.java', 'app/src/main/java/com/calvingamefiles/tankfiles/MainActivity.java',
    **{'package com.calvingamefiles.fnafsiege;': 'package com.calvingamefiles.tankfiles;',
       'https://github.com/CalvinGameFiles/fnaf-siege/': 'https://github.com/CalvinGameFiles/tankfiles/',
       '"v0.5.2"': '"v1.0"'})

# launcher icons: the legacy square icon, and the adaptive foreground (the picture inside the 108dp canvas's safe middle)
icon = Image.open(os.path.join(ROOT, 'www', 'img', 'icon-512.png')).convert('RGBA')
for name, legacy, fg in [('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216), ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)]:
    d = os.path.join(A, 'app', 'src', 'main', 'res', 'mipmap-' + name); os.makedirs(d, exist_ok=True)
    icon.resize((legacy, legacy), Image.LANCZOS).save(os.path.join(d, 'ic_launcher.png'))
    canvas = Image.new('RGBA', (fg, fg), (0, 0, 0, 0)); inner = round(fg * 0.72)
    canvas.alpha_composite(icon.resize((inner, inner), Image.LANCZOS), ((fg - inner) // 2, (fg - inner) // 2))
    canvas.save(os.path.join(d, 'ic_launcher_foreground.png'))

# the signing key: made once and kept on this PC only (the cloud build gets it from the repository secrets)
key = os.path.join(A, 'tankfiles.p12'); pw_file = os.path.join(A, 'signing-password.txt')
if not os.path.exists(key):
    import datetime
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
    pw = secrets.token_urlsafe(18)
    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'TankFiles'), x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'CalvinGameFiles')])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(k.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(now + datetime.timedelta(days=365 * 30)).sign(k, hashes.SHA256()))
    data = pkcs12.serialize_key_and_certificates(b'tankfiles', k, cert, None, serialization.BestAvailableEncryption(pw.encode()))
    open(key, 'wb').write(data); open(pw_file, 'w').write(pw + '\n')
    print('made a new signing key: android/tankfiles.p12 (password in android/signing-password.txt - both stay on this PC)')
print('android/ ready')
