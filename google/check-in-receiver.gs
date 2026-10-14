/* Google Apps Script V8. Not part of the GitHub Pages publish allowlist.
 * Owner setup: import the private log sheet, add the Google Sheets advanced
 * service, and set Script Properties before deploying as owner.
 * SPREADSHEET_ID: private native Sheet ID; ACTIVITY_CODE_HASH: SHA-256 hex of
 * the teacher's code; SIGNING_KEY: a private random secret of at least 32 chars.
 * ENABLED: true only after synthetic write/receipt testing. Access must be
 * permitted by the school's policy; do not make the spreadsheet public.
 * Owner editor: run generateActivityCode(), then read CURRENT_ACTIVITY_CODE
 * in private Script Properties. Never put real codes/keys in this source,
 * execution logs or HTTP responses.
 */
const ACTIVITY_ID_ = 'bwflc-2026-11-05';
const TAB_NAME_ = '打卡紀錄';
const STATIONS_ = {
  'departure-school': '佛教黃鳳翎中學',
  'future-school': '東莞松山湖未來學校',
  'sun-yat-sen': '孫中山故居紀念館',
  'lunjiao-cake': '歡姐倫教糕博物館',
  'shawan-town': '沙灣古鎮',
  'liugeng-hall': '留耕堂'
};
const HEADERS_ = ['姓名', '班別', '學號', '景點', '裝置打卡時間', 'Google 接收時間',
  '打卡方式', '裝置回報核實狀態', '動作', '事件 ID', '順序', '原打卡 ID',
  '活動 ID', '上傳批次 ID', '裝置事件時間', '景點 ID'];

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (typeof raw !== 'string' || raw.length > 65536) throw new Error('FORMAT');
    const body = JSON.parse(raw);
    const properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('ENABLED') !== 'true') throw new Error('DISABLED');
    if (body.version !== 1 || body.activityId !== ACTIVITY_ID_) throw new Error('ACTIVITY');
    if (body.action === 'enable') return output_(enable_(body, properties));
    if (body.action === 'submit') return output_(submit_(body, properties));
    throw new Error('FORMAT');
  } catch (error) {
    const allowed = ['CODE', 'TICKET', 'FORMAT', 'ACTIVITY', 'DISABLED', 'CONFIG', 'ORDER', 'BUSY'];
    return output_({ ok: false, error: allowed.indexOf(error.message) >= 0 ? error.message : 'WRITE' });
  }
}

function output_(value) {
  return ContentService.createTextOutput(JSON.stringify(Object.assign({ version: 1, activityId: ACTIVITY_ID_ }, value)))
    .setMimeType(ContentService.MimeType.JSON);
}
function keys_(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== names.slice().sort().join('|')) throw new Error('FORMAT');
}
function text_(value, max) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || Array.from(value).length > max
    || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)) throw new Error('FORMAT');
  return value;
}
function identity_(value) {
  keys_(value, ['studentName', 'className', 'studentNumber']);
  return { studentName: text_(value.studentName, 40), className: text_(value.className, 20), studentNumber: text_(value.studentNumber, 20) };
}
function id_(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('FORMAT');
  return value;
}
function iso_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('FORMAT');
  return value;
}
function activityCodeHash_(code) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, code, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

// Owner editor only: set ACTIVITY_CODE in private properties, then run this.
function configureActivityCode() {
  const lock = activityCodeLock_();
  try {
    const properties = PropertiesService.getScriptProperties();
    saveActivityCode_(properties, text_(properties.getProperty('ACTIVITY_CODE'), 128));
  } finally { lock.releaseLock(); }
}

// Owner editor only: generate and save a code without returning or logging it.
function generateActivityCode() {
  const lock = activityCodeLock_();
  try {
    const properties = PropertiesService.getScriptProperties();
    let code;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
          Utilities.getUuid() + ':' + Utilities.getUuid(), Utilities.Charset.UTF_8);
        code = 'BW-' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '').slice(0, 20);
        if (/^BW-[A-Za-z0-9_-]{20}$/.test(code)
          && !equal_(activityCodeHash_(code), properties.getProperty('ACTIVITY_CODE_HASH'))) break;
        code = null;
      }
      if (!code) throw new Error();
    } catch { throw new Error('未能產生新活動碼，原有設定不變。請重試。'); }
    saveActivityCode_(properties, code);
  } finally { lock.releaseLock(); }
}

function activityCodeLock_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('正在處理上傳或活動碼，請稍後重試。');
  return lock;
}

