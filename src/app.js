import { createAppController } from "./controller.js";

// Construction wires modules; start loads local data and renders.
const application = createAppController();
application.start();
