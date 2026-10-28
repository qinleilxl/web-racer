declare const __MODEL_ASSET_URLS__: Record<string, string>;

/** Production builds may externalize large GLBs without changing source models. */
export function modelAssetUrl(asset: string): string {
  return typeof __MODEL_ASSET_URLS__ === "undefined"
    ? asset
    : __MODEL_ASSET_URLS__[asset] ?? asset;
}
