// DOM helpers built on MutationObserver instead of tight polling.

export function injectCss(css: string): void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

// Resolves with the first element matching the selector (and optional text
// content filter), observing the DOM until it appears or the timeout passes.
export function waitFor(
  selector: string,
  options: { text?: string; timeoutMs?: number } = {}
): Promise<HTMLElement | null> {
  const { text, timeoutMs = 15_000 } = options;
  const find = (): HTMLElement | null => {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (!text || (element.textContent ?? "").includes(text)) {
        return element;
      }
    }
    return null;
  };
  const existing = find();
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      const element = find();
      if (element) {
        observer.disconnect();
        window.clearTimeout(timer);
        resolve(element);
      }
    });
    const timer = window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
