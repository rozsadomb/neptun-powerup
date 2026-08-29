# Üzemeltetés: Cloudflare deploy

A weboldal és a script ugyanabból a repóból megy ki. Minden `main`-re pusholt
változás automatikusan élesedik, és a Tampermonkey-t használó felhasználók a
frissített scriptet is maguktól megkapják.

**Felállás:** Cloudflare **Worker + static assets** (`wrangler.jsonc`). A `site/`
mappát a Workers assets szolgálja ki, a `worker/` mappában lévő kód pedig
kizárólag az `/api/*` útvonalakon fut (`run_worker_first`).

> A régi Pages Functions modell (`functions/` mappa) itt **nem** működik: a
> Cloudflare ilyenkor „csak statikus assetek” projektként hozza létre, amihez
> nem enged környezeti változót adni — és az API-végpont sem jön létre. Ha a
> dashboardon ezt látod:
> *„Variables cannot be added to a Worker that only has static assets”*,
> akkor a projektben nincs Worker kód. A `wrangler.jsonc` `main` mezője oldja meg.

## 1. A projekt bekötése (egyszeri)

1. Lépj be a [dash.cloudflare.com](https://dash.cloudflare.com) oldalon.
2. **Workers & Pages** → **Create** → **Import a repository** → `rozsadomb/neptun-powerup`.
3. Build beállítások:

   | Mező | Érték |
   |---|---|
   | Build command | `npm run build:site` |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | *(üresen hagyni)* |

   A többit a `wrangler.jsonc` adja (projektnév, statikus mappa, API-útvonal),
   a Node verziót pedig a `.node-version` fájl (22 — a wrangler ennél régebbivel nem fut).
4. **Deploy**. Egy-két perc múlva él a `https://<projekt>.workers.dev` címen.

Ha a projekt már létezik és statikus assetként jött létre, nem kell újra
létrehozni: elég egy push a `wrangler.jsonc`-vel, a következő build már
Workerként deployol, és megjelenik a **Variables and Secrets** szekció.

## 2. A visszajelzés-űrlap bekapcsolása (ide kell a token)

Az űrlap GitHub issue-t nyit a repóban. Ehhez egy token kell, amit **csak**
erre a repóra és **csak** issue-írásra adunk ki.

1. GitHub → [Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
   - **Repository access:** Only select repositories → `neptun-powerup`
   - **Permissions → Repository permissions → Issues:** `Read and write`
   - (Minden más maradjon `No access`.)
2. Cloudflare → a `neptun-powerup` Worker → **Settings** → **Variables and secrets** → **Add**:

   | Név | Típus | Érték |
   |---|---|---|
   | `GITHUB_TOKEN` | **Secret** | a most kapott token |

   A `GITHUB_REPO` értéke a `wrangler.jsonc` `vars` szekciójából jön, azt nem kell felvenni.
3. Mentés után **Deployments** → a legutóbbi deploy → **Retry**, hogy a token életbe lépjen.

Az ellenőrzéshez hívd meg a **https://neptun-powerup.com/api/health** címet: megmondja,
be van-e állítva mindkettő (az értéküket sosem mutatja).

Amíg ez nincs beállítva, az űrlap udvarias hibaüzenetet ad, és a felhasználót a
GitHub issue-khoz irányítja — tehát semmi nem törik el.

## 3. Saját domain — `neptun-powerup.com`

A projekt címe **https://neptun-powerup.com**; a script fejléce (`src/meta.txt`) és a
weboldal metaadatai már erre mutatnak.

A Cloudflare-oldali bekötés:

1. Ha a domain még nem a Cloudflare-nél van: **Account home** → **Domains** → **Add a domain**,
   majd a névszervereket (nameserver) állítsd át a regisztrátornál a kapott Cloudflare-esekre.
   Ez néhány perctől pár óráig tart, amíg átáll.
2. **Workers & Pages** → `neptun-powerup` → **Domains & Routes** → **Add** → **Custom domain**.
3. Add meg: `neptun-powerup.com`, majd ismételd meg a `www.neptun-powerup.com` címmel is,
   ha azt is szeretnéd (a Cloudflare a DNS-rekordot magától felveszi).

Ha később mégis változna a cím, ezeket kell átírni (és utána verziót emelni + pusholni,
különben a meglévő telepítések a régi címről próbálnának frissülni):

- `src/meta.txt` → `@homepageURL`, `@supportURL`, `@downloadURL`, `@updateURL`
- `site/index.html`, `site/visszajelzes.html` → `canonical` és `og:url`
- `README.md` → a fejlécben lévő link

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

Node 22 kell hozzá (`nvm use 22`), mert a wrangler ennél régebbivel nem indul.

```bash
npm run build:site
npx wrangler dev --port 8788
```

Ekkor a statikus oldal és az `/api/feedback` is fut. A GitHub-token nélkül az
űrlap a „még nincs beállítva” ágra fut; tokennel együtt így próbálható:

```bash
npx wrangler dev --port 8788 \
  --var GITHUB_TOKEN:<token> --var GITHUB_REPO:rozsadomb/neptun-powerup
```
