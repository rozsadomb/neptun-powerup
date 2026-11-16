// Neptun PowerUp! NG, projektoldal.
// A plakátbetű mértékre szedése, böngésző-felismerés a telepítési útmutatóhoz,
// a visszajelzés-űrlap kezelése, a menü, a GYIK-accordion és a hero
// interaktív bemutatója.

(function () {
  "use strict";

  // A belépő mozgás csak akkor rejti el a tintát a nyomásig, ha ez a szkript
  // tényleg fut: ha nem töltődik be, a cím JS nélkül is látszik.
  document.documentElement.classList.add("js");

  var BMAC_URL = "https://buymeacoffee.com/neptunpowerup";
  // Az easing a stíluslap tokenje (--ease-out), hogy a WAAPI-animációk ne szakadjanak el a CSS-től.
  var EASE_OUT = (getComputedStyle(document.documentElement).getPropertyValue("--ease-out") || "").trim()
    || "cubic-bezier(.23, 1, .32, 1)";
  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduceMotion = motionQuery.matches;
  if (motionQuery.addEventListener) {
    motionQuery.addEventListener("change", function (e) { reduceMotion = e.matches; });
  }

  var TM_LINKS = {
    chrome: "https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo",
    edge: "https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd",
    firefox: "https://addons.mozilla.org/hu/firefox/addon/tampermonkey/",
    opera: "https://addons.opera.com/en/extensions/details/tampermonkey-beta/",
    safari: "https://apps.apple.com/app/tampermonkey/id1482490089",
  };

  // Melyik böngészőben kell fejlesztői mód a userscriptekhez (Chromium MV3 szabály).
  var NEEDS_DEV_MODE = { chrome: true, edge: true, opera: true, firefox: false, safari: false };
  var EXT_URLS = { chrome: "chrome://extensions", edge: "edge://extensions", opera: "opera://extensions" };

  function detectBrowser() {
    var ua = navigator.userAgent;
    if (ua.indexOf("Firefox") !== -1) return "firefox";
    if (ua.indexOf("Edg/") !== -1) return "edge";
    if (ua.indexOf("OPR/") !== -1 || ua.indexOf("Opera") !== -1) return "opera";
    if (ua.indexOf("Chrome") !== -1 || ua.indexOf("Chromium") !== -1) return "chrome";
    if (ua.indexOf("Safari") !== -1) return "safari";
    return "chrome";
  }

  // ---------- plakátbetű mértékre szedése ----------
  // A címsorok a betű szélességtengelyével (Archivo, 62-125%) pontosan a
  // rendelkezésre álló szélességet töltik ki, mint a kézzel szedett plakátokon.
  // data-fit="line": ha a szélességtengely nem elég, a betűméret is igazodik.
  // data-fit="stretch": csak a szélesség változik, a méret marad (a sor rövid
  // szónál nem tölti ki a mértéket, ez rendben van).
  function initFit() {
    var lines = Array.prototype.slice.call(document.querySelectorAll("[data-fit]"));
    if (!lines.length) return;
    var MIN = 62, MAX = 125, GROW_CAP = 1.6;

    function widthAt(el, text, stretch) {
      el.style.fontStretch = stretch + "%";
      return text.getBoundingClientRect().width;
    }

    function fit(el) {
      var text = el.querySelector(".fit__t");
      if (!text) return;
      el.style.fontSize = "";
      var target = el.clientWidth;
      if (!target) return;
      var base = parseFloat(getComputedStyle(el).fontSize);
      var wMin = widthAt(el, text, MIN);
      if (wMin > target) {
        // Még a legkeskenyebb betűvel sem fér ki: a méret enged.
        el.style.fontSize = (base * target / wMin) + "px";
        el.style.fontStretch = MIN + "%";
        return;
      }
      var wMax = widthAt(el, text, MAX);
      if (wMax < target) {
        if (el.dataset.fit !== "line") { el.style.fontStretch = MAX + "%"; return; }
        // A legszélesebb betűvel sem tölti ki: a sor nő, egy határig.
        el.style.fontSize = (base * Math.min(GROW_CAP, target / wMax)) + "px";
        wMax = widthAt(el, text, MAX);
        if (wMax <= target) { el.style.fontStretch = MAX + "%"; return; }
      }
      var lo = MIN, hi = MAX;
      for (var i = 0; i < 9; i++) {
        var mid = (lo + hi) / 2;
        if (widthAt(el, text, mid) > target) hi = mid; else lo = mid;
      }
      el.style.fontStretch = lo.toFixed(1) + "%";
    }

    function fitAll() {
      lines.forEach(fit);
      document.documentElement.classList.add("fit-ready");
    }

    var ready = document.fonts && document.fonts.load
      ? document.fonts.load('800 100px "Archivo"').then(function () { return document.fonts.ready; })
      : Promise.resolve();
    ready.then(fitAll, fitAll);
    // Ha a betű ennyi idő alatt sem jön meg, a tinta a tartalékbetűvel száll le,
    // és a sorok újraszedődnek, amikor az Archivo megérkezik (ready.then fent).
    var FALLBACK_MS = 700;
    setTimeout(function () {
      if (!document.documentElement.classList.contains("fit-ready")) fitAll();
    }, FALLBACK_MS);

    var timer = null;
    window.addEventListener("resize", function () {
      clearTimeout(timer);
      timer = setTimeout(fitAll, 120);
    });
  }

  // ---------- mobil menü ----------
  function initNav() {
    var toggle = document.getElementById("navToggle");
    var menu = document.getElementById("menu");
    if (!toggle || !menu) return;

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      menu.classList.toggle("is-open", open);
      document.body.classList.toggle("menu-open", open);
    }
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  // ---------- telepítési varázsló: szegmentált böngészőválasztó ----------
  function initInstallWizard() {
    var pills = document.getElementById("browserPills");
    if (!pills) return;

    var tmLink = document.getElementById("tmLink");
    var devStep = document.getElementById("devModeStep");
    var extUrl = document.getElementById("extUrl");
    var thumb = pills.querySelector(".seg__thumb");
    var current = null;
    var thumbState = null;

    // A csúszka csak transformmal mozog (FLIP): a szélességet azonnal átállítjuk,
    // és a régi helyzetből/méretből animálunk az újba.
    // A futó animáció közbeni tényleges helyzet a computed mátrixból:
    // translate (e, f) és scaleX (a), a transform-origin 0 50% miatt.
    function currentThumb() {
      var m = getComputedStyle(thumb).transform;
      var v = m && m !== "none" ? m.match(/matrix\(([^)]+)\)/) : null;
      if (!v) return null;
      var n = v[1].split(",").map(Number);
      return { x: n[4], y: n[5], sx: n[0] };
    }

    function moveThumb(animate) {
      var active = pills.querySelector("button.active");
      if (!active || !thumb) return;
      var w = active.offsetWidth;
      var x = active.offsetLeft - 4;
      var y = active.offsetTop - 4;
      // Az új méret beállítása ELŐTT olvassuk ki, hol tart most a csúszka.
      var from = animate && thumbState ? currentThumb() : null;
      var fromW = thumbState ? thumbState.w : w;
      if (thumb.getAnimations) thumb.getAnimations().forEach(function (a) { a.cancel(); });
      thumb.style.width = w + "px";
      thumb.style.height = active.offsetHeight + "px";
      thumb.style.transform = "translate(" + x + "px, " + y + "px)";
      if (from && thumb.animate && !reduceMotion) {
        thumb.animate(
          [
            { transform: "translate(" + from.x + "px, " + from.y + "px) scaleX(" + (from.sx * fromW / w) + ")" },
            { transform: "translate(" + x + "px, " + y + "px) scaleX(1)" },
          ],
          { duration: 240, easing: EASE_OUT }
        );
      }
      thumbState = { x: x, y: y, w: w };
    }

    var firstSelect = true;
    // Az állomás megjelenése/eltűnése View Transitionnel: a többi állomás a
    // helyére csúszik, nem ugrik. Betöltéskor és csökkentett mozgásnál azonnali.
    function setDevStep(show) {
      if (devStep.hidden === !show) return;
      if (firstSelect || reduceMotion || !document.startViewTransition) {
        devStep.hidden = !show;
        return;
      }
      document.startViewTransition(function () { devStep.hidden = !show; });
    }

    function select(browser) {
      current = browser;
      pills.querySelectorAll("button").forEach(function (b) {
        var on = b.dataset.browser === browser;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      tmLink.href = TM_LINKS[browser];
      setDevStep(NEEDS_DEV_MODE[browser]);
      if (extUrl && EXT_URLS[browser]) extUrl.textContent = EXT_URLS[browser];
      moveThumb(true);
    }

    pills.addEventListener("click", function (e) {
      var button = e.target.closest("button[data-browser]");
      if (button && button.dataset.browser !== current) select(button.dataset.browser);
    });
    window.addEventListener("resize", function () { moveThumb(false); });

    select(detectBrowser());
    firstSelect = false;
    // A betűk betöltése után a gombok szélessége változhat: igazítás ugrás nélkül.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { moveThumb(false); });
    }
  }

  // ---------- visszajelzés-űrlap ----------
  function initFeedbackForm() {
    var form = document.getElementById("feedbackForm");
    if (!form) return;

    var status = document.getElementById("formStatus");
    var submit = document.getElementById("fbSubmit");

    function show(kind, html) {
      status.hidden = false;
      status.className = "form-status " + kind;
      status.innerHTML = html;
      status.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      submit.disabled = true;
      submit.textContent = "Küldés...";

      var payload = {
        type: form.querySelector('input[name="type"]:checked').value,
        title: form.querySelector('[name="title"]').value.trim(),
        body: form.querySelector('[name="body"]').value.trim(),
        university: form.querySelector('[name="university"]').value.trim(),
        contact: form.querySelector('[name="contact"]').value.trim(),
        website: form.querySelector('[name="website"]').value, // honeypot
      };

      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().then(function (data) { return { ok: res.ok, data: data }; });
        })
        .then(function (result) {
          if (result.ok && result.data.url) {
            form.reset();
            var message = "Köszönöm, a bejelentésedet rögzítettem. " +
              '<a href="' + result.data.url + '" target="_blank" rel="noopener">Itt tudod követni</a>.';
            // Az email cím a privát tárolóba megy, nem a nyilvános issue-ba. Ha ez
            // épp nem elérhető, a bejelentő tudja meg, hogy nem várhat választ.
            if (result.data.contactSaved === false) {
              message += " Az email címedet viszont most nem tudtam elmenteni, ezért erre a bejelentésre nem tudok emailben válaszolni.";
            }
            show("ok", message);
          } else {
            show("err", result.data && result.data.error
              ? result.data.error
              : "Nem sikerült elküldeni. Próbáld újra pár perc múlva, vagy nyiss issue-t a GitHubon.");
          }
        })
        .catch(function () {
          show("err", "Hálózati hiba történt. Próbáld újra, vagy nyiss issue-t a GitHubon.");
        })
        .finally(function () {
          submit.disabled = false;
          submit.textContent = "Elküldés";
        });
    });
  }

  // ---------- Napló-emlékeztetőből érkező látogató (#naplo) ----------
  function initLogBanner() {
    var banner = document.getElementById("naplo");
    if (!banner || location.hash !== "#naplo") return;
    banner.hidden = false;
    var title = document.getElementById("fbTitle");
    var body = document.getElementById("fbBody");
    if (title && !title.value) title.value = "Napló 25 perc használat után";
    if (body) {
      body.placeholder = "Illeszd be ide a naplót (Ctrl+V), és írd elé egy sorban, ha valamit tapasztaltál. Melyik böngésző?";
      body.focus();
    }
  }

  // A "90 nap" a szerver beállításából jön (FEEDBACK_TTL_DAYS), hogy a szöveg
  // ne szakadjon el a valóságtól, ha az üzemeltető átállítja.
  function initFeedbackTtl() {
    var slots = document.querySelectorAll("[data-ttl-days]");
    if (!slots.length) return;
    fetch("/api/health")
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data || !data.feedbackTtlDays) return;
        slots.forEach(function (slot) { slot.textContent = data.feedbackTtlDays; });
      })
      .catch(function () {});
  }

  function initBmac() {
    if (!BMAC_URL) return;
    document.querySelectorAll("#bmacSlot").forEach(function (slot) {
      slot.hidden = false;
      slot.querySelector("#bmacLink").href = BMAC_URL;
    });
  }

  // A legfrissebb kiadás száma a Frissítés szakaszban. A demo.js-ből jön, amibe a
  // build süti bele a package.json verzióját: ugyanaz a szám, ami a jelvény-
  // bemutatókon és a szkriptben van.
  function initVersion() {
    var slot = document.getElementById("latestVersion");
    if (!slot) return;
    var version = window.NPU_DEMO && window.NPU_DEMO.version;
    if (version) {
      slot.textContent = "v" + version;
    } else {
      // Kényelmi információ: ha a bundle nem töltött be, ne látsszon hibásnak az oldal.
      var row = slot.closest("[data-version-row]");
      if (row) row.hidden = true;
    }
  }

  // ---------- accordion: GYIK és adatkezelési tájékoztató, megszakítható ----------
  function initAccordions() {
    document.querySelectorAll(".faq details, details.privacy").forEach(function (d) {
      var summary = d.querySelector("summary");
      var body = d.querySelector(".faq__body, .privacy__body");
      if (!summary || !body || !body.animate) return;
      var running = null; // { dir: "open" | "close", anim: Animation }

      function height() { return body.getBoundingClientRect().height; }

      summary.addEventListener("click", function (e) {
        e.preventDefault();
        if (reduceMotion) { d.open = !d.open; return; }
        // Menet közben is a pillanatnyi magasságból indulunk, nem a végállapotból.
        // Csukott details tartalma egyes motorokban megtartja a magasságát, ezért
        // csukva kifejezetten nulláról indulunk.
        var from = d.open ? height() : 0;
        var opening = !d.open || (running !== null && running.dir === "close");
        if (running) { running.anim.cancel(); running = null; }
        if (opening) {
          d.open = true;
          var to = height();
          running = {
            dir: "open",
            anim: body.animate(
              [{ height: from + "px", opacity: from === 0 ? 0 : 1 }, { height: to + "px", opacity: 1 }],
              { duration: 220, easing: EASE_OUT }
            ),
          };
          running.anim.onfinish = function () { running = null; };
        } else {
          running = {
            dir: "close",
            anim: body.animate(
              [{ height: from + "px", opacity: 1 }, { height: "0px", opacity: 0 }],
              { duration: 180, easing: EASE_OUT }
            ),
          };
          running.anim.onfinish = function () { d.open = false; running = null; };
        }
      });
    });
  }

  // ---------- a jelvény munkamenet-számlálója ----------
  // A valódi jelvény a hátralévő időt mutatja, és a kidobásvédelem időnként
  // visszatolja 30 percre. Itt gyorsítva: fél percenként frissül.
  function initTimers() {
    var timers = document.querySelectorAll(".npu-badge .npu-time");
    if (!timers.length) return;
    var secs = 29 * 60 + 54;
    var REFRESH_AT = 29 * 60 + 24;

    function render() {
      var m = Math.floor(secs / 60), s = secs % 60;
      var text = m + ":" + (s < 10 ? "0" : "") + s;
      timers.forEach(function (t) { t.textContent = text; });
    }
    function flash() {
      document.querySelectorAll(".npu-badge .npu-keep").forEach(function (k) {
        k.classList.add("is-fresh");
        setTimeout(function () { k.classList.remove("is-fresh"); }, 900);
      });
    }
    render();
    setInterval(function () {
      if (document.hidden) return;
      secs -= 1;
      if (secs <= REFRESH_AT) { secs = 30 * 60; flash(); }
      render();
    }, 1000);
  }

  // ---------- hero: interaktív bemutató ----------
  function initDemo() {
    var demo = document.getElementById("demo");
    if (!demo) return;
    var count = document.getElementById("demoCount");
    var allButton = document.getElementById("demoAll");
    var notif = document.getElementById("demoNotif");
    var watchCount = demo.querySelector("#demoBadge .npu-watch");
    var notifTimer = null;

    function remaining() {
      return demo.querySelectorAll(".npu-item:not(.npu-item--green)").length;
    }
    function registerable() {
      return demo.querySelectorAll('.npu-item:not(.npu-item--green) [data-act="signup"]:not(:disabled)').length;
    }
    function refreshCounts() {
      if (count) count.textContent = String(remaining());
      if (allButton) {
        var n = registerable();
        allButton.textContent = "Mindet felveszi (" + n + ")";
        allButton.disabled = n === 0;
      }
    }

    function signup(button) {
      var item = button.closest(".npu-item");
      if (!item || button.disabled) return;
      button.disabled = true;
      button.textContent = "Felvétel...";
      refreshCounts();
      setTimeout(function () {
        item.classList.add("npu-item--green");
        var actions = item.querySelector(".npu-actions");
        actions.innerHTML = '<span class="npu-ok-text enter">felvéve</span>';
        refreshCounts();
      }, reduceMotion ? 300 : 900);
    }

    function showNotif() {
      if (!notif) return;
      notif.classList.add("is-on");
      clearTimeout(notifTimer);
      notifTimer = setTimeout(function () { notif.classList.remove("is-on"); }, 4200);
    }

    function watch(button) {
      var item = button.closest(".npu-item");
      if (!item || button.disabled) return;
      button.disabled = true;
      button.textContent = "🔔 figyelve";
      if (watchCount) watchCount.hidden = false;
      // A valódi figyelő félpercenként kérdez rá; a bemutatóban pár másodperc múlva
      // "felszabadul" egy hely, jön az értesítés, és megjelenik a Felvétel gomb.
      setTimeout(function () {
        var meta = item.querySelector("[data-meta]");
        if (meta) meta.textContent = "L1 (Labor) · 23/24 fő · 3 várólistán";
        showNotif();
        var actions = item.querySelector(".npu-actions");
        var b = document.createElement("button");
        b.type = "button";
        b.className = "npu-button enter";
        b.dataset.act = "signup";
        b.textContent = "Felvétel";
        actions.appendChild(b);
        if (watchCount) watchCount.hidden = true;
        button.remove();
        refreshCounts();
      }, reduceMotion ? 800 : 2600);
    }

    demo.addEventListener("click", function (e) {
      var button = e.target.closest("button[data-act]");
      if (!button) return;
      var act = button.dataset.act;
      if (act === "signup") signup(button);
      else if (act === "watch") watch(button);
      else if (act === "all") {
        demo.querySelectorAll('.npu-item:not(.npu-item--green) [data-act="signup"]:not(:disabled)')
          .forEach(function (b, i) { setTimeout(function () { signup(b); }, i * 350); });
      }
    });

    refreshCounts();
  }

  initFit();
  initNav();
  initInstallWizard();
  initFeedbackForm();
  initLogBanner();
  initFeedbackTtl();
  initBmac();
  initVersion();
  initAccordions();
  initTimers();
  initDemo();
})();
