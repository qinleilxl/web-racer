import english from "./en.json";

export type Locale = "zh-CN" | "en";
export const LOCALE_STORAGE_KEY = "cloudcape.language";
type StorageReader = Pick<Storage, "getItem">;
const messages: Readonly<Record<string, string>> = english;

/** Explicit choices take priority over the browser's ordered language list. */
export function detectLocale(languages: readonly string[], storage?: StorageReader): Locale {
  try {
    const saved = storage?.getItem(LOCALE_STORAGE_KEY);
    if (saved === "zh-CN" || saved === "en") return saved;
  } catch { /* Storage may be blocked. */ }
  for (const language of languages) {
    const primary = language.trim().toLowerCase().split(/[-_]/)[0];
    if (primary === "zh") return "zh-CN";
    if (primary === "en") return "en";
  }
  return "en";
}

function initialLocale(): Locale {
  if (typeof navigator === "undefined") return "zh-CN";
  let storage: StorageReader | undefined;
  try { storage = localStorage; } catch { /* Access itself may throw. */ }
  return detectLocale(navigator.languages?.length ? navigator.languages : [navigator.language], storage);
}

let locale = initialLocale();
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Chinese source copy is the fallback catalog. */
export function translate(text: string, language: Locale, values: Readonly<Record<string, string | number>> = {}): string {
  const template = language === "en" && Object.hasOwn(messages, text) ? messages[text] : text;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}
export function t(text: string, values?: Readonly<Record<string, string | number>>): string {
  return translate(text, locale, values);
}

export function syncDocumentLocale() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.title = locale === "en" ? t("页面标题") : "云岬环线 · Cloudcape Rally";
  document.querySelector('meta[name="description"]')?.setAttribute("content", locale === "en"
    ? t("页面描述")
    : "驾驶你的赛车，沿盐风海岸挑战最佳圈速。云岬环线，一场即刻出发的海岸竞速。");
}
export function setLocale(next: Locale) {
  try { localStorage.setItem(LOCALE_STORAGE_KEY, next); } catch { /* Switch for this visit. */ }
  if (locale === next) return;
  locale = next;
  syncDocumentLocale();
  listeners.forEach((listener) => listener());
}
