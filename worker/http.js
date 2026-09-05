// Közös JSON-válasz. Az API-válaszokat sosem cache-eljük: a health és az admin
// végpontok pillanatnyi állapotot adnak, a feedback pedig POST.
export function json(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}
