# Neptun PowerUp! NG

A [Neptun PowerUp!](https://github.com/solymosi/npu) szellemi utódja az **új Neptun webes felületre** (Angular SPA), elsőként a BME Neptunjára (`neptun.bme.hu/hallgatoi`).

A régi NPU a régi ASP.NET WebForms felületre épült és azzal együtt nyugdíjba vonult. Ez a projekt nulláról írja újra a funkcionalitást, de a régi DOM-manipuláció helyett elsősorban a Neptun **REST API-jára** építve (a felderített API-t lásd: [RECON.md](RECON.md)).

## Funkciók (v0.3)

- **Kidobásvédelem** – a szkript a lejárat előtt automatikusan új access tokent kér (`Account/GetNewTokens`), frissíti a sessionStorage-ban tárolt lejáratokat, és szintetikus eseményekkel a Neptun saját (memóriában ketyegő) visszaszámlálóját is szinkronban tartja, így a munkamenet soha nem jár le.
  A Neptun **rotálja a refresh cookie-t**, ezért két egyszerre futó frissítés közül a vesztes 401-et kap, és a szerver kilépteti a felhasználót. A szkript emiatt egyszerre csak egy frissítést enged (fülön belül és fülök között is), és félreáll, amikor az alkalmazás maga frissít.
- **Automatikus tárgylistázás** – a Tárgyfelvétel oldalon nem kell a „Tárgy keresése” gombra kattintani, a lista magától betölt.
- **Gyorsfelvétel** – a Tárgyfelvétel oldalon egy panel felsorolja az Órarendtervezőbe betervezett, még fel nem vett tárgyakat, kurzusonként a létszámmal és a „BETELT” jelzéssel. Egy kattintás (megerősítéssel) felveszi a tárgyat a betervezett kurzusaival együtt; telt kurzusnál bekapcsolható a 10 másodperces automatikus újrapróbálkozás. Ez a régi NPU „1 kattintásos tárgyfelvétel” funkciójának megfelelője, az új felület saját tervezőjére építve.
  A panel **élőben követi a tervezőt**: amint egy tárgy bekerül vagy kikerül, azonnal frissül. A változást a Neptun saját hálózati hívásaiból veszi észre, és egy olcsó lekérdezéssel is ellenőrzi, hogy akkor is helyes maradjon, ha a lehallgatás nem működik (pl. más böngészőben). A frissítés megőrzi a futó újrapróbálkozásokat és a folyamatban lévő felvételt, és nem mozdítja el a kártyákat, amíg az egered a panel felett van.
- **Helyfigyelő** – a betelt kurzusok mellett megjelenik egy „🔔 figyelem” gomb. A szkript ezután félpercenként ellenőrzi a kurzust, és amint felszabadul egy hely, **böngésző-értesítéssel és hangjelzéssel szól** – akkor is, ha épp a Neptun másik oldalán vagy. Kurzusonként bekapcsolható, hogy azonnal fel is vegye a tárgyat (ehhez külön megerősítés kell). A figyelt kurzusok a Gyorsfelvétel panel alján kezelhetők, a számuk pedig az állapotjelzőn is látszik.
  Két korlát, amit érdemes tudni: az értesítéshez a böngésző engedélye kell (az első figyelésnél kéri), és a figyelés csak addig fut, amíg a Neptun megnyitva marad egy fülön.
- **Vizsga-áttekintés** – a Vizsgák oldalain panel a felvett vizsgákkal, félévválasztó gombsorral (a választott félévet megjegyzi). Színezés a régi NPU szellemében: zöld = teljesítve, piros = sikertelen, sárga = nem jelent meg / várólistán, kék = felvett vizsga.
- **Auto-login** – a bejelentkezési oldalon tárolt Neptun-kód/jelszó párosok, 3 másodperces visszaszámlálással automatikus belépés (bármely kattintás/billentyű megszakítja). Kézi belépés után felajánlja az adatok mentését. Captcha vagy kétfaktoros bejelentkezés esetén csak kitölt, nem küld be.
- **Testreszabható panelek** – az NPU paneljei a fejlécüknél fogva bárhová húzhatók, és mind a nyolc oldalukon (élek és sarkok) átméretezhetők. A pozíciót, méretet és az összecsukott állapotot panelenként megjegyzi. A fejléc `⤢` gombja visszaállít alaphelyzetbe, a `−`/`+` összecsukja vagy kinyitja. A panel nem húzható ki a képernyőről, és ha az ablakot kisebbre veszed, csak a megjelenítés igazodik – a beállított méreted megmarad, és visszaáll, amint újra van hely.
- **Állapotjelző** – kis jelvény a jobb alsó sarokban: NPU verzió, munkamenet hátralévő ideje, utolsó frissítés.

> **Figyelem:** a belépési adatokat a szkript – a régi NPU-hoz hasonlóan – titkosítás nélkül (base64) tárolja a saját gépeden. Csak olyan gépen használd, amelyhez más nem fér hozzá.

## Telepítés

1. Telepítsd a [Tampermonkey](https://www.tampermonkey.net/) kiegészítőt.
2. Buildeld a szkriptet (lásd lent), majd nyisd meg a `dist/npu.user.js` fájlt a böngészőben és telepítsd.

## Fejlesztés

```bash
npm install
npm run build      # dist/npu.user.js
npm run watch      # újrabuild minden változtatásra
npm run typecheck  # TypeScript ellenőrzés
```

## Architektúra

- `src/core/api.ts` – Neptun REST API kliens: a tokent az Angular app sessionStorage-ából olvassa, frissítéskor vissza is írja, így a két világ szinkronban marad.
- `src/core/router.ts` – SPA route-figyelő (history API hook).
- `src/core/modules.ts` – modulrendszer: minden modul route-mintához kötve aktiválódik/deaktiválódik, cleanup-pal.
- `src/core/dom.ts` – MutationObserver-alapú DOM-segédek (nincs szoros polling).
- `src/core/storage.ts` – beállítás-tárolás (GM storage, fejlesztésnél localStorage fallback).
- `src/modules/*` – a tényleges funkciók, egy fájl = egy modul.

## Licensz

MIT
