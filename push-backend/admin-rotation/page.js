const escapeAttribute = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
export const renderPage = adminUrl => `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>老師憑證領取</title><link rel="stylesheet" href="/page.css"><script type="module" src="/page.js"></script></head>
<body><main><p class="eyebrow">旅程助手 · 老師專用</p><h1>領取老師登入憑證</h1><p>憑證每 90 天自動更換。領取後，複製到公告後台的「憑證」欄即可發送公告。</p>
<button id="retrieve" type="button">領取目前憑證</button><p id="status" role="status" aria-live="polite">按上方按鈕領取。</p>
<section id="result" hidden><label for="token">目前憑證</label><input id="token" type="password" readonly autocomplete="off" spellcheck="false"><button id="copy" type="button">複製憑證</button><button id="clear" type="button" class="secondary">清除顯示</button><p id="dates"></p><p class="small">請私下保管。頁面會在 10 分鐘後清除憑證；離開頁面也會清除。</p></section>
<a href="${escapeAttribute(adminUrl)}" target="_blank" rel="noopener noreferrer">開啟公告後台</a></main></body></html>`;
export const STYLE = `:root{color-scheme:light;font-family:system-ui,sans-serif;color:#173c48;background:#f6f3eb}*{box-sizing:border-box}body{margin:0;padding:24px 16px}main{max-width:640px;margin:24px auto;padding:28px;background:#fff;border-radius:16px}h1{font-size:clamp(24px,6vw,32px);line-height:1.35}p{line-height:1.75}.eyebrow,.small{font-size:14px}.eyebrow{color:#416474}button{font:inherit;min-height:48px;padding:12px 18px;background:#173c48;color:white;border:2px solid #173c48;border-radius:8px;cursor:pointer;margin:4px 8px 4px 0;max-width:100%}.secondary{background:white;color:#173c48}button:disabled{opacity:.6;cursor:wait}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #dc9f36;outline-offset:3px}label{display:block;margin:16px 0 8px}input{width:100%;min-width:0;font:16px monospace;padding:12px;border:1px solid #78909a;border-radius:6px}a{display:inline-block;color:#175f7e;margin-top:24px;line-height:1.6;overflow-wrap:anywhere}[hidden]{display:none!important}`;
export const SCRIPT = `class UserError extends Error {}
const get = (id) => document.getElementById(id);
const status = get('status'); let generation = 0; let timer;
function clear() { generation++; clearTimeout(timer); get('token').value = ''; get('dates').textContent = ''; get('result').hidden = true; get('retrieve').disabled = false; }
get('retrieve').addEventListener('click', async () => {
  clear(); const operation = generation; get('retrieve').disabled = true; status.textContent = '正在領取憑證…';
  try {
    const res = await fetch('/v1/credential', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}', cache:'no-store', credentials:'same-origin', redirect:'error', signal:AbortSignal.timeout(15000)});
    if (generation !== operation) return;
    const data = await res.json();
    if (generation !== operation) return;
    if (!res.ok) throw new UserError(typeof data.error === 'string' && data.error.length <= 160 ? data.error : '未能領取，請重新登入或稍後再試。');
    if (!/^[A-Za-z0-9_-]{43}$/.test(data.token) || !Number.isSafeInteger(data.rotatedAt) || !Number.isSafeInteger(data.nextRotationAt)) throw new UserError('未能確認憑證，請稍後再試。');
    get('token').value = data.token; get('result').hidden = false;
    const format = (date) => new Intl.DateTimeFormat('zh-HK', {dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Hong_Kong'}).format(date);
    get('dates').textContent = '生效：' + format(data.rotatedAt) + (data.rotationPending === true ? '；原定更換：' : '；下次更換約：') + format(data.nextRotationAt);
    status.textContent = data.rotationPending === true ? '目前憑證仍可使用；更新完成後請重新領取。' : '已領取，請複製到公告後台。';
    timer = setTimeout(() => { clear(); status.textContent = '已清除顯示，需要時可重新領取。'; }, 600000);
  } catch (error) { if (generation === operation) status.textContent = error instanceof UserError ? error.message : '未能領取，登入可能已到期。請重新登入或稍後再試。'; }
  finally { if (generation === operation) get('retrieve').disabled = false; }
});
get('copy').addEventListener('click', async () => { const operation = generation; const value = get('token').value; if (!value) return; try { await navigator.clipboard.writeText(value); if (generation === operation) status.textContent = '已複製。請貼到公告後台的「憑證」欄。'; } catch { if (generation === operation) status.textContent = '未能複製，請允許瀏覽器使用剪貼簿後再試。'; } });
get('clear').addEventListener('click', () => { clear(); status.textContent = '已清除顯示。'; });
addEventListener('pagehide', clear); addEventListener('pageshow', () => { clear(); status.textContent = '需要時可重新領取憑證。'; });`;
