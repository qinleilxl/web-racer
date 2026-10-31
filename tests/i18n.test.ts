import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import english from "../src/i18n/en.json";
import { detectLocale, getLocale, LOCALE_STORAGE_KEY, setLocale, subscribeLocale, translate } from "../src/i18n";

test("first visit matches ordered browser preferences, regional variants and fallback", () => {
  for (const language of ["zh", "zh-CN", "zh-TW", "zh-HK", "zh-Hant-TW", "ZH_cn"]) {
    assert.equal(detectLocale([language]), "zh-CN");
  }
  for (const language of ["en", "en-US", "en-GB", "en-AU"]) {
    assert.equal(detectLocale([language, "zh-CN"]), "en");
  }
  assert.equal(detectLocale(["fr-FR", "zh-CN", "en-US"]), "zh-CN");
  assert.equal(detectLocale(["fr-FR", "de-DE"]), "en");
  assert.equal(detectLocale([]), "en");
  assert.equal(detectLocale(["zhang"]), "en");
});

test("saved language wins; invalid or blocked storage still uses browser language", () => {
  assert.equal(detectLocale(["en-US"], { getItem: (key) => {
    assert.equal(key, LOCALE_STORAGE_KEY);
    return "zh-CN";
  } }), "zh-CN");
  assert.equal(detectLocale(["zh-CN"], { getItem: () => "en" }), "en");
  assert.equal(detectLocale(["zh-CN"], { getItem: () => "invalid" }), "zh-CN");
  assert.equal(detectLocale(["zh-CN"], { getItem: () => { throw new Error("blocked"); } }), "zh-CN");
});

test("translation interpolates values without changing units, IDs, missing copy or dollar signs", () => {
  assert.equal(translate("检查点 {0} / 8", "en", {0: 3}), "Checkpoint 3 / 8");
  assert.equal(translate("开顶 {0}%", "zh-CN", {0: 35}), "开顶 35%");
  assert.equal(translate("选择{0}", "en", {0: "$&"}), "Select $&");
  assert.equal(translate("unknown", "en"), "unknown");
  assert.equal(translate("constructor", "en"), "constructor");
  assert.equal(translate("选择{0}", "en"), "Select {0}");
});

test("language changes notify subscribers, persist preference and work without storage", () => {
  const original = getLocale();
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  let notifications = 0;
  const unsubscribe = subscribeLocale(() => { notifications++; });
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      setItem: (key: string, value: string) => values.set(key, value),
    } });
    const next = original === "en" ? "zh-CN" : "en";
    setLocale(next);
    assert.equal(getLocale(), next);
    assert.equal(values.get(LOCALE_STORAGE_KEY), next);
    assert.equal(notifications, 1);
    setLocale(next);
    assert.equal(notifications, 1);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    setLocale(original);
    assert.equal(getLocale(), original);
    assert.equal(notifications, 2);
  } finally {
    unsubscribe();
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("English catalog covers source copy and preserves every interpolation placeholder", () => {
  const catalog: Record<string, string> = english;
  const placeholders = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
  for (const [key, value] of Object.entries(catalog)) {
    assert.ok(value.trim(), `Empty translation: ${key}`);
    assert.doesNotMatch(value, /\p{Script=Han}/u, `Untranslated copy: ${key}`);
    assert.deepEqual(placeholders(value), placeholders(key), `Mismatched placeholders: ${key}`);
  }
  const scan = (folder: string) => {
    for (const entry of readdirSync(folder, {withFileTypes:true})) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "i18n") scan(path); continue; }
      if (!/\.tsx?$/.test(entry.name) || entry.name === "AudioProfiles.ts") continue;
      const file = ts.createSourceFile(path, readFileSync(path,"utf8"), ts.ScriptTarget.Latest,true);
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteral(node) && /\p{Script=Han}/u.test(node.text) && node.text !== "中文") {
          assert.ok(catalog[node.text], `${entry.name}: Missing translation for ${node.text}`);
        }
        if (ts.isJsxText(node) && /\p{Script=Han}/u.test(node.text)) {
          assert.fail(`${entry.name}: Unlocalized JSX copy: ${node.text.trim()}`);
        }
        ts.forEachChild(node,visit);
      };
      visit(file);
    }
  };
  scan(resolve("src"));
});
