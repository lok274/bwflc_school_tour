import { PushService as ActualPushService } from "../src/worker.js";
export { default } from "../src/worker.js";

// Inspect native storage without replacing the production fetch/scheduling logic.
export class PushService extends ActualPushService {
  getScheduledAlarm() { return this.ctx.storage.getAlarm(); }
  setScheduledAlarm(time) { return this.ctx.storage.setAlarm(time); }
  clearScheduledAlarm() { return this.ctx.storage.deleteAlarm(); }
}
