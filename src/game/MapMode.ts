export type MapId = "coast" | "test";

export function mapFromSearch(search: string): MapId {
  const legacy = new URLSearchParams(search).get("map");
  if (legacy !== null) return legacy === "test" ? "test" : "coast";
  try { return sessionStorage.getItem("cloudcape.map") === "test" ? "test" : "coast"; }
  catch { return "coast"; }
}

export function mapURL(href: string, map: MapId) {
  const url = new URL(href);
  try { sessionStorage.setItem("cloudcape.map", map); } catch { /* Private storage. */ }
  url.searchParams.delete("map");
  url.searchParams.delete("car");
  return url.href;
}
