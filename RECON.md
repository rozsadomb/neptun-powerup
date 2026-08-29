# BME Neptun – új felület felderítés (2026-08-29)

## Alapok

- **URL:** https://neptun.bme.hu/hallgatoi/ (login route: `/hallgatoi/login`)
- **Stack:** Angular 19.2 SPA (`app-root`, `neptun-*` komponensek), ~204 lazy-loaded JS chunk (~11,5 MB)
- **Neptun Web verzió a felderítéskor:** 2026.2.11 (2026-08-14)
- **API:** REST/JSON, base: `https://neptun.bme.hu/hallgatoi/api/`
- Válaszformátum: `{ "data": ..., "notification": [...] }`

## Autentikáció és session

- `POST api/Account/Authenticate` → JWT access token (HS256), **5 perc lejárat**
  - válaszban: `neptunCode`, `accessToken`, `isCaptchaRequired`, `isTwoFactorRequired`, `sessionTimeoutInMinutes: 30`
- Token frissítés: `Account/GetNewTokens` (refresh token feltehetően HttpOnly cookie-ban — `document.cookie` üres)
- Access token a **sessionStorage**-ban: `access_token`, `access_token_expiration_date`, `session_expiration_date`, `login_type`, `tabId`, `tid`
- Munkamenet: 30 perc, a fejlécben visszaszámláló ("Munkamenet lejárata"), aktivitásra resetel
- Egyéb Account végpontok: `ForgottenPassword`, `ResetPassword`, `ValidateTokenForForgottenPassword`, `HasUserTokenRegistration`

## Menüstruktúra (hallgatói)

Kedvencek | Kezdőoldal | Naptár | Tanulmányok | **Tárgyak** | **Vizsgák** | Pénzügyek | Ügyintézés | Információk

- Tárgyak: Tárgyfelvétel (`/hallgatoi/subjects/registration`), Felvett tárgyak, Felvett kurzusok, Feladatok, Megajánlott jegyek, Tárgyhoz kapcsolódó kérvények, Tárgyelismerési szabályok
- Vizsgák: Áttekintés, Vizsgajelentkezés (`/hallgatoi/exams/overview/registration`), Felvett vizsgák, Hátralévő vizsgák, Eredmények, Záróvizsgák

## Tárgyfelvétel API (`SubjectApplication/`)

| Végpont | Mit csinál |
|---|---|
| `Terms` | félévek |
| `SubjectTypes`, `Curriculum`, `SubjectGroup`, `LanguagesForGivenTerm` | szűrők |
| `SystemParameters` | rendszerparaméterek |
| `SchedulableSubjects` | tárgylista (GET, query: `request.subjectType`, `request.termId`, `sortAndPage.firstRow/lastRow` — a UI 50-esével lapoz) |
| `GetSubjectsCourses` | egy tárgy kurzusai (subjectId, termId, curriculumTemplateId, curriculumTemplateLineId) |
| **`SubjectSignin`** / **`SubjectSignout`** | tényleges tárgyfelvétel / leadás |
| `CourseChange` | kurzusváltás |
| `ScheduleSubjectAndCourses`, `GetScheduledCourses`, `ScheduledSubjectsWithScheduledCourses`, `UnScheduleCourse`, `DeleteAllScheduledScheduledSubjects`, `SubjectCourseLocations` | **beépített Órarendtervező** — kurzusok előre betervezése! |

Kurzusadatok (GetSubjectsCourses válasz): `maxLimit`, `registeredStudentsCount`, `isFull`, `waitingStudentsCount`, `willBeOnWaitingList`, `isOnWaitingList`, `minLimit`, órarendi időpontok (`classInstanceInfos`, `classInstanceTimeTableList`), oktató, nyelv, rangsorpontok.

Tárgyadatok (SchedulableSubjects válasz): `id` (GUID), `code`, `title`, `credit`, `isRegistered`, `isCompleted`, `isInProgress`, `scheduledCourseIds`, `requirementType`, mintatanterv-adatok.

## Vizsga API

| Végpont | Mit csinál |
|---|---|
| `Exam/GetTerms` | félévek |
| `ExamRegistration/GetExamsList` | vizsgalista (a UI automatikusan lekéri, 0–9999 sor!) |
| `ExamRegistration/GetExamSubjects` | tárgyválasztó |
| `ExamRegistration/GetExamRegistrationDetail` | vizsga részletei |
| **`ExamRegistration/SignUpForExam`** / **`UnSubscribe`** | vizsgajelentkezés / leadás |
| `Exam/ChangeExam`, `Exam/GetChangeExamsList` | vizsgacsere |
| `Exam/GetExamSignInStudentsList`, `GetExamRoomsList`, `GetExamDetailExamConditions`, `GetExamPreviousHistoryList` | részletek |
| `ExamOverview/GetAvailableExamsCount`, `GetDashboardExamEntries*` | áttekintés |

