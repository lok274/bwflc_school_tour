import { createFeedback } from "../../src/feedback.js";

const feedback = createFeedback({ document, window, requestAnimationFrame });
const toast = document.querySelector("#toast"), summary = document.querySelector("#test-summary");
let passed = 0, failed = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition) {
  const deadline = Date.now() + 4000;
  while (!condition()) { if (Date.now() > deadline) throw new Error("提示狀態逾時"); await pause(10); }
}
function require(condition, message) { if (!condition) throw new Error(message); }
async function check(label, run) {
  const item = document.createElement("li");
  try { await run(); passed++; item.textContent = `通過：${label}`; }
  catch (error) { failed++; item.textContent = `失敗：${label} — ${error.message}`; }
  document.querySelector("#test-results").append(item);
}
async function fadingToast() {
  feedback.showToast("舊提示", "default", 100);
  await until(() => toast.classList.contains("is-visible"));
  await until(() => !toast.classList.contains("is-visible") && !toast.hidden);
}
await check("舊提示淡出時，新下載提示保持可見並正常到期", async () => {
  await fadingToast();
  feedback.showToast("下載檔案的位置", "success", 700);
  await pause(260);
  const bounds = toast.getBoundingClientRect();
  require(!toast.hidden && toast.classList.contains("is-visible") && toast.textContent === "下載檔案的位置", "新提示被舊計時器隱藏");
  require(bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight, "新提示不在可見畫面內");
  await until(() => toast.hidden);
});
await check("離頁取消淡出計時器後，新提示仍完整顯示", async () => {
  await fadingToast();
  feedback.cancelConfirmations();
  require(toast.hidden, "離頁沒有隱藏提示");
  feedback.showToast("新頁提示", "warning", 700);
  await pause(260);
  require(!toast.hidden && toast.textContent === "新頁提示", "新頁提示被舊計時器隱藏");
  feedback.cancelConfirmations();
});
summary.textContent = `${passed} 項通過，${failed} 項失敗`;
summary.dataset.done = "true"; summary.dataset.failed = String(failed);
