export type MapId = "coast" | "test";

export function mapFromSearch(search: string): MapId {
  return new URLSearchParams(search).get("map") === "test" ? "test" : "coast";
}

export function mapURL(href: string, map: MapId) {
  const url = new URL(href);
  if (map === "test") url.searchParams.set("map", "test");
  else url.searchParams.delete("map");
  return url.href;
}
