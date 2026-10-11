import { createHomeViews } from "./home-views.js";
import { createItineraryViews } from "./itinerary-views.js";
import { createMemoryViews } from "./memory-views.js";
import { createExportViews } from "./export-views.js";
export { renderCheckInCompletion } from "./view-components.js";

// Each page renders a read-only model. Factories do not request permissions or write data.
export function createViews(options = {}) {
  return { ...createHomeViews(options), ...createItineraryViews(options),
    ...createMemoryViews(options), ...createExportViews() };
}
