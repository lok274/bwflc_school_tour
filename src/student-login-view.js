import { escapeHtml } from "./formatting.js";
import { STUDENT_IDENTITY_LABELS } from "./student-identity.js";

export function renderStudentLogin({ identity, errors = {}, editing = false, status = "", saveFailed = false, canInstall = false }) {
  return `<section class="page-shell student-login"><h1 id="student-login-title" tabindex="-1">${editing ? "學生資料" : "登入"}</h1>
    <form id="student-login-form" novalidate>
      <div class="student-login-fields">${Object.entries(STUDENT_IDENTITY_LABELS).map(([key, label]) => `<div><label for="student-login-${key}">${label}</label><input id="student-login-${key}" data-student-identity-field="${key}" type="text" required autocomplete="off" spellcheck="false" value="${escapeHtml(identity[key])}" aria-invalid="${Boolean(errors[key])}" aria-describedby="student-login-${key}-error"><p id="student-login-${key}-error" class="field-error" ${errors[key] ? "" : "hidden"}>${escapeHtml(errors[key] || "")}</p></div>`).join("")}</div>
      <p id="student-login-status" role="status" class="field-error" ${status ? "" : "hidden"}>${escapeHtml(status)}</p>
      <div class="student-login-actions"><button type="submit" class="button button-primary">${editing ? "保存並返回" : "千里之行 始於足下，踏上旅程"}</button>
        ${saveFailed ? '<button type="button" class="button button-secondary" data-student-identity-temporary>只在本次使用</button>' : ""}
        ${editing ? '<button type="button" class="button button-secondary" data-student-identity-cancel>取消修改</button><button type="button" class="button button-secondary" data-student-identity-logout>登出</button>' : ""}
      </div>
    </form>
    <div class="student-login-install" ${editing ? "hidden" : ""}><button id="student-login-install" type="button" class="button button-secondary" data-install-open ${canInstall ? "" : "hidden"} aria-haspopup="dialog" aria-controls="install-invitation">加入主畫面</button></div>
  </section>`;
}
