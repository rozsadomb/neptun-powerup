# Üzemeltetés: Cloudflare deploy

A weboldal és a script ugyanabból a repóból megy ki. Minden `main`-re pusholt
változás automatikusan élesedik, és a Tampermonkey-t használó felhasználók a
frissített scriptet is maguktól megkapják.

**Felállás:** Cloudflare **Worker + static assets** (`wrangler.jsonc`). A `site/`
mappát a Workers assets szolgálja ki, a `worker/` mappában lévő kód pedig
kizárólag az `/api/*` és az `/admin` útvonalakon fut (`run_worker_first`).

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

## 2b. A bejelentések privát tárolója és az admin oldal (GDPR)

Az űrlapon megadott email cím **nem kerül a nyilvános GitHub issue-ba**: oda csak a
bejelentés szövege megy. A teljes bejelentést (szöveg + a megadott email cím) a Worker
egy privát Cloudflare KV-tárolóba teszi az issue számához kötve, ahonnan
`FEEDBACK_TTL_DAYS` (alapból 90) nap után magától törlődik. A karbantartó a
**https://neptun-powerup.com/admin** oldalon látja őket egy tokennel: onnan tud emailt
írni, elolvasni a szöveget, és törölni.

Amíg ez nincs beállítva, semmi nem törik el: az issue megnyílik, az űrlap pedig
megmondja a bejelentőnek, hogy az email címét most nem tudta elmenteni.

1. **KV-névtér létrehozása** (egyszer). Helyben, bejelentkezve:

   ```bash
   npx wrangler login
   ```

   ```bash
   npx wrangler kv namespace create FEEDBACK
   ```

   A kimenetben egy `id` van. (Dashboardon ugyanez: **Storage & Databases** → **KV** →
   **Create**, a név tetszőleges, az ID-t onnan is kimásolhatod.)
2. Az ID-t a `wrangler.jsonc` `kv_namespaces` sorába kell írni, és a sort bekapcsolni
   (a fájlban ki van kommentezve, a helye jelölve). A `binding` maradjon `FEEDBACK`.
3. **Admin token.** Generálj egy hosszú, véletlen értéket:

   ```bash
   openssl rand -hex 32
   ```

   Cloudflare → a Worker → **Settings** → **Variables and secrets** → **Add**:

   | Név | Típus | Érték |
   |---|---|---|
   | `ADMIN_TOKEN` | **Secret** | a generált érték |

4. Push (a `wrangler.jsonc` változása miatt), majd a **/api/health** mutatja:
   `feedbackStoreConfigured: true`, `adminTokenConfigured: true`.
5. Nyisd meg a **/admin** oldalt, add meg a tokent. A böngésző megjegyzi
   (a „Kilépés” gomb törli).

A megőrzési időt a `wrangler.jsonc` `FEEDBACK_TTL_DAYS` értéke szabja meg; az űrlap
és az adatkezelési tájékoztató a számot a `/api/health`-ből olvassa, tehát elég itt
átírni. A korábbi issue-kban kézzel bent maradt email címeket a GitHubon kell
kiszerkeszteni, és az issue „edited” előzményéből is törölni (a szerkesztési előzmény
mellett a három pont → *Delete*), különben ott továbbra is látható marad.

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

A privát tároló és az admin oldal is kipróbálható helyben. Ehhez a KV-kötés legyen
bekapcsolva a `wrangler.jsonc`-ben (helyi módban az id-t a wrangler nem ellenőrzi,
a KV a gépeden, a `.wrangler/` mappában él), a token pedig változóként adható:

```bash
npx wrangler dev --port 8788 --var ADMIN_TOKEN:proba
```

Utána a http://localhost:8788/admin oldalon a `proba` tokennel lehet belépni.

## 6. A régi weboldal visszaállítása

A 2026-09-02-i újratervezés előtti weboldal a `regi-weboldal` gitágon és tagen
van megőrizve (ugyanarra a commitra mutatnak). Ha vissza kell hozni, két út van:

**Gitből, tartósan** (a `main`-re kerül, és a push után magától élesedik):

```bash
git checkout regi-weboldal -- site
git commit -m "Weboldal: visszaállás a régi változatra"
git push
```

Ez csak a `site/` mappát állítja vissza; a szkript, a worker és a build érintetlen
marad. (A `site/fonts/` mappa a régi változatban nem létezett, a checkout azt is
eltünteti, ez rendben van.) Az új változat ugyanígy visszahozható a `main` korábbi
commitjából.

**Cloudflare-en, azonnal, git nélkül:** a Worker **Deployments** listájában bármelyik
korábbi deploy mellett van **Rollback**. Ez percek alatt visszaáll, de a következő
push újra a `main` tartalmát élesíti, ezért hosszabb távra a git-utat használd.
