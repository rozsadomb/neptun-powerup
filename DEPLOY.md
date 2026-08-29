# Üzemeltetés: Cloudflare Pages deploy

A weboldal és a script ugyanabból a repóból megy ki. Minden `main`-re pusholt
változás automatikusan élesedik, és a Tampermonkey-t használó felhasználók a
frissített scriptet is maguktól megkapják.

## 1. A projekt bekötése a Cloudflare-be (egyszeri)

1. Lépj be a [dash.cloudflare.com](https://dash.cloudflare.com) oldalon (ingyenes fiók elég).
2. Bal oldalt: **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Engedélyezd a GitHub-hozzáférést, és válaszd ki a `rozsadomb/neptun-powerup` repót.
4. A build beállítások (fontos, hogy pontosan ezek legyenek):

   | Mező | Érték |
   |---|---|
   | Framework preset | `None` |
   | Build command | `npm run build:site` |
   | Build output directory | `site` |
   | Root directory | *(üresen hagyni)* |

   A Node verziót a repóban lévő `.node-version` fájl adja meg (20).
5. **Save and Deploy**. Egy-két perc múlva él a `https://<projekt>.pages.dev` címen.

## 2. A visszajelzés-űrlap bekapcsolása

Az űrlap egy GitHub issue-t nyit a repóban. Ehhez egy token kell, amit **csak**
erre a repóra és **csak** issue-írásra adunk ki.

1. GitHub → [Fine-grained personal access token létrehozása](https://github.com/settings/personal-access-tokens/new)
   - **Repository access:** Only select repositories → `neptun-powerup`
   - **Permissions → Repository permissions → Issues:** `Read and write`
   - (Minden más maradjon `No access`.)
   - Lejárat: amit jónak látsz; lejáratkor cserélni kell.
2. Cloudflare → a Pages projekt → **Settings** → **Variables and Secrets** → **Add**:
   - `GITHUB_TOKEN` = a most kapott token (típus: **Secret**, hogy titkosítva tárolódjon)
   - `GITHUB_REPO` = `rozsadomb/neptun-powerup` (típus: Text)
3. **Retry deployment**, hogy a változók életbe lépjenek.

Amíg ez nincs beállítva, az űrlap udvarias hibaüzenetet ad, és a felhasználót a
GitHub issue-khoz irányítja — tehát semmi nem törik el.

## 3. Saját domain (opcionális, de ajánlott)

1. Cloudflare → a Pages projekt → **Custom domains** → **Set up a custom domain**.
2. Add meg a domaint, és kövesd a DNS-lépéseket (ha a domain is Cloudflare-nél van, egy kattintás).
3. **Fontos:** a domain bekötése után írd át a script fejlécében az URL-eket, különben a
   frissítések a régi címről érkeznének:
   - `src/meta.txt` → `@homepageURL`, `@supportURL`, `@downloadURL`, `@updateURL`
   - `site/index.html` és `site/visszajelzes.html` → a GitHub-linkek mellett a szövegek
   - `README.md` → a fejlécben lévő link

   Ezután emelj verziót és pushold — a meglévő telepítések így állnak át az új címre.

## 4. Új verzió kiadása

```bash
npm version patch --no-git-tag-version   # vagy minor / major
npm run typecheck && npm run build:site  # ellenőrzés helyben
git add -A && git commit -m "vX.Y.Z: ..." && git push
```

A push után a Cloudflare automatikusan deployol. A Tampermonkey néhány órán belül
észreveszi az új verziószámot a `@updateURL`-en, és frissíti a felhasználók scriptjét.

> A verziószámot mindig emelni kell, különben a Tampermonkey nem tekinti frissítésnek.

## 5. Helyi próba

```bash
npm run build:site
npx wrangler pages dev site --port 8788 --compatibility-date=2026-05-03
```

A Functions is fut (`/api/feedback`). Ha a GitHub-tokent is tesztelnéd:

```bash
npx wrangler pages dev site --port 8788 --compatibility-date=2026-05-03 \
  --binding GITHUB_TOKEN=<token> --binding GITHUB_REPO=rozsadomb/neptun-powerup
```
