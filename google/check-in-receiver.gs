/* Google Apps Script V8. Not part of the GitHub Pages publish allowlist.
 * Owner setup: import the private log sheet and set Script Properties before
 * deploying as owner. Sheet access uses the built-in Spreadsheet service.
 * SPREADSHEET_ID: private native Sheet ID; SIGNING_KEY: a private random
 * secret of at least 32 chars. Enrollment is public, not identity verification.
 * ENABLED: true only after synthetic write/receipt testing. Access must be
 * permitted by the school's policy; do not make the spreadsheet public.
 * Tickets bind an upload session and preserve event integrity, but anyone can
 * obtain one. Never put private keys in source, execution logs or responses.
 */
const ACTIVITY_ID_ = 'bwflc-2026-11-05';
// Include the whole 23:59 minute; this Hong Kong cutoff is exclusive.
const UPLOAD_CUTOFF_ = Date.parse('2026-11-10T00:00:00+08:00');
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
    requireOpen_();
    if (body.action === 'enable') return output_(enable_(body, properties));
    if (body.action === 'submit') return output_(submit_(body, properties));
    throw new Error('FORMAT');
  } catch (error) {
    const allowed = ['TICKET', 'FORMAT', 'ACTIVITY', 'DISABLED', 'CONFIG', 'ORDER', 'BUSY', 'CLOSED'];
    return output_({ ok: false, error: allowed.indexOf(error.message) >= 0 ? error.message : 'WRITE' });
  }
}

function requireOpen_() {
  if (Date.now() >= UPLOAD_CUTOFF_) throw new Error('CLOSED');
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
  requireOpen_();
  keys_(body, ['version', 'activityId', 'action', 'identity', 'sessionId']);
  const identity = identity_(body.identity), sessionId = id_(body.sessionId), expiresAt = UPLOAD_CUTOFF_;
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
      || value.expiresAt <= Date.now() || value.expiresAt > UPLOAD_CUTOFF_) throw new Error();
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
function logSheet_(sheetId) {
  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName(TAB_NAME_);
  if (!sheet) throw new Error('CONFIG');
  const rows = sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), HEADERS_.length).getValues();
  if (JSON.stringify(rows[0]) !== JSON.stringify(HEADERS_)) throw new Error('CONFIG');
  return { sheet: sheet, history: rows.slice(1) };
}
function eventRow_(owner, event) {
  return [owner.identity.studentName, owner.identity.className, owner.identity.studentNumber,
    STATIONS_[event.attractionId], event.checkedInAt, null, event.method === 'gps' ? '定位' : '手動',
    event.verified ? '裝置回報已核實' : '裝置回報未核實', event.action === 'checkin' ? '打卡' : '取消',
    event.eventId, event.sequence, event.checkInId, ACTIVITY_ID_, owner.sessionId, event.eventAt, event.attractionId];
}
function sameEventRow_(expected, actual) {
  return actual && expected.every(function (cell, index) { return index === 5 || String(cell) === String(actual[index]); });
}
function submit_(body, properties) {
  keys_(body, ['version', 'activityId', 'action', 'ticket', 'events']);
  const owner = ticket_(body.ticket, properties);
  if (!Array.isArray(body.events) || !body.events.length || body.events.length > 20) throw new Error('FORMAT');
  const events = body.events.map(event_);
  if (new Set(events.map(function (event) { return event.eventId; })).size !== events.length) throw new Error('FORMAT');
  const sheetId = properties.getProperty('SPREADSHEET_ID');
  if (!sheetId || !/^[A-Za-z0-9_-]+$/.test(sheetId)) throw new Error('CONFIG');
  let cache, cacheKey, cached = false;
  try {
    cache = CacheService.getScriptCache();
    cacheKey = mac_(JSON.stringify(['submit-v1', sheetId, TAB_NAME_, ACTIVITY_ID_,
      owner.identity.studentName, owner.identity.className, owner.identity.studentNumber, owner.sessionId,
      events.map(function (event) { return [event.eventId, event.sequence, event.checkInId, event.attractionId,
        event.checkedInAt, event.eventAt, event.method, event.verified, event.action]; })]), properties);
    cached = cache.get(cacheKey) === '1';
  } catch {}
  if (cached) {
    const history = logSheet_(sheetId).history;
    if (events.every(function (event) {
      return sameEventRow_(eventRow_(owner, event), history.find(function (row) { return row[9] === event.eventId; }));
    })) {
      requireOpen_();
      return { ok: true, sessionId: owner.sessionId, accepted: events.map(function (event) { return event.eventId; }) };
    }
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('BUSY');
  const accepted = [];
  try {
    requireOpen_();
    const log = logSheet_(sheetId), sheet = log.sheet, history = log.history;
    let capacity = sheet.getMaxRows();
    for (const event of events) {
      requireOpen_();
      const duplicate = history.find(function (row) { return row[9] === event.eventId; });
      const expected = eventRow_(owner, event);
      if (duplicate) {
        if (!sameEventRow_(expected, duplicate)) throw new Error('ORDER');
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
      requireOpen_();
      expected[5] = new Date().toISOString();
      if (history.length + 2 > capacity) {
        sheet.insertRowsAfter(capacity, events.length); capacity += events.length;
        requireOpen_();
      }
      // A leading apostrophe preserves every string literally, including formulas and zeros.
      sheet.getRange(history.length + 2, 1, 1, HEADERS_.length)
        .setValues([expected.map(function (cell) { return typeof cell === 'string' ? "'" + cell : cell; })]);
      history.push(expected); accepted.push(event.eventId);
    }
  } finally {
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }
  try { if (cache && cacheKey) cache.put(cacheKey, '1', 600); } catch {}
  return { ok: true, sessionId: owner.sessionId, accepted: accepted };
}
