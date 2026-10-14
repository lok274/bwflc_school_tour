import { STUDENT_IDENTITY_STORAGE_KEY, STUDENT_IDENTITY_LIMITS, createStudentIdentityStore,
  studentIdentityErrors, validateStudentIdentity } from "./student-identity.js";
import { decorateInterface } from "./view-components.js";

// Journey work stays with the app; this module owns the local identity and form lifecycle.
export function createStudentLoginController({ document, app, storage, testKind = null, renderLogin,
  isResetting, isCurrentControl, getPageGeneration, pauseJourney, leaveJourney, enterJourney,
  render, formRendered, askConfirmation, showToast, identityWarning = async () => "",
  beforeIdentityChange = async () => true, identityInvalidated = () => {}, pauseIdentity = () => {}, resumeIdentity = () => {} }) {
  const identityStore = testKind ? null : createStudentIdentityStore(storage);
  let identity = null, status = "";
  try { identity = identityStore?.read() || null; }
  catch { status = "未能讀取已記住的資料，請重新填寫。"; }
  let rememberedIdentity = JSON.stringify(identity);
  let draft = emptyIdentity(), errors = {}, editing = false, saveFailed = false, rendered = false, composing = null, changing = false;
  function emptyIdentity() { return { studentName: "", className: "", studentNumber: "" }; }
  const isReady = () => Boolean(testKind || identity && !editing);
  const isRemembered = () => Boolean(!testKind && identity && JSON.stringify(identity) === rememberedIdentity);
  const getIdentity = () => testKind || !identity ? null : { ...identity };
  function getModel() {
    return Object.freeze({ view: "login", identity: Object.freeze({ ...draft }), errors: Object.freeze({ ...errors }),
      editing, status, saveFailed });
  }
  function updateInput(target, isComposing = false) {
    const key = target?.dataset?.studentIdentityField;
    if (testKind || isReady() || !rendered || target.isConnected === false || !app.contains(target)
      || !Object.hasOwn(STUDENT_IDENTITY_LIMITS, key) || isComposing) return;
    draft[key] = String(target.value || "");
    if (errors[key]) {
      const error = studentIdentityErrors(draft)[key];
      if (error) errors[key] = error; else delete errors[key];
      target.setAttribute("aria-invalid", String(Boolean(error)));
      const message = document.getElementById(`student-login-${key}-error`);
      if (message) { message.textContent = error || ""; message.hidden = !error; }
    }
  }
  function captureInput() {
    for (const target of app.querySelectorAll("[data-student-identity-field]")) updateInput(target);
  }
  function showForm({ focus = false } = {}) {
    document.body.dataset.view = "login";
    const nav = document.querySelector(".bottom-nav"); if (nav) nav.hidden = true;
    const button = document.getElementById("student-profile-open"); if (button) button.hidden = true;
    if (!rendered) {
      app.innerHTML = renderLogin(getModel());
      rendered = true; formRendered();
      decorateInterface(document);
    }
    if (focus) {
      const control = document.getElementById(`student-login-${Object.keys(errors)[0] || "studentName"}`);
      control?.focus({ preventScroll: true });
      control?.parentElement?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
    }
  }
  function resumeJourney() {
    rendered = false;
    const nav = document.querySelector(".bottom-nav"); if (nav) nav.hidden = false;
    const button = document.getElementById("student-profile-open"); if (button) button.hidden = Boolean(testKind);
  }
  function edit() {
    if (testKind || !isReady() || isResetting() || [...document.querySelectorAll("dialog")].some(item => item.open)) return;
    pauseJourney();
    pauseIdentity();
    draft = { ...identity }; editing = true; errors = {};
    status = ""; saveFailed = false; rendered = false;
    showForm({ focus: true });
  }
  async function enter({ temporary = false } = {}) {
    if (testKind || isReady() || composing || isResetting() || changing) return;
    captureInput(); errors = studentIdentityErrors(draft);
    if (Object.keys(errors).length) { rendered = false; showForm({ focus: true }); return; }
    let next = validateStudentIdentity(draft);
    if (identity && JSON.stringify(identity) !== JSON.stringify(next)) {
      changing = true;
      const previous = identity, generation = getPageGeneration(), snapshot = JSON.stringify(draft);
      try {
        if (!await beforeIdentityChange() || identity !== previous || !editing || generation !== getPageGeneration()
          || composing || snapshot !== JSON.stringify(draft)) return;
      } catch {
        status = "未能清除舊身份的待傳紀錄，請重試；學生資料尚未改動。";
        rendered = false; showForm(); return;
      } finally { changing = false; }
    }
    try {
      if (!temporary) { next = identityStore.save(next); rememberedIdentity = JSON.stringify(next); }
    } catch {
      status = "未能記住資料，請重試或選擇只在本次使用。";
      saveFailed = true; rendered = false; showForm(); return;
    }
    leaveJourney(); identity = next; editing = false; errors = {}; status = "";
    draft = emptyIdentity(); rendered = false; saveFailed = false;
    await enterJourney();
    if (temporary) showToast("只在本次使用，重新整理後不會保留這次填寫。", "warning");
  }
  function resetIdentity() {
    identity = null; rememberedIdentity = "null"; editing = false;
    draft = emptyIdentity(); errors = {}; status = ""; saveFailed = false; rendered = false; composing = null;
  }
  async function logout() {
    if (!editing || !identity || testKind || isResetting()) return;
    const previous = identity, generation = getPageGeneration();
    const relevant = () => editing && identity === previous && getPageGeneration() === generation;
    const warning = await identityWarning();
    if (!relevant()) return;
    const accepted = await askConfirmation({ title: "登出？", message: `姓名、班別及學號會清除；相片與打卡會保留。${warning}`, confirmText: "登出", isRelevant: relevant });
    if (!accepted || !relevant()) return;
    try { if (!await beforeIdentityChange({ confirmed: true }) || !relevant()) return; identityStore.clear(); }
    catch {
      status = "未能確認已清除學生資料，請重試登出。";
      rendered = false; showForm(); return;
    }
    leaveJourney(); resetIdentity(); showForm({ focus: true });
  }
  function clear() {
    if (testKind) return;
    identityStore.clear();
    resetIdentity();
  }
  function reconcileStorage(event = { key: STUDENT_IDENTITY_STORAGE_KEY }) {
    if (testKind || event.storageArea && event.storageArea !== storage
      || event.key !== STUDENT_IDENTITY_STORAGE_KEY && event.key !== null) return;
    let next = null;
    try { next = identityStore.read(); } catch { /* Keep the app closed until the user confirms. */ }
    const stamp = JSON.stringify(next);
    if (event.key !== null && stamp === rememberedIdentity) return;
    identityInvalidated(); pauseJourney(); leaveJourney(); rememberedIdentity = stamp; identity = null; editing = false;
    draft = next || emptyIdentity(); errors = {}; composing = null; rendered = false; saveFailed = false;
    status = "學生資料已改動或未能讀取，請重新確認。"; showForm({ focus: true });
  }
  function handleInput(event) { updateInput(event.target, event.isComposing || composing === event.target); }
  function handleSubmit(event) {
    if (event.target.id !== "student-login-form" || event.target.isConnected === false || !app.contains(event.target)) return;
    event.preventDefault(); return enter();
  }
  function beginComposition(event) {
    if (!isReady() && event.target.dataset?.studentIdentityField && app.contains(event.target)) composing = event.target;
  }
  function endComposition(event) {
    if (composing === event.target) { composing = null; updateInput(event.target); }
  }
  // Return false synchronously for journey controls, preserving their user-activation timing.
  function handleClick(target) {
    if (target.matches("[data-student-profile-open]") && target.isConnected !== false) { edit(); return true; }
    if (isReady()) return false;
    if (!isCurrentControl(target) || target.disabled) return true;
    if (target.matches("[data-student-identity-temporary]") && saveFailed) return enter({ temporary: true });
    if (target.matches("[data-student-identity-logout]")) return logout();
    if (target.matches("[data-student-identity-cancel]") && editing) {
      editing = false; composing = null; rendered = false; render({ moveFocus: true });
      resumeIdentity();
      document.getElementById("student-profile-open")?.focus({ preventScroll: true });
    }
    return true;
  }
  return Object.freeze({ isReady, isRemembered, getIdentity, getModel, showForm, resumeJourney, clear, reconcileStorage,
    handleInput, handleSubmit, beginComposition, endComposition, handleClick });
}
