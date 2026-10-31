declare const __MODEL_ASSET_URLS__: Record<string, string>;

/** Public assets share Vite's base path, including repository Pages sites. */
export function publicAssetUrl(asset: string, base = import.meta.env?.BASE_URL ?? "/"): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(asset)) return asset;
  return `${base.replace(/\/+$/, "")}/${asset.replace(/^\/+/, "")}`;
}

/** Production builds may externalize large GLBs without changing source models. */
export function modelAssetUrl(asset: string): string {
  const mapped = typeof __MODEL_ASSET_URLS__ === "undefined"
    ? asset
    : __MODEL_ASSET_URLS__[asset] ?? asset;
  return publicAssetUrl(mapped);
}
