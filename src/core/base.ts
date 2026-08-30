// Where the student app is mounted.
//
// At BME it sits at the site root (`neptun.bme.hu/hallgatoi/...`), but that is
// not universal: several institutions serve Neptun under an institution
// prefix. The original NPU had to match `https://neptun.ejf.hu/ejfhw/*` for
// exactly this reason. Hard-coding "/hallgatoi" would let the script start on
// those sites and then do nothing at all — every route match would miss and
// every API call would go to a path that does not exist.
//
// Everything else in the script works with paths relative to this base, so a
// prefixed install behaves exactly like a root-mounted one.

const APP_SEGMENT = "hallgatoi";

// Angular states its own mount point in the document: <base href="/hallgatoi/">.
// That is authoritative, so prefer it over guessing from the current URL.
function fromBaseTag(): string | null {
  const href = document.querySelector("base")?.getAttribute("href");
  if (!href) {
    return null;
  }
  let path: string;
  try {
    path = new URL(href, location.origin).pathname;
  } catch {
    return null;
  }
  const match = new RegExp(`^(.*?)/${APP_SEGMENT}/?$`, "i").exec(path);
  return match ? match[1] : null;
}

function detect(): string {
  const declared = fromBaseTag();
  if (declared !== null) {
    return declared;
  }
  const match = new RegExp(`^(.*?)/${APP_SEGMENT}(?=/|$)`, "i").exec(location.pathname);
  return match ? match[1] : "";
}

// The prefix cannot change while the SPA is running, so resolve it once.
export const APP_BASE: string = detect();

/** The API root, including any institution prefix. */
export const API_BASE = `${APP_BASE}/${APP_SEGMENT}/api/`;

/** True when the given path belongs to the Neptun student app. */
export function isAppPath(pathname: string = location.pathname): boolean {
  return new RegExp(`(^|/)${APP_SEGMENT}(/|$)`, "i").test(pathname);
}

/**
 * The path with the institution prefix stripped, e.g. "/hallgatoi/exams".
 * Route matching throughout the script is written against this form.
 */
export function appPath(pathname: string = location.pathname): string {
  if (!APP_BASE) {
    return pathname;
  }
  return pathname.toLowerCase().startsWith(APP_BASE.toLowerCase()) ? pathname.slice(APP_BASE.length) : pathname;
}

/** The inverse of appPath: turns a stored route back into a navigable URL. */
export function appUrl(path: string): string {
  return APP_BASE + path;
}