function saveActivityCode_(properties, code) {
  const names = ['ACTIVITY_CODE_HASH', 'CURRENT_ACTIVITY_CODE', 'ACTIVITY_CODE'];
  const previous = names.map(function (name) { return properties.getProperty(name); });
  const hash = activityCodeHash_(code);
  try {
    properties.setProperties({ ACTIVITY_CODE_HASH: hash, CURRENT_ACTIVITY_CODE: code }, false);
    properties.deleteProperty('ACTIVITY_CODE');
    if (properties.getProperty('ACTIVITY_CODE_HASH') !== hash || properties.getProperty('CURRENT_ACTIVITY_CODE') !== code
      || properties.getProperty('ACTIVITY_CODE') != null) throw new Error();
  } catch {
    // Restore only code settings; never replace the signing key or sheet setup.
    try {
      names.forEach(function (name, index) {
        if (previous[index] == null) properties.deleteProperty(name);
        else properties.setProperty(name, previous[index]);
      });
      if (names.some(function (name, index) { return (properties.getProperty(name) ?? null) !== (previous[index] ?? null); })) throw new Error();
    } catch { throw new Error('未能保存活動碼，亦未能確認還原。請先檢查私人專案設定，不要派發新碼。'); }
    throw new Error('未能保存新活動碼，已還原原有設定。請重試。');
  }
}
function equal_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return diff === 0;
}
function signingKey_(properties) {
  const secret = properties.getProperty('SIGNING_KEY');
  if (!secret || secret.length < 32) throw new Error('CONFIG');
  return secret;
}
function mac_(encoded, properties) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(encoded, signingKey_(properties), Utilities.Charset.UTF_8)).replace(/=+$/, '');
}
function enable_(body, properties) {
  keys_(body, ['version', 'activityId', 'action', 'code', 'identity', 'sessionId']);
  const code = text_(body.code, 128), expected = properties.getProperty('ACTIVITY_CODE_HASH');
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('CONFIG');
  if (!equal_(activityCodeHash_(code), expected)) throw new Error('CODE');
  const identity = identity_(body.identity), sessionId = id_(body.sessionId), expiresAt = Date.now() + 7 * 86400000;
  const payload = { version: 1, activityId: ACTIVITY_ID_, identity: identity, sessionId: sessionId, expiresAt: expiresAt };
  const encoded = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8).replace(/=+$/, '');
  return { ok: true, ticket: encoded + '.' + mac_(encoded, properties), expiresAt: expiresAt, sessionId: sessionId };
}
function ticket_(ticket, properties) {
  try {
    if (typeof ticket !== 'string' || ticket.length > 4096) throw new Error();
    const parts = ticket.split('.');
    if (parts.length !== 2 || !equal_(mac_(parts[0], properties), parts[1])) throw new Error();
    const value = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
    keys_(value, ['version', 'activityId', 'identity', 'sessionId', 'expiresAt']);
    if (value.version !== 1 || value.activityId !== ACTIVITY_ID_ || !Number.isFinite(value.expiresAt)
      || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + 8 * 86400000) throw new Error();
    value.identity = identity_(value.identity); id_(value.sessionId); return value;
  } catch { throw new Error('TICKET'); }
}
function event_(value) {
  keys_(value, ['eventId', 'sequence', 'checkInId', 'attractionId', 'checkedInAt', 'eventAt', 'method', 'verified', 'action']);
  id_(value.eventId); id_(value.checkInId); iso_(value.checkedInAt); iso_(value.eventAt);
  if (!Object.prototype.hasOwnProperty.call(STATIONS_, value.attractionId) || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > 1000000
    || ['gps', 'manual'].indexOf(value.method) < 0 || value.verified !== (value.method === 'gps') || ['checkin', 'cancel'].indexOf(value.action) < 0
    || value.action === 'checkin' && value.checkInId !== value.eventId || value.action === 'cancel' && value.checkInId === value.eventId) throw new Error('FORMAT');
  return value;
}
function submit_(body, properties) {
  keys_(body, ['version', 'activityId', 'action', 'ticket', 'events']);
  const owner = ticket_(body.ticket, properties);
  if (!Array.isArray(body.events) || !body.events.length || body.events.length > 20) throw new Error('FORMAT');
  const events = body.events.map(event_);
  if (new Set(events.map(function (event) { return event.eventId; })).size !== events.length) throw new Error('FORMAT');
  const sheetId = properties.getProperty('SPREADSHEET_ID');
  if (!sheetId || !/^[A-Za-z0-9_-]+$/.test(sheetId)) throw new Error('CONFIG');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('BUSY');
  try {
    const rows = (Sheets.Spreadsheets.Values.get(sheetId, "'" + TAB_NAME_ + "'!A:P").values || []);
    if (JSON.stringify(rows[0]) !== JSON.stringify(HEADERS_)) throw new Error('CONFIG');
    const history = rows.slice(1), accepted = [];
    for (const event of events) {
      const duplicate = history.find(function (row) { return row[9] === event.eventId; });
      const expected = [owner.identity.studentName, owner.identity.className, owner.identity.studentNumber,
        STATIONS_[event.attractionId], event.checkedInAt, null, event.method === 'gps' ? '定位' : '手動',
        event.verified ? '裝置回報已核實' : '裝置回報未核實', event.action === 'checkin' ? '打卡' : '取消',
        event.eventId, event.sequence, event.checkInId, ACTIVITY_ID_, owner.sessionId, event.eventAt, event.attractionId];
      if (duplicate) {
        if (!expected.every(function (cell, index) { return index === 5 || String(cell) === String(duplicate[index]); })) throw new Error('ORDER');
        accepted.push(event.eventId); continue;
      }
      const owned = history.filter(function (row) { return row[13] === owner.sessionId; });
      const lastSequence = owned.reduce(function (max, row) { return Math.max(max, Number(row[10]) || 0); }, 0);
      if (event.sequence !== lastSequence + 1 || owned.some(function (row) {
        return row[0] !== owner.identity.studentName || row[1] !== owner.identity.className || row[2] !== owner.identity.studentNumber;
      })) throw new Error('ORDER');
      if (event.action === 'cancel') {
        const parent = owned.find(function (row) { return row[9] === event.checkInId && row[8] === '打卡'; });
        if (!parent || parent[15] !== event.attractionId || parent[4] !== event.checkedInAt || parent[6] !== expected[6]
          || owned.some(function (row) { return row[11] === event.checkInId && row[8] === '取消'; })) throw new Error('ORDER');
      }
      expected[5] = new Date().toISOString();
      // RAW appends preserve zero-prefixed identifiers and never evaluate student text.
      Sheets.Spreadsheets.Values.append({ values: [expected] }, sheetId, "'" + TAB_NAME_ + "'!A:P", { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' });
      history.push(expected); accepted.push(event.eventId);
    }
    return { ok: true, sessionId: owner.sessionId, accepted: accepted };
  } finally { lock.releaseLock(); }
}
