import { ApiError, equalSecret } from "./security.js";

export const MAX_SUBSCRIPTIONS = 2000;
export const MAX_ATTEMPTS = 5;
export const RETENTION_MS = 30 * 86400000;
const RETRYABLE = new Set(["network_error", "rate_limited", "provider_unavailable", "provider_auth"]);

export class PushRepository {
  constructor(storage) { this.storage = storage; this.sql = storage.sql; }
  initialize() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, ownerHash TEXT NOT NULL, keyId TEXT NOT NULL, version TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS tombstones (id TEXT NOT NULL, ownerHash TEXT NOT NULL, expiresAt INTEGER NOT NULL, PRIMARY KEY (id, ownerHash))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, idempotencyKey TEXT UNIQUE NOT NULL, payloadHash TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, route TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, isPublic INTEGER NOT NULL, manualRetries INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS deliveries (messageId TEXT NOT NULL, subscriptionId TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, nextAttemptAt INTEGER NOT NULL, leaseUntil INTEGER NOT NULL DEFAULT 0, leaseId TEXT NOT NULL DEFAULT '', lastError TEXT NOT NULL DEFAULT '', updatedAt INTEGER NOT NULL, PRIMARY KEY (messageId, subscriptionId))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, windowStart INTEGER NOT NULL, count INTEGER NOT NULL, expiresAt INTEGER NOT NULL)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries(state, nextAttemptAt)");
  }
  rows(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  one(query, ...args) { return this.rows(query, ...args)[0]; }
  rate(key, limit, windowMs, now) {
    const start = Math.floor(now / windowMs) * windowMs;
    const current = this.one("SELECT windowStart, count FROM rate_limits WHERE key = ?", key);
    if (current?.windowStart === start && current.count >= limit) throw new ApiError(429, "rate_limited", "操作過於頻密，請稍後重試。 ");
    this.sql.exec("INSERT INTO rate_limits(key, windowStart, count, expiresAt) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET windowStart = excluded.windowStart, expiresAt = excluded.expiresAt, count = CASE WHEN rate_limits.windowStart = excluded.windowStart THEN rate_limits.count + 1 ELSE 1 END", key, start, start + Math.min(windowMs, 86400000));
  }
  register(sub, keyId, now) {
    return this.storage.transactionSync(() => {
      const cancelled = this.one("SELECT expiresAt FROM tombstones WHERE id = ? AND ownerHash = ? AND expiresAt > ?", sub.id, sub.ownerHash, now);
      if (cancelled) throw new ApiError(409, "subscription_cancelled", "這個訂閱已取消，請重新開啟通知。 ");
      const current = this.one("SELECT ownerHash FROM subscriptions WHERE id = ?", sub.id);
      if (current && !equalSecret(current.ownerHash, sub.ownerHash)) throw new ApiError(409, "owner_conflict", "請在此裝置重新建立通知訂閱。 ");
      if (!current && this.one("SELECT COUNT(*) AS count FROM subscriptions").count >= MAX_SUBSCRIPTIONS) throw new ApiError(503, "capacity_reached", "推送服務暫未能加入新訂閱。 ");
      this.sql.exec("INSERT INTO subscriptions(id, endpoint, p256dh, auth, ownerHash, keyId, version, createdAt, updatedAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, keyId = excluded.keyId, version = excluded.version, updatedAt = excluded.updatedAt, expiresAt = excluded.expiresAt", sub.id, sub.endpoint, sub.p256dh, sub.auth, sub.ownerHash, keyId, crypto.randomUUID(), now, now, sub.expiresAt);
      return { id: sub.id, keyId, registered: true, expiresAt: sub.expiresAt };
    });
  }
  authorizeOwner(id, hash) {
    const sub = this.one("SELECT * FROM subscriptions WHERE id = ?", id);
    if (sub && !equalSecret(sub.ownerHash, hash)) throw new ApiError(401, "unauthorized", "訂閱管理憑證不正確。 ");
    return sub;
  }
  remove(id, ownerHash, now) {
    this.storage.transactionSync(() => {
      this.authorizeOwner(id, ownerHash);
      const exists = this.one("SELECT id FROM tombstones WHERE id = ? AND ownerHash = ?", id, ownerHash);
      if (!exists && this.one("SELECT COUNT(*) AS count FROM tombstones").count >= 10000) throw new ApiError(503, "capacity_reached", "清理服務暫時繁忙，請稍後重試。 ");
      this.sql.exec("INSERT INTO tombstones(id, ownerHash, expiresAt) VALUES (?, ?, ?) ON CONFLICT(id,ownerHash) DO UPDATE SET expiresAt = excluded.expiresAt", id, ownerHash, now + RETENTION_MS);
      this.sql.exec("DELETE FROM subscriptions WHERE id = ?", id);
      this.sql.exec("UPDATE deliveries SET state = 'cancelled', leaseId = '', leaseUntil = 0, updatedAt = ? WHERE subscriptionId = ? AND state IN ('queued','retry','sending')", now, id);
    });
  }
  createMessage(message, key, payloadHash, now, singleId = null) {
    return this.storage.transactionSync(() => {
      const existing = this.one("SELECT * FROM messages WHERE idempotencyKey = ?", key);
      if (existing) {
        if (!equalSecret(existing.payloadHash, payloadHash)) throw new ApiError(409, "idempotency_conflict", "這個訊息識別碼已用於不同內容。 ");
        return this.status(existing.id);
      }
      const id = crypto.randomUUID();
      const expiry = now + (singleId ? 300 : 86400) * 1000;
      this.sql.exec("INSERT INTO messages(id,idempotencyKey,payloadHash,title,body,route,createdAt,expiresAt,isPublic) VALUES (?,?,?,?,?,?,?,?,?)", id, key, payloadHash, message.title, message.body, message.route, now, expiry, singleId ? 0 : 1);
      const subscribers = singleId ? this.rows("SELECT id FROM subscriptions WHERE id = ? AND expiresAt > ?", singleId, now) : this.rows("SELECT id FROM subscriptions WHERE expiresAt > ?", now);
      for (const sub of subscribers) this.sql.exec("INSERT INTO deliveries(messageId, subscriptionId, state, nextAttemptAt, updatedAt) VALUES (?, ?, 'queued', ?, ?)", id, sub.id, now, now);
      return this.status(id);
    });
  }
  status(id) {
    const message = this.one("SELECT id,createdAt FROM messages WHERE id = ?", id);
    if (!message) throw new ApiError(404, "not_found", "找不到這個發送工作。 ");
    const groups = this.rows("SELECT state, COUNT(*) AS count, MAX(updatedAt) AS updatedAt FROM deliveries WHERE messageId = ? GROUP BY state", id);
    const counts = Object.fromEntries(groups.map((row) => [row.state, row.count]));
    const total = groups.reduce((sum, row) => sum + row.count, 0);
    const pending = (counts.queued || 0) + (counts.retry || 0) + (counts.sending || 0);
    const accepted = counts.accepted || 0; const failed = counts.failed || 0;
    const expired = (counts.expired || 0) + (counts.cancelled || 0);
    const status = pending ? (accepted || counts.sending ? "sending" : "queued") : failed || expired ? (accepted ? "partial" : failed ? "failed" : "expired") : "complete";
    return { jobId: id, messageId: id, status, total, accepted, pending, failed, expired, createdAt: message.createdAt, updatedAt: Math.max(message.createdAt, ...groups.map((row) => row.updatedAt)) };
  }
  messages(now) {
    return this.rows("SELECT id,title,body,route,createdAt FROM messages WHERE isPublic = 1 AND createdAt > ? ORDER BY createdAt DESC, id DESC LIMIT 20", now - RETENTION_MS);
  }
  retry(id, now) {
    this.storage.transactionSync(() => {
      const message = this.one("SELECT * FROM messages WHERE id = ?", id);
      if (!message) throw new ApiError(404, "not_found", "找不到這個發送工作。 ");
      if (message.expiresAt <= now) throw new ApiError(409, "expired", "這個訊息的推送期限已過。 ");
      const failed = this.rows("SELECT * FROM deliveries WHERE messageId = ? AND state = 'failed'", id).filter((row) => RETRYABLE.has(row.lastError));
      if (!failed.length) return;
      if (message.manualRetries >= 2) throw new ApiError(409, "retry_limit", "已達重試上限。 ");
      this.sql.exec("UPDATE messages SET manualRetries = manualRetries + 1 WHERE id = ?", id);
      for (const row of failed) this.sql.exec("UPDATE deliveries SET state = 'retry', attempts = 0, nextAttemptAt = ?, leaseUntil = 0, leaseId = '', updatedAt = ? WHERE messageId = ? AND subscriptionId = ? AND state = 'failed'", now, now, id, row.subscriptionId);
    });
    return this.status(id);
  }
  cleanup(now) {
    this.storage.transactionSync(() => {
      this.sql.exec("UPDATE deliveries SET state = 'expired', leaseId = '', leaseUntil = 0, updatedAt = ? WHERE state IN ('queued','retry','sending') AND (messageId IN (SELECT id FROM messages WHERE expiresAt <= ?) OR subscriptionId NOT IN (SELECT id FROM subscriptions WHERE expiresAt > ?))", now, now, now);
      this.sql.exec("DELETE FROM subscriptions WHERE expiresAt <= ?", now);
      this.sql.exec("DELETE FROM tombstones WHERE expiresAt <= ?", now);
      this.sql.exec("DELETE FROM deliveries WHERE messageId IN (SELECT id FROM messages WHERE createdAt <= ?)", now - RETENTION_MS);
      this.sql.exec("DELETE FROM messages WHERE createdAt <= ?", now - RETENTION_MS);
      this.sql.exec("DELETE FROM rate_limits WHERE expiresAt <= ?", now);
    });
  }
  claim(now, limit = 8) {
    this.cleanup(now);
    return this.storage.transactionSync(() => {
      // A crashed process may have submitted a provider request before persistence.
      // A lease recovery can repeat that request; the stable topic/tag limits duplicates.
      this.sql.exec("UPDATE deliveries SET state = 'retry', leaseId = '', leaseUntil = 0, nextAttemptAt = ?, lastError = 'network_error', updatedAt = ? WHERE state = 'sending' AND leaseUntil <= ?", now, now, now);
      const due = this.rows("SELECT * FROM deliveries WHERE state IN ('queued','retry') AND nextAttemptAt <= ? ORDER BY nextAttemptAt, messageId, subscriptionId LIMIT ?", now, limit);
      const claimed = [];
      for (const row of due) {
        if (row.attempts >= MAX_ATTEMPTS) {
          this.sql.exec("UPDATE deliveries SET state = 'failed', updatedAt = ? WHERE messageId = ? AND subscriptionId = ?", now, row.messageId, row.subscriptionId);
          continue;
        }
        const leaseId = crypto.randomUUID();
        this.sql.exec("UPDATE deliveries SET state = 'sending', attempts = attempts + 1, leaseId = ?, leaseUntil = ?, updatedAt = ? WHERE messageId = ? AND subscriptionId = ?", leaseId, now + 60000, now, row.messageId, row.subscriptionId);
        claimed.push({ ...row, leaseId, attempts: row.attempts + 1, subscription: this.one("SELECT * FROM subscriptions WHERE id = ?", row.subscriptionId), message: this.one("SELECT * FROM messages WHERE id = ?", row.messageId) });
      }
      return claimed;
    });
  }
  finish(delivery, result, now) {
    this.storage.transactionSync(() => {
      const row = this.one("SELECT state,leaseId FROM deliveries WHERE messageId = ? AND subscriptionId = ?", delivery.messageId, delivery.subscriptionId);
      if (row?.state !== "sending" || row.leaseId !== delivery.leaseId) return;
      if (result.outcome === "gone") {
        const deleted = this.one("DELETE FROM subscriptions WHERE id = ? AND version = ? RETURNING id", delivery.subscriptionId, delivery.subscription.version);
        if (deleted) this.sql.exec("UPDATE deliveries SET state = 'cancelled', leaseId = '', leaseUntil = 0, updatedAt = ? WHERE subscriptionId = ? AND state IN ('queued','retry','sending')", now, delivery.subscriptionId);
        else this.sql.exec("UPDATE deliveries SET state = 'cancelled', leaseId = '', leaseUntil = 0, updatedAt = ? WHERE messageId = ? AND subscriptionId = ? AND leaseId = ?", now, delivery.messageId, delivery.subscriptionId, delivery.leaseId);
        return;
      }
      let state = result.outcome === "accepted" ? "accepted" : "failed";
      const delay = Math.max(Math.min(result.retryAfterMs || 0, 3600000), Math.min(30000 * 2 ** Math.max(delivery.attempts - 1, 0), 3600000));
      const next = now + delay;
      if (result.outcome === "retry") state = next >= delivery.message.expiresAt ? "expired" : delivery.attempts >= MAX_ATTEMPTS ? "failed" : "retry";
      this.sql.exec("UPDATE deliveries SET state = ?, lastError = ?, nextAttemptAt = ?, leaseId = '', leaseUntil = 0, updatedAt = ? WHERE messageId = ? AND subscriptionId = ? AND leaseId = ?", state, result.code || "", next, now, delivery.messageId, delivery.subscriptionId, delivery.leaseId);
    });
  }
  nextAlarm(now, includeDeliveries = true) {
    const due = includeDeliveries ? this.one("SELECT MIN(CASE WHEN state = 'sending' THEN leaseUntil ELSE nextAttemptAt END) AS due FROM deliveries WHERE state IN ('queued','retry','sending')")?.due : null;
    const expiries = [
      this.one("SELECT MIN(expiresAt) AS due FROM subscriptions")?.due,
      this.one("SELECT MIN(expiresAt) AS due FROM tombstones")?.due,
      this.one("SELECT MIN(expiresAt) AS due FROM rate_limits")?.due,
      this.one("SELECT MIN(expiresAt) AS due FROM messages WHERE expiresAt > ?", now)?.due,
      this.one("SELECT MIN(createdAt + ?) AS due FROM messages", RETENTION_MS)?.due
    ].filter((value) => value != null);
    // Expiry maintenance remains available even if signing credentials are removed.
    return Math.max(now + 1000, Math.min(due ?? Infinity, ...expiries, now + (includeDeliveries ? 86400000 : 3600000)));
  }
}
