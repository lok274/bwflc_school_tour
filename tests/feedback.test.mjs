import test from "node:test";
import assert from "node:assert/strict";
import { createFeedback } from "../src/feedback.js";

function feedbackClock() {
  let now = 0, nextId = 0;
  const tasks = new Map(), classes = new Set();
  const toast = { hidden: true, textContent: "", dataset: {}, classList: {
    add: name => classes.add(name), remove: name => classes.delete(name)
  } };
  const window = {
    setTimeout(callback, delay) { tasks.set(++nextId, { at: now + delay, callback }); return nextId; },
    clearTimeout(id) { tasks.delete(id); }
  };
  function advance(delay) {
    const target = now + delay;
    for (;;) {
      const next = [...tasks].sort((a, b) => a[1].at - b[1].at).find(([, task]) => task.at <= target);
      if (!next) break;
      now = next[1].at; tasks.delete(next[0]); next[1].callback();
    }
    now = target;
  }
  const feedback = createFeedback({ document: { querySelector: selector => selector === "#toast" ? toast : null }, window, requestAnimationFrame: callback => callback() });
  return { feedback, toast, classes, advance };
}

test("舊提示淡出期間的新提示保留完整顯示時間", () => {
  const { feedback, toast, classes, advance } = feedbackClock();
  feedback.showToast("正在製作旅程卡…");
  advance(4250);
  feedback.showToast("旅程卡下載位置", "success", 15000);
  advance(170);
  assert.equal(toast.hidden, false);
  assert.equal(toast.textContent, "旅程卡下載位置");
  assert.equal(classes.has("is-visible"), true);
  advance(14830);
  assert.equal(toast.hidden, false);
  assert.equal(classes.has("is-visible"), false);
  advance(220);
  assert.equal(toast.hidden, true);
});

test("離頁取消淡出提示後，新頁提示不受舊計時器影響", () => {
  const { feedback, toast, advance } = feedbackClock();
  feedback.showToast("舊頁提示", "default", 100);
  advance(100);
  feedback.cancelConfirmations();
  assert.equal(toast.hidden, true);
  advance(50);
  feedback.showToast("新頁提示", "warning", 1000);
  advance(220);
  assert.equal(toast.hidden, false);
  assert.equal(toast.textContent, "新頁提示");
  advance(1000);
  assert.equal(toast.hidden, true);
});
