import { getAttraction } from "./formatting.js";
import { WORKBOOK_PARTS } from "./workbook-data.js";

export const MEMORY_SECTIONS = Object.freeze([
  Object.freeze({ id: "albums", label: "相簿", hash: "#memories" }),
  Object.freeze({ id: "ai", label: "AI 作品", hash: "#memories/ai" }),
  Object.freeze({ id: "checkins", label: "打卡紀錄", hash: "#memories/checkins" })
]);

export function parseRoute(hash = "") {
  const route = hash.replace(/^#/, "") || "home";
  if (route.startsWith("attraction/")) {
    const attractionId = route.split("/")[1];
    return getAttraction(attractionId) ? { view: "attraction", attractionId } : { view: "itinerary" };
  }
  if (route === "attractions") return { view: "itinerary" };
  if (route === "workbook" || route.startsWith("workbook/")) {
    const section = route.slice("workbook/".length);
    return { view: "workbook", section: WORKBOOK_PARTS.some(part => part.id === section) ? section : null };
  }
  if (route === "memories" || route.startsWith("memories/")) {
    const section = route.slice("memories/".length);
    return { view: "memories", section: MEMORY_SECTIONS.some(item => item.id === section) ? section : "albums" };
  }
  return { view: ["home", "itinerary", "introduction"].includes(route) ? route : "home" };
}

export function routeKey(route) {
  if (route.view === "attraction") return `attraction/${route.attractionId}`;
  if (["workbook", "memories"].includes(route.view)) return `${route.view}/${route.section || ""}`;
  return route.view;
}