## Tárgyfelvétel: a signin payload és a kurzus-azonosítók (2026-08-29, igazolva)

A Neptun saját `subjectSignIn$` kódja (chunk-XOEM3RGI.js) ezt küldi:

```
POST SubjectApplication/SubjectSignin
{ courseIds, curriculumTemplateId, curriculumTemplateLineId, subjectId, termId }
```

**Csapda:** a `courseIds` a *kurzusok* id-ja (a `GetSubjectsCourses` / `GetScheduledCourses` válasz
`id` mezője), **nem** a `scheduledCourseIds`-ben lévő érték! Utóbbi az órarendtervező rekord
azonosítója (`scheduledCourseId`), és a signin elutasítaná. A `termId` itt a **GUID**
(`61741419-...`), miközben a `Terms` végpont numerikus `value`-t ad (`70634`) — a query
paraméterekben a numerikus kell, a payloadban a GUID.

`GetScheduledCourses?request.termId=<numerikus>` egyetlen hívásban visszaad mindent:
* `scheduledCourseId != null && !isRegistered` → **betervezett, még fel nem vett** kurzus,
* `isRegistered: true` (és `scheduledCourseId: null`) → már felvett kurzus (az órarendben van),
* kurzusonként: `id` (kurzus id), `subjectId`, `curriculumTemplateId`, `curriculumTemplateLineId`,
  `termId` (GUID), `title`, `code`, `type`, `tutorName`, `subjectCredit`, `isFull`, `strength`,
  `maxLimit`, `waitingStudentsCount`, `willBeOnWaitingList`, órarendi időpontok.

`SubjectTypes`: 1 = Mintatantervi, 2 = Egyéb szabadon választható, 3 = Minden további intézményi.
A 2-es és 3-as típushoz a `SchedulableSubjects` **kötelezően kér** `curriculumTemplateId`-t,
enélkül 400-at ad (`modelStateErrors`).

Az órarendtervezőbe rakás/kivétel: `ScheduleSubjectAndCourses` / `UnScheduleCourse`
(a tárgy alatti „Tervezőhöz adás” kapcsoló) — ez **nem** tárgyfelvétel, szabadon visszavonható.

## Az app hálózati rétege és a változásfigyelés költsége (2026-08-29, mérve)

Az Angular app **XMLHttpRequest**-tel hív minden API-t (klasszikus `HttpXhrBackend`): a
`window.fetch`-re tett szonda nulla app-hívást fogott, az `XMLHttpRequest.prototype.open`-re tett
szonda viszont azonnal elkapta a `POST .../ScheduleSubjectAndCourses`-t. Mivel az NPU saját
kliense `fetch`-et használ, egy XHR-only hook pontosan az app műveleteit látja, a sajátjainkat nem
(nincs visszacsatolási hurok).

A tervező állapotának lekérdezése két végponton, mért költséggel:

| Végpont | Méret | Idő | Mire jó |
|---|---|---|---|
| `GetScheduledCourses` | ~17 KB | ~200 ms | teljes kurzus-részletek (létszám, BETELT, órarend) |
| `ScheduledSubjectsWithScheduledCourses` | ~0,9 KB | ~56 ms | csak a tárgyak + `scheduledCourseIds` |

Ezért a változásfigyelésre a **könnyű** végpont való (a `scheduledCourseIds` halmazának
összehasonlítása), és csak tényleges változáskor érdemes a nehezet lekérni a részletekhez.

## Vizsgák: felvett vizsgák listája

`ExamRegisteredExams/GetRegisteredExamsList?request.termId=<GUID>&sortAndPage.firstRow=0&sortAndPage.lastRow=9999`
→ tárgyanként csoportosítva: `subjectName`, `subjectCode`, `registeredExamList[]`, benne
`examType`, `examTutors`, `examRooms`, `fromDate`, `missed`, `justifiedMissing`, `isWaiting`,
`strength`/`maxStrength`, és a kész **`uiDisplayState.reasons`** (pl. `["Teljesített","Megjelent","Beszámít"]`)
— ebből egyszerű a színezés, nem kell jegyszöveget parse-olni, mint a régi NPU-ban.
A félévek itt az `Exam/GetTerms` GUID-jai (más, mint a `SubjectApplication/Terms` numerikus id-ja).

## Bejelentkezés (login oldal)

`POST Account/Authenticate` payload:
`{ userName, password, captcha, captchaIdentifier, token, subtituteGUID, LCID }`.
A form Angular reactive form; a DOM-ban `input#userName` (lehet `readonly`) és a jelszó a
`#password input` alatt. A submit gomb a form `button[type=submit]` eleme („Bejelentkezés”).
Programból az érték beírása után `input` + `change` esemény kell, hogy a FormControl átvegye
(élőben igazolva: `ng-valid ng-dirty` lesz mindkét mezőn).
Az `Authenticate` válasz `isCaptchaRequired` / `isTwoFactorRequired` flageket is ad.

