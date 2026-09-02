// Neptun PowerUp! NG, projektoldal.
// Böngésző-felismerés a telepítési útmutatóhoz, a visszajelzés-űrlap kezelése,
// a menü, a GYIK-accordion, a görgetésre megjelenés és a hero interaktív bemutatója.

(function () {
  "use strict";

  var BMAC_URL = "https://buymeacoffee.com/neptunpowerup";
  var EASE_OUT = "cubic-bezier(.23, 1, .32, 1)";
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    function moveThumb(animate) {
      var active = pills.querySelector("button.active");
      if (!active || !thumb) return;
      var w = active.offsetWidth;
      var x = active.offsetLeft - 4;
      var y = active.offsetTop - 4;
      thumb.style.width = w + "px";
      thumb.style.height = active.offsetHeight + "px";
      thumb.style.transform = "translate(" + x + "px, " + y + "px)";
      if (animate && thumbState && thumb.animate && !reduceMotion) {
        thumb.animate(
          [
            { transform: "translate(" + thumbState.x + "px, " + thumbState.y + "px) scaleX(" + (thumbState.w / w) + ")" },
            { transform: "translate(" + x + "px, " + y + "px) scaleX(1)" },
          ],
          { duration: 240, easing: EASE_OUT }
        );
      }
      thumbState = { x: x, y: y, w: w };
    }

    function select(browser) {
      current = browser;
      pills.querySelectorAll("button").forEach(function (b) {
        var on = b.dataset.browser === browser;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      tmLink.href = TM_LINKS[browser];
      devStep.hidden = !NEEDS_DEV_MODE[browser];
      if (extUrl && EXT_URLS[browser]) extUrl.textContent = EXT_URLS[browser];
      moveThumb(true);
    }

    pills.addEventListener("click", function (e) {
      var button = e.target.closest("button[data-browser]");
      if (button && button.dataset.browser !== current) select(button.dataset.browser);
    });
    window.addEventListener("resize", function () { moveThumb(false); });

    select(detectBrowser());
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
            show("ok", "Köszönjük, a bejelentésedet rögzítettük. " +
              '<a href="' + result.data.url + '" target="_blank" rel="noopener">Itt tudod követni</a>.');
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

  function initBmac() {
    if (!BMAC_URL) return;
    document.querySelectorAll("#bmacSlot").forEach(function (slot) {
      slot.hidden = false;
      slot.querySelector("#bmacLink").href = BMAC_URL;
    });
  }

  // Kiírja a legfrissebb kiadás számát a Frissítés szakaszba és a jelvény-bemutatókba.
  // Külön kis fájlból, amit a build ír ki: a szkript fejlécének Range-kérése a
  // kiszolgálón a teljes 100+ KB-ot adja vissza, vagyis minden látogató letöltené
  // az egészet egyetlen számért.
  function initVersion() {
    var slot = document.getElementById("latestVersion");
    var badges = document.querySelectorAll("[data-version]");
    if (!slot && !badges.length) return;
    fetch("/version.json")
      .then(function (response) {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(function (data) {
        if (!data || !data.version) throw new Error("no version");
        if (slot) slot.textContent = "v" + data.version;
        badges.forEach(function (b) { b.textContent = data.version; });
      })
      .catch(function () {
        // Kényelmi információ: ha nem sikerül, ne látsszon hibásnak az oldal.
        var row = slot && slot.closest("[data-version-row]");
        if (row) row.hidden = true;
      });
  }

  // ---------- görgetésre megjelenés (egyszer, IntersectionObserverrel) ----------
  function initReveal() {
    var items = document.querySelectorAll("[data-reveal]");
    if (!items.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.15 });
    items.forEach(function (el) { io.observe(el); });
  }

  // ---------- GYIK: magasság-animált accordion ----------
  function initFaq() {
    document.querySelectorAll(".faq details").forEach(function (d) {
      var summary = d.querySelector("summary");
      var body = d.querySelector(".faq__body");
      if (!summary || !body || !body.animate) return;
      var busy = false;

      summary.addEventListener("click", function (e) {
        e.preventDefault();
        if (busy) return;
        if (reduceMotion) { d.open = !d.open; return; }
        busy = true;
        if (!d.open) {
          d.open = true;
          var h = body.offsetHeight;
          var open = body.animate(
            [{ height: "0px", opacity: 0 }, { height: h + "px", opacity: 1 }],
            { duration: 220, easing: EASE_OUT }
          );
          open.onfinish = function () { busy = false; };
        } else {
          var h0 = body.offsetHeight;
          var close = body.animate(
            [{ height: h0 + "px", opacity: 1 }, { height: "0px", opacity: 0 }],
            { duration: 180, easing: EASE_OUT }
          );
          close.onfinish = function () { d.open = false; busy = false; };
        }
      });
    });
  }

  // ---------- a jelvény munkamenet-számlálója ----------
  // A valódi jelvény a hátralévő időt mutatja, és a kidobásvédelem időnként
  // visszatolja 30 percre. Itt gyorsítva: fél percenként frissül.
  function initTimers() {
    var timers = document.querySelectorAll("[data-timer]");
    if (!timers.length) return;
    var secs = 29 * 60 + 54;
    var REFRESH_AT = 29 * 60 + 24;

    function render() {
      var m = Math.floor(secs / 60), s = secs % 60;
      var text = m + ":" + (s < 10 ? "0" : "") + s;
      timers.forEach(function (t) { t.textContent = text; });
    }
    function flash() {
      document.querySelectorAll("[data-keep]").forEach(function (k) {
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
    var watchCount = demo.querySelector("[data-watchcount]");
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
        actions.innerHTML = '<span class="npu-ok-text">felvéve</span>';
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
        b.className = "npu-button";
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

  initNav();
  initInstallWizard();
  initFeedbackForm();
  initBmac();
  initVersion();
  initReveal();
  initFaq();
  initTimers();
  initDemo();
})();
