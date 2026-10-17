import { SYNC_ACTIVITY_ID, SYNC_UPLOAD_CUTOFF } from "./check-in-sync.js";

export const REHEARSAL_UPLOAD_SCENARIOS = Object.freeze(["success", "offline", "failure"]);

export function createRehearsalUpload() {
  let scenario = "success", generation = 0;
  function setScenario(next) {
    if (!REHEARSAL_UPLOAD_SCENARIOS.includes(next)) return false;
    scenario = next; generation++; return true;
  }
  async function send(body, signal) {
    const token = generation;
    await new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 200);
      signal.addEventListener("abort", abort, { once: true });
    });
    if (signal.aborted || token !== generation) throw new DOMException("Aborted", "AbortError");
    if (scenario !== "success") throw new TypeError("模擬接收失敗");
    const receipt = { version: 1, activityId: SYNC_ACTIVITY_ID, ok: true };
    if (body.action === "enable") Object.assign(receipt, { sessionId: body.sessionId, ticket: `rehearsal:${body.sessionId}`, expiresAt: SYNC_UPLOAD_CUTOFF });
    else if (body.action === "submit" && /^rehearsal:[0-9a-f-]{36}$/i.test(body.ticket)) {
      Object.assign(receipt, { sessionId: body.ticket.slice("rehearsal:".length), accepted: body.events.map(event => event.eventId) });
    } else Object.assign(receipt, { ok: false, error: "TICKET" });
    return { ok: true, type: "basic", text: async () => JSON.stringify(receipt) };
  }
  return Object.freeze({ send, setScenario, getScenario: () => scenario });
}
