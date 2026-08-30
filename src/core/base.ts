// Where the student app is mounted, and whether this is Neptun at all.
//
// Do not assume a path. Measured across 22 Hungarian institutions running the
// new interface, the app root is one of at least seven different things:
//
//   /hallgato      (10×)   /hallgato_ng   (5×)   /hallgatoi   (1×, BME only)
//   /hallgato2_uj  (1×)    /Hallgato_NG   (1×)   /ujhallgato  (1×)
//   /momehw, /bhfhw        (SDA-hosted: no "hallgato" in the path at all)
//
// BME's "/hallgatoi" — the one this script was built against — is the odd one
// out. Anything hard-coded to it works on exactly one university.
//
// So the mount point comes from the document itself: Angular writes it into
// <base href>. Routes are then matched relative to that root ("/login",
// "/subjects/registration"), which is identical everywhere.

function fromBaseTag(): string | null {
  const href = document.querySelector("base")?.getAttribute("href");
  if (!href) {
    return null;
  }
  try {
    // Trailing slash stripped so the root concatenates cleanly: "" for a
    // site-root install, "/hallgato_ng" otherwise.
    return new URL(href, location.origin).pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

// Every install measured mounts the app under a single path segment, so when
// the base tag is missing that first segment is the best available guess.
function fromFirstSegment(): string {
  const segment = location.pathname.split("/")[1];
  return segment ? `/${segment}` : "";
}

function detect(): string {
  const declared = fromBaseTag();
  return declared !== null ? declared : fromFirstSegment();
}

/** The app's mount path, e.g. "" or "/hallgato_ng". */
export const APP_BASE: string = detect();

/** The API root, under the app's own mount path. */
export const API_BASE = `${APP_BASE}/api/`;

/**
 * True when this document is the Neptun student app.
 *
 * Checked against the HTML the server sends, before Angular boots: every one
 * of the 22 installs surveyed serves <app-root> and the title "Neptun Web".
 * The <neptun-*> elements only exist after bootstrap, so they cannot be relied
 * on at startup — they are kept only as a late fallback.
 */
export function isNeptunApp(): boolean {
  if (!document.querySelector("app-root")) {
    return false;
  }
  if (document.title.toLowerCase().includes("neptun")) {
    return true;
  }
  if (location.host.toLowerCase().includes("neptun")) {
    return true;
  }
  return !!document.querySelector("neptun-header, neptun-main-menu, [class*='neptun-']");
}

/**
 * The route within the app, with the mount path removed — "/login",
 * "/subjects/registration". Every module matches against this form, which is
 * the same at every institution.
 */
export function appPath(pathname: string = location.pathname): string {
  if (!APP_BASE) {
    return pathname;
  }
  if (!pathname.toLowerCase().startsWith(APP_BASE.toLowerCase())) {
    return pathname;
  }
  return pathname.slice(APP_BASE.length) || "/";
}

/** The inverse of appPath: turns a stored route back into a navigable URL. */
export function appUrl(path: string): string {
  return APP_BASE + path;
}
