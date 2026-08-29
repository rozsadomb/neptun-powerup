import { handleFeedback } from "./feedback.js";

// A weboldalt a Workers static assets szolgálja ki; ez a Worker a
// wrangler.jsonc run_worker_first beállítása miatt kizárólag az /api/*
// útvonalakon fut le, minden más kérés közvetlenül az assetekhez megy.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Üzemeltetési önellenőrzés: megmondja, be van-e állítva a két változó,
    // de az értéküket soha nem adja vissza (a repo neve amúgy is publikus).
    if (url.pathname === "/api/health") {
      return new Response(
        JSON.stringify({
          ok: true,
          githubTokenConfigured: Boolean(env.GITHUB_TOKEN),
          githubRepoConfigured: Boolean(env.GITHUB_REPO),
          repo: env.GITHUB_REPO ?? null,
        }),
        { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    if (url.pathname === "/api/feedback") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Csak POST kérés engedélyezett." }), {
          status: 405,
          headers: { "Content-Type": "application/json; charset=utf-8", Allow: "POST" },
        });
      }
      return handleFeedback(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Ismeretlen végpont." }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // Elvileg ide nem jutunk el (a static assets előbb kiszolgálja), de ha a
    // routing egyszer változik, essen vissza a fájlokra ahelyett, hogy hibázna.
    return env.ASSETS.fetch(request);
  },
};
