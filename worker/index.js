import { json } from "./http.js";
import { handleFeedback } from "./feedback.js";
import { handleAdminApi, adminPage } from "./admin.js";
import { feedbackTtlDays } from "./reports.js";

// A weboldalt a Workers static assets szolgálja ki; ez a Worker a
// wrangler.jsonc run_worker_first beállítása miatt kizárólag az /api/* és az
// /admin útvonalakon fut le, minden más kérés közvetlenül az assetekhez megy.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Üzemeltetési önellenőrzés: megmondja, mi van beállítva, de értéket soha
    // nem ad vissza (a repo neve amúgy is publikus).
    if (url.pathname === "/api/health") {
      return json(200, {
        ok: true,
        githubTokenConfigured: Boolean(env.GITHUB_TOKEN),
        githubRepoConfigured: Boolean(env.GITHUB_REPO),
        repo: env.GITHUB_REPO ?? null,
        feedbackStoreConfigured: Boolean(env.FEEDBACK),
        adminTokenConfigured: Boolean(env.ADMIN_TOKEN),
        feedbackTtlDays: feedbackTtlDays(env),
      });
    }

    if (url.pathname === "/api/feedback") {
      if (request.method !== "POST") {
        return json(405, { error: "Csak POST kérés engedélyezett." }, { Allow: "POST" });
      }
      return handleFeedback(request, env);
    }

    // A karbantartó privát oldala a bejelentésekhez (az adatot tokennel kéri le).
    if (url.pathname === "/admin") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json(405, { error: "Csak GET kérés engedélyezett." }, { Allow: "GET" });
      }
      return adminPage();
    }
    if (url.pathname.startsWith("/api/admin/")) {
      return handleAdminApi(request, env, url);
    }

    if (url.pathname.startsWith("/api/")) {
      return json(404, { error: "Ismeretlen végpont." });
    }

    // Elvileg ide nem jutunk el (a static assets előbb kiszolgálja), de ha a
    // routing egyszer változik, essen vissza a fájlokra ahelyett, hogy hibázna.
    return env.ASSETS.fetch(request);
  },
};
