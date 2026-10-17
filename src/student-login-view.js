import { escapeHtml } from "./formatting.js";
import { STUDENT_IDENTITY_LABELS } from "./student-identity.js";

export function renderStudentLogin({ identity, errors = {}, mode = "initial", pending = false, status = "", saveFailed = false, canInstall = false, testOnly = false }) {
  const disabled = pending ? "disabled" : "";
  return `<section class="page-shell student-login"><h1 id="student-login-title" tabindex="-1">${mode === "profile" ? "學生資料" : "登入"}</h1>
    ${testOnly ? '<p class="privacy-note">測試登入。請使用虛構姓名、班別及學號；只會保存於這部裝置的測試資料。</p>' : ""}
    ${mode === "initial" ? `<form id="student-login-form" novalidate>
      <div class="student-login-fields">${Object.entries(STUDENT_IDENTITY_LABELS).map(([key, label]) => `<div><label for="student-login-${key}">${label}</label><input id="student-login-${key}" data-student-identity-field="${key}" type="text" required ${disabled} autocomplete="off" spellcheck="false" value="${escapeHtml(identity[key])}" aria-invalid="${Boolean(errors[key])}" aria-describedby="student-login-${key}-error"><p id="student-login-${key}-error" class="field-error" ${errors[key] ? "" : "hidden"}>${escapeHtml(errors[key] || "")}</p></div>`).join("")}</div>
      <div class="student-login-actions"><button type="submit" class="button button-primary"${pending ? " disabled" : ""}>千里之行 始於足下，踏上旅程</button>
        ${saveFailed ? `<button type="button" class="button button-secondary" data-student-identity-temporary ${disabled}>只在本次使用</button>` : ""}
      </div>
    </form>` : `<dl class="student-profile-details">${Object.entries(STUDENT_IDENTITY_LABELS).map(([key, label]) => `<div><dt>${label}</dt><dd>${escapeHtml(identity?.[key] || "")}</dd></div>`).join("")}</dl>
      <div class="student-login-actions">${mode === "profile" ? `<button type="button" class="button button-secondary" data-student-identity-return ${disabled}>返回</button><button type="button" class="button button-secondary" data-student-identity-logout ${disabled}>登出</button>` : mode === "signedOut" ? `<button type="button" class="button button-primary" data-student-identity-login ${disabled}>登入</button>${saveFailed ? `<button type="button" class="button button-secondary" data-student-identity-logout ${disabled}>重試登出</button>` : ""}` : ""}</div>`}
    <p id="student-login-status" role="status" class="field-error" ${status || pending ? "" : "hidden"}>${escapeHtml(pending ? "正在處理，請稍候。" : status)}</p>
    <div class="student-login-install" ${mode !== "initial" ? "hidden" : ""}><button id="student-login-install" type="button" class="button button-secondary" data-install-open ${canInstall ? "" : "hidden"} aria-haspopup="dialog" aria-controls="install-invitation">加入主畫面</button></div>
  </section>`;
}
