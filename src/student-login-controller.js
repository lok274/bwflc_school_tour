import { STUDENT_IDENTITY_STORAGE_KEY, STUDENT_IDENTITY_LIMITS, createStudentIdentityStore,
  studentIdentityErrors, validateStudentIdentity } from "./student-identity.js";
import { decorateInterface } from "./view-components.js";

export const STUDENT_SIGNED_OUT_STORAGE_KEY = "outdoorLearningDay.signedOut.v1";

// Journey work stays with the app; this module owns the local identity and form lifecycle.
export function createStudentLoginController({ document, app, storage, renderLogin,
  isResetting, isCurrentControl, getPageGeneration, pauseJourney, leaveJourney, enterJourney,
  render, formRendered, askConfirmation, showToast, prepareEntry = async () => "unavailable", isPageActive = () => true,
  prepareLogout = async () => true, pauseIdentity = () => {}, resumeIdentity = () => {} }) {
  const identityStore = createStudentIdentityStore(storage);
  let identity = null, status = "", mode = "initial";
  function readStorage() {
    const raw = storage.getItem(STUDENT_IDENTITY_STORAGE_KEY);
    const saved = identityStore.read();
    const marker = storage.getItem(STUDENT_SIGNED_OUT_STORAGE_KEY);
    if (raw != null && !saved || marker != null && marker !== "1" || marker && !saved) throw Error("學生資料或登入狀態未能讀取，原有資料會保留；請重新開啟網站再試。");
    return { saved, marker };
  }
  try { identity = identityStore.read(); const saved = readStorage(); mode = identity ? saved.marker ? "signedOut" : "journey" : "initial"; }
  catch (error) { mode = "blocked"; status = error.message; }
  let rememberedIdentity = JSON.stringify(identity);
  let draft = emptyIdentity(), errors = {}, saveFailed = false, rendered = false, composing = null, pending = false, transition = 0;
  function emptyIdentity() { return { studentName: "", className: "", studentNumber: "" }; }
  function storedSnapshot() {
    try {
      const saved = readStorage();
      if (JSON.stringify(saved.saved) !== rememberedIdentity) throw Error("學生資料已改動，已暫停操作；原有資料會保留，請重新開啟網站再試。");
      return saved;
    } catch (error) { mode = "blocked"; status = error.message; rendered = false; throw error; }
  }
  const isReady = () => {
    if (mode !== "journey" || pending || !identity || !isPageActive()) return false;
    try {
      if (!storedSnapshot().marker) return true;
      mode = "signedOut"; status = "已在另一分頁登出，原有資料會保留。"; rendered = false; return false;
    } catch { return false; }
  };
  const isRemembered = () => Boolean(identity && JSON.stringify(identity) === rememberedIdentity);
  function acceptEntry(result) {
    if (result === "ready" || result === "unavailable") return true;
    mode = "blocked"; saveFailed = false;
    status = result === "conflict" ? "學生資料與原有待傳紀錄不符，已暫停操作；原有資料會保留。"
      : "未能核對原有待傳紀錄，已暫停操作；原有資料會保留，請重新開啟網站再試。";
    return false;
  }
  const getIdentity = () => !identity ? null : { ...identity };
  function getModel() {
    return Object.freeze({ view: "login", identity: Object.freeze({ ...(mode === "initial" ? draft : identity) }), errors: Object.freeze({ ...errors }),
      mode, status, saveFailed, pending });
  }
  function updateInput(target, isComposing = false) {
    const key = target?.dataset?.studentIdentityField;
    if (mode !== "initial" || pending || !rendered || target.isConnected === false || !app.contains(target)
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
      const control = document.getElementById(mode === "initial" ? `student-login-${Object.keys(errors)[0] || "studentName"}` : "student-login-title");
      control?.focus({ preventScroll: true });
      control?.parentElement?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
    }
  }
  function resumeJourney() {
    rendered = false;
    const nav = document.querySelector(".bottom-nav"); if (nav) nav.hidden = false;
    const button = document.getElementById("student-profile-open"); if (button) button.hidden = false;
  }
  function pauseEntry() { transition++; pending = false; rendered = false; }
  function openProfile() {
    if (!isReady() || isResetting() || [...document.querySelectorAll("dialog")].some(item => item.open)) return;
    pauseJourney();
    pauseIdentity();
    mode = "profile"; transition++; errors = {};
    status = ""; saveFailed = false; rendered = false;
    showForm({ focus: true });
  }
  async function enter({ temporary = false } = {}) {
    if (mode !== "initial" || composing || isResetting() || pending || !isPageActive()) return;
    captureInput(); errors = studentIdentityErrors(draft);
    if (Object.keys(errors).length) { rendered = false; showForm({ focus: true }); return; }
    const next = validateStudentIdentity(draft), token = ++transition, generation = getPageGeneration();
    pending = true; rendered = false; showForm();
    try {
      storedSnapshot();
      const prepared = await prepareEntry(temporary ? null : next);
      if (token !== transition || isResetting() || !isPageActive() || generation !== getPageGeneration()) return;
      if (!acceptEntry(prepared)) return;
      storedSnapshot();
      if (!temporary) {
        try { identityStore.save(next); rememberedIdentity = JSON.stringify(next); }
        catch { status = "未能記住資料，請重試或選擇只在本次使用。"; saveFailed = true; return; }
      }
      identity = next; mode = "journey"; errors = {}; status = ""; saveFailed = false; draft = emptyIdentity();
    } catch {
      if (token === transition && mode === "initial") acceptEntry("failed");
    } finally { if (token === transition) { pending = false; rendered = false; if (mode !== "journey") showForm({ focus: true }); } }
    if (token !== transition) return;
    if (mode !== "journey") return;
    leaveJourney();
    await enterJourney(); resumeIdentity();
    if (temporary) showToast("只在本次使用，重新整理後不會保留這次填寫。", "warning");
  }
  async function prepareJourney({ explicit = false } = {}) {
    if (!identity || pending || isResetting() || !isPageActive() || (explicit ? mode !== "signedOut" && mode !== "profile" : mode !== "journey")) return false;
    const token = ++transition, generation = getPageGeneration(), previousMode = mode;
    pending = true;
    if (explicit) { rendered = false; showForm(); }
    try {
      const saved = storedSnapshot();
      if ((previousMode === "profile" || !explicit) && saved?.marker) { mode = "signedOut"; return false; }
      const prepared = await prepareEntry(isRemembered() ? identity : null);
      if (token !== transition || isResetting() || !isPageActive()) return false;
      if (explicit && generation !== getPageGeneration()) return false;
      if (!acceptEntry(prepared)) return false;
      const latest = storedSnapshot();
      if (latest.marker !== saved.marker) { mode = "signedOut"; return false; }
      if (isRemembered() && explicit && previousMode === "signedOut" && latest.marker) {
        storage.removeItem(STUDENT_SIGNED_OUT_STORAGE_KEY);
        if (storage.getItem(STUDENT_SIGNED_OUT_STORAGE_KEY) != null) throw Error("未能確認登入，請重試。學生資料及紀錄會保留。");
      }
      mode = "journey"; status = ""; saveFailed = false;
      return true;
    } catch (error) { if (token === transition && mode !== "blocked") { mode = previousMode === "profile" ? "profile" : "signedOut"; status = error.message; } return false; }
    finally { if (token === transition) { pending = false; rendered = false; } }
  }
  async function reenter() {
    const previousMode = mode;
    if (!await prepareJourney({ explicit: true })) { if (!pending) showForm({ focus: true }); return; }
    if (previousMode === "profile") {
      render({ moveFocus: true }); resumeIdentity();
      document.getElementById("student-profile-open")?.focus({ preventScroll: true });
    } else {
      leaveJourney(); await enterJourney(); resumeIdentity();
    }
  }
  function resetIdentity() {
    identity = null; rememberedIdentity = "null"; mode = "initial"; transition++; pending = false;
    draft = emptyIdentity(); errors = {}; status = ""; saveFailed = false; rendered = false; composing = null;
  }
  async function logout() {
    if (mode !== "profile" && mode !== "signedOut" || !identity || isResetting() || pending) return;
    const token = ++transition, generation = getPageGeneration();
    const relevant = () => token === transition && !isResetting() && getPageGeneration() === generation;
    pending = true; rendered = false; showForm();
    try {
      if (mode === "profile" && !await askConfirmation({ title: "登出？", message: "學生資料、相片、打卡及已保存的待傳紀錄會保留在這部裝置。再次登入會沿用原來的學生資料。", confirmText: "登出", isRelevant: relevant })) return;
      if (!relevant()) return;
      storedSnapshot();
      if (!await prepareLogout()) { if (relevant()) { saveFailed = true; status = "待傳紀錄尚未存妥，未能完成登出。請保持網頁開啟並重試。"; } return; }
      if (!relevant()) return;
      if (isRemembered()) {
        storedSnapshot();
        storage.setItem(STUDENT_SIGNED_OUT_STORAGE_KEY, "1");
        if (storage.getItem(STUDENT_SIGNED_OUT_STORAGE_KEY) !== "1") throw Error("marker");
      }
      mode = "signedOut"; saveFailed = false; status = isRemembered() ? "已登出，原有資料仍保留在這部裝置。" : "已登出。本次資料只留在這個分頁，重新整理後不會保留學生資料。";
      leaveJourney();
    } catch {
      if (relevant() && mode !== "blocked") { mode = "signedOut"; saveFailed = true; status = "未能確認已保存登出狀態。請保持網頁開啟並重試；重新整理可能再次開啟旅程。原有資料會保留。"; }
    } finally {
      if (token === transition) { pending = false; rendered = false; showForm({ focus: true }); }
    }
  }
  function clear() {
    transition++; pauseIdentity();
    identityStore.clear();
    storage.removeItem(STUDENT_SIGNED_OUT_STORAGE_KEY);
    if (storage.getItem(STUDENT_SIGNED_OUT_STORAGE_KEY) != null) throw Error("未能清除登出狀態。");
    resetIdentity();
  }
  function reconcileStorage(event = { key: STUDENT_IDENTITY_STORAGE_KEY }) {
    if (event.storageArea && event.storageArea !== storage
      || ![STUDENT_IDENTITY_STORAGE_KEY, STUDENT_SIGNED_OUT_STORAGE_KEY, null].includes(event.key)) return;
    let nextMode;
    try {
      const saved = storedSnapshot();
      if (!saved.marker) return;
      nextMode = "signedOut"; status = "已在另一分頁登出，原有資料會保留。";
    } catch (error) { nextMode = "blocked"; status = error.message; }
    const token = ++transition;
    mode = nextMode; pending = true; composing = null; rendered = false;
    pauseJourney(); pauseIdentity(); leaveJourney(); showForm({ focus: true });
    void prepareLogout().then(saved => {
      if (token !== transition) return;
      saveFailed = !saved;
      if (!saved) status = "待傳紀錄尚未存妥，請保持網頁開啟並重試；離開或重載會遺失未保存的紀錄。";
    }).catch(() => { if (token === transition) status = "未能保存待傳紀錄，請保持網頁開啟並重試。"; })
      .finally(() => { if (token === transition) { pending = false; rendered = false; showForm(); } });
  }
  function handleInput(event) { updateInput(event.target, event.isComposing || composing === event.target); }
  function handleSubmit(event) {
    if (event.target.id !== "student-login-form" || event.target.isConnected === false || !app.contains(event.target)) return;
    event.preventDefault(); return enter();
  }
  function beginComposition(event) {
    if (mode === "initial" && !pending && event.target.dataset?.studentIdentityField && app.contains(event.target)) composing = event.target;
  }
  function endComposition(event) {
    if (composing === event.target) { composing = null; updateInput(event.target); }
  }
  // Return false synchronously for journey controls, preserving their user-activation timing.
  function handleClick(target) {
    if (target.matches("[data-student-profile-open]") && target.isConnected !== false) { openProfile(); return true; }
    if (isReady()) return false;
    if (!isCurrentControl(target) || target.disabled || pending) return true;
    if (target.matches("[data-student-identity-temporary]") && saveFailed) return enter({ temporary: true });
    if (target.matches("[data-student-identity-logout]")) return logout();
    if (target.matches("[data-student-identity-return]") && mode === "profile" || target.matches("[data-student-identity-login]") && mode === "signedOut") return reenter();
    return true;
  }
  return Object.freeze({ isReady, isRemembered, getIdentity, getModel, showForm, resumeJourney, prepareJourney, pauseEntry, clear, reconcileStorage,
    handleInput, handleSubmit, beginComposition, endComposition, handleClick });
}
