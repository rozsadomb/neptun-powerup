# Neptun PowerUp! NG

A [Neptun PowerUp!](https://github.com/solymosi/npu) szellemi utódja az **új Neptun webes felületre** (Angular SPA), elsőként a BME Neptunjára (`neptun.bme.hu/hallgatoi`).

A régi NPU a régi ASP.NET WebForms felületre épült és azzal együtt nyugdíjba vonult. Ez a projekt nulláról írja újra a funkcionalitást, de a régi DOM-manipuláció helyett elsősorban a Neptun **REST API-jára** építve (a felderített API-t lásd: [RECON.md](RECON.md)).

## Funkciók (v0.1)

- **Kidobásvédelem** – a szkript a lejárat előtt automatikusan új access tokent kér (`Account/GetNewTokens`), frissíti a sessionStorage-ban tárolt lejáratokat, és szintetikus eseményekkel a Neptun saját (memóriában ketyegő) visszaszámlálóját is szinkronban tartja, így a munkamenet soha nem jár le.
- **Automatikus tárgylistázás** – a Tárgyfelvétel oldalon nem kell a „Tárgy keresése” gombra kattintani, a lista magától betölt.
- **Állapotjelző** – kis jelvény a jobb alsó sarokban: NPU verzió, munkamenet hátralévő ideje, utolsó frissítés.

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
