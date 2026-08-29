# Neptun PowerUp! NG

**Weboldal és telepítés: https://neptun-powerup.com** · [Hibabejelentés](https://neptun-powerup.com/visszajelzes)

A [Neptun PowerUp!](https://github.com/solymosi/npu) szellemi utódja az **új Neptun webes felületre** (Angular SPA).
Tesztelve a BME Neptunján (`neptun.bme.hu/hallgatoi`); a szkript más egyetemek Neptunján is elindul
(a rendszer mindenhol ugyanaz), de ott még nincs kipróbálva.

A régi NPU a régi ASP.NET WebForms felületre épült és azzal együtt nyugdíjba vonult. Ez a projekt nulláról írja újra a funkcionalitást, de a régi DOM-manipuláció helyett elsősorban a Neptun **REST API-jára** építve (a felderített API-t lásd: [RECON.md](RECON.md)).

## Funkciók

- **Kidobásvédelem** – a szkript a lejárat előtt automatikusan új access tokent kér (`Account/GetNewTokens`), frissíti a sessionStorage-ban tárolt lejáratokat, és szintetikus eseményekkel a Neptun saját (memóriában ketyegő) visszaszámlálóját is szinkronban tartja, így a munkamenet soha nem jár le.
  A Neptun **rotálja a refresh cookie-t**, ezért két egyszerre futó frissítés közül a vesztes 401-et kap, és a szerver kilépteti a felhasználót. A szkript emiatt egyszerre csak egy frissítést enged (fülön belül és fülök között is), és félreáll, amikor az alkalmazás maga frissít.
- **Automatikus tárgylistázás** – a Tárgyfelvétel oldalon nem kell a „Tárgy keresése” gombra kattintani, a lista magától betölt.
- **Gyorsfelvétel** – a Tárgyfelvétel oldalon egy panel felsorolja az Órarendtervezőbe betervezett, még fel nem vett tárgyakat, kurzusonként a létszámmal és a „BETELT” jelzéssel. Egy kattintás (megerősítéssel) felveszi a tárgyat a betervezett kurzusaival együtt; telt kurzusnál bekapcsolható a 10 másodperces automatikus újrapróbálkozás. Ez a régi NPU „1 kattintásos tárgyfelvétel” funkciójának megfelelője, az új felület saját tervezőjére építve.
  A panel **élőben követi a tervezőt**: amint egy tárgy bekerül vagy kikerül, azonnal frissül. A változást a Neptun saját hálózati hívásaiból veszi észre, és egy olcsó lekérdezéssel is ellenőrzi, hogy akkor is helyes maradjon, ha a lehallgatás nem működik (pl. más böngészőben). A frissítés megőrzi a futó újrapróbálkozásokat és a folyamatban lévő felvételt, és nem mozdítja el a kártyákat, amíg az egered a panel felett van.
- **Helyfigyelő** – a betelt kurzusok mellett megjelenik egy „🔔 figyelem” gomb. A szkript ezután félpercenként ellenőrzi a kurzust, és amint felszabadul egy hely, **böngésző-értesítéssel és hangjelzéssel szól** – akkor is, ha épp a Neptun másik oldalán vagy. Kurzusonként bekapcsolható, hogy azonnal fel is vegye a tárgyat (ehhez külön megerősítés kell). A figyelt kurzusok a Gyorsfelvétel panel alján kezelhetők, a számuk pedig az állapotjelzőn is látszik.
  Két korlát, amit érdemes tudni: az értesítéshez a böngésző engedélye kell (az első figyelésnél kéri), és a figyelés csak addig fut, amíg a Neptun megnyitva marad egy fülön.
- **Vizsga-áttekintés** – a Vizsgák oldalain panel a felvett vizsgákkal, félévválasztó gombsorral (a választott félévet megjegyzi). Színezés a régi NPU szellemében: zöld = teljesítve, piros = sikertelen, sárga = nem jelent meg / várólistán, kék = felvett vizsga.
- **Auto-login** – a bejelentkezési oldalon tárolt Neptun-kód/jelszó párosok, 3 másodperces visszaszámlálással automatikus belépés (bármely kattintás/billentyű megszakítja). Kézi belépés után felajánlja az adatok mentését. Captcha vagy kétfaktoros bejelentkezés esetén csak kitölt, nem küld be.
- **Beépülő vezérlők** – a leggyakoribb műveletek a Neptun saját kártyáin jelennek meg, nem külön panelen: a betelt kurzusok sorában „szólj, ha felszabadul” gomb, a betervezett kurzusú tárgyaknál pedig egy egykattintásos felvétel gomb. A gombok a Neptun saját gombjainak klónjai, így pontosan úgy néznek ki, mint a többi. Az app időnként újraépíti a listát (például rendezéskor), ezért a szkript figyeli a DOM-ot, és minden újrarajzolás után visszateszi a vezérlőket – a tárgyat pedig mindig a sor **aktuális** tartalmából azonosítja, mert az Angular újrahasznosítja a sorokat, és egy régi kötés némán rossz tárgyra mutatna.
- **Testreszabható panelek** – az NPU paneljei a fejlécüknél fogva bárhová húzhatók, és mind a nyolc oldalukon (élek és sarkok) átméretezhetők. A pozíciót, méretet és az összecsukott állapotot panelenként megjegyzi. A fejléc `⤢` gombja visszaállít alaphelyzetbe, a `−`/`+` összecsukja vagy kinyitja. A panel nem húzható ki a képernyőről, és ha az ablakot kisebbre veszed, csak a megjelenítés igazodik – a beállított méreted megmarad, és visszaáll, amint újra van hely.
- **Állapotjelző** – kis jelvény a jobb alsó sarokban: NPU verzió, munkamenet hátralévő ideje, utolsó frissítés.

> **Figyelem:** a belépési adatokat a szkript – a régi NPU-hoz hasonlóan – titkosítás nélkül (base64) tárolja a saját gépeden. Csak olyan gépen használd, amelyhez más nem fér hozzá.

## Telepítés

A legegyszerűbb út a weboldalon lévő útmutató: **https://neptun-powerup.com/#telepites**
(Tampermonkey telepítése → egy kattintás a scriptre → kész; a frissítések automatikusan érkeznek.)

Kézi telepítéshez: buildeld a szkriptet (lásd lent), majd nyisd meg a `dist/npu.user.js` fájlt a böngészőben.

## Weboldal

A `site/` mappában statikus HTML/CSS/JS, keretrendszer nélkül; a `worker/` mappában egy vékony
Cloudflare Worker, amely a visszajelzés-űrlapból GitHub issue-t nyit (`wrangler.jsonc`).
A Cloudflare minden pushnál újrabuildel: `npm run build:site`, a statikus mappa a `site`
(így a friss `npu.user.js` is mindig felkerül az oldalra).

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