## További API-kontrollerek (bundle-grep, részleges)

`Account`, `ContextUserProfile` (szűrők/oszloprendek mentése szerverre!), `Dashboard`, `DocumentContainer`, `Exam*`, `FinalExams`, `General`, `InsertImposition`, `LegalRemedy`, `Message`, `MyTrainings`, `NoteSearch`, `PayingOrganizationPartners`, `Permissions`, `PersonGroup`, `Profiles`, `Queries`, `Questionnaires`, `RequestForm(Core)`, `StudentCard`, `SubjectCourse`, `Translations`, `UserInfo`, `UserProfile`, `UserSearch`

## A kliensoldali session-kezelés belső működése (IdleService)

A fejléc „Munkamenet lejárata” visszaszámlálója **memóriában** (NGXS store) ketyeg, NEM a
sessionStorage-ból. A releváns kód a `chunk-OG5JBOO2.js`-ben (IdleService) és a `main-*.js`-ben van:

- `secondsLeftUntilTimeout$`: másodpercenként csökken; **0-nál kliensoldali `Logout` akciót dispatchel** → a felhasználót kidobja akkor is, ha a szerver-session él.
- 150 mp alatt „idle” állapot, 120 mp alatt figyelmeztető modál.
- `checkSessionExpirationAndCountdownTimer()`: a **sessionStorage-ból** (`session_expiration_date`) olvassa vissza a lejáratot és reseteli a számlálót. Két dolog hívja meg:
  1. `visibilitychange` esemény, ha `document.visibilityState === "visible"` (szintetikus esemény is működik — élőben igazolva);
  2. felhasználói interakció (mousedown/mousewheel/touchstart/touchmove/scroll/keydown, 3 mp debounce) idle állapotban.
- A token-service a `sessionTimeoutInMinutes`-ből számolja és a sessionStorage-ba is írja a lejáratot.

**Kidobásvédelem receptje (v0.1-ben implementálva és élőben tesztelve):** `GetNewTokens` a token
lejárata előtt (frissíti a szerver-sessiont is) + a sessionStorage kulcsok frissítése + periodikus
szintetikus `visibilitychange` (előtér) és `scroll` (idle/háttér eset) esemény, hogy a kliensoldali
számláló is a friss értéket vegye át.

## Megfigyelések a régi NPU funkciók szemszögéből

- **Kidobásvédelem:** továbbra is releváns (30 perc). Keep-alive = olcsó API-hívás időnként + `Account/GetNewTokens`.
- **Auto-listázás tárgyfelvételnél:** a Tárgyfelvétel oldalon most is kézzel kell "Tárgy keresése"-t nyomni → a funkció továbbra is értékes. (A vizsgalista viszont már automatikusan töltődik.)
- **Kurzus-előjelölés (courseStore):** az új Neptunban van **beépített órarendtervező** (`ScheduleSubjectAndCourses`, a tárgyaknál `scheduledCourseIds`) — átfedés a régi funkcióval. Az NPU hozzáadott értéke: a betervezett kurzusok **egykattintásos/tömeges tényleges felvétele** (`SubjectSignin`) a jelentkezés pillanatában, gyors újrapróbálkozás telt kurzusnál (`isFull`, várólista-adatok élőben elérhetők).
- **Oldalméret-hack:** okafogyott lehet (a vizsgalista 9999 sort kér); tárgylistánál a lapozás 50-es, ott még lehet értelme.
- **Fejléc-elrejtés, menü-linkek:** újraértékelendő — a SPA menü máshogy működik, a routing rendes URL-eken megy.
- **Szűrők/beállítások:** a Neptun most szerverre menti a szűrőket (`ContextUserProfile/SaveFilter`, `GetFilter`).
- **Auto-login:** login form + `Account/Authenticate`; figyelni kell: `isCaptchaRequired`, `isTwoFactorRequired` flagek léteznek (captchát nem kerülünk meg).

## Architektúra-következtetések az új NPU-hoz

1. **API-first megközelítés**: a userscript kiolvashatja az access tokent a sessionStorage-ból és saját (Bearer) hívásokat indíthat — sokkal stabilabb, mint a DOM-turkálás.
2. DOM-kiegészítésnél: Angular komponensek belsejét nem érdemes piszkálni; inkább saját overlay/panel UI + `MutationObserver` (nem 500ms-os polling).
3. Modul-aktiválás: SPA route (`location.pathname`) figyelése (history API hook), nem `ctrl=` paraméter.
4. Build: TypeScript + modern bundler, userscript (Tampermonkey) target — a régi webpack+meta.txt minta jó kiindulás.
