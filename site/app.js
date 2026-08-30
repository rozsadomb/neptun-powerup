// Neptun PowerUp! NG — projektoldal
// Böngésző-felismerés a telepítési útmutatóhoz + a visszajelzés-űrlap kezelése.

(function () {
  "use strict";

  var BMAC_URL = "https://buymeacoffee.com/neptunpowerup";

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

  function initInstallWizard() {
    var pills = document.getElementById("browserPills");
    if (!pills) return;

    var tmLink = document.getElementById("tmLink");
    var devStep = document.getElementById("devModeStep");
    var extUrl = document.getElementById("extUrl");

    function select(browser) {
      pills.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", b.dataset.browser === browser);
      });
      tmLink.href = TM_LINKS[browser];
      devStep.hidden = !NEEDS_DEV_MODE[browser];
      if (extUrl && EXT_URLS[browser]) extUrl.textContent = EXT_URLS[browser];
    }

    pills.addEventListener("click", function (e) {
      var button = e.target.closest("button[data-browser]");
      if (button) select(button.dataset.browser);
    });

    select(detectBrowser());
  }

  function initFeedbackForm() {
    var form = document.getElementById("feedbackForm");
    if (!form) return;

    var status = document.getElementById("formStatus");
    var submit = document.getElementById("fbSubmit");

    function show(kind, html) {
      status.hidden = false;
      status.className = "form-status " + kind;
      status.innerHTML = html;
      status.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
            show("ok", "Köszönjük! A bejelentésedet rögzítettük: " +
              '<a href="' + result.data.url + '" target="_blank" rel="noopener">itt tudod követni</a>.');
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

  // Kiírja a legfrissebb kiadás számát, hogy össze lehessen vetni azzal, ami
  // a Neptunban a jelvényen látszik. Csak a fejlécet kérjük le, nem a teljes
  // szkriptet — a verzió az első pár száz bájtban van.
  function initVersion() {
    var slot = document.getElementById("latestVersion");
    if (!slot) return;
    fetch("/npu.user.js", { headers: { Range: "bytes=0-2047" } })
      .then(function (response) {
        if (!response.ok && response.status !== 206) throw new Error(String(response.status));
        return response.text();
      })
      .then(function (text) {
        var match = text.match(/@version\s+([0-9]+\.[0-9]+\.[0-9]+)/);
        if (!match) throw new Error("no version");
        slot.textContent = "v" + match[1];
      })
      .catch(function () {
        // Kényelmi információ: ha nem sikerül, ne látsszon hibásnak az oldal.
        var row = slot.closest(".notice");
        if (row) row.hidden = true;
      });
  }

  initInstallWizard();
  initFeedbackForm();
  initBmac();
  initVersion();
})();
