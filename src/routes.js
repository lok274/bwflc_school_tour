import { getAttraction } from "./formatting.js";

export const MEMORY_SECTIONS = Object.freeze([
  Object.freeze({ id: "albums", label: "相簿", hash: "#memories" }),
  Object.freeze({ id: "ai", label: "AI 作品", hash: "#memories/ai" }),
  Object.freeze({ id: "checkins", label: "打卡紀錄", hash: "#memories/checkins" })
]);

export function parseRoute(hash = "") {
  const route = hash.replace(/^#/, "") || "itinerary";
  if (route.startsWith("attraction/")) {
    const attractionId = route.split("/")[1];
    return getAttraction(attractionId) ? { view: "itinerary", attractionId } : { view: "itinerary" };
  }
  if (route === "attractions") return { view: "itinerary" };
  if (route === "memories" || route.startsWith("memories/")) {
    const section = route.slice("memories/".length);
    return { view: "memories", section: MEMORY_SECTIONS.some(item => item.id === section) ? section : "albums" };
  }
  if (route === "introduction") return { view: "itinerary", section: "introduction" };
  return { view: "itinerary" };
}

export function routeKey(route) {
  if (route.view === "itinerary" && route.attractionId) return `attraction/${route.attractionId}`;
  if (route.view === "itinerary" && route.section === "introduction") return "introduction";
  if (route.view === "memories") return `${route.view}/${route.section || ""}`;
  return route.view;
}
