// ============================================
// SQL PERSISTENCE LAYER
// PostgreSQL (production / Render) with an in-memory fallback for local dev.
// All queries are parameterized — protection against SQL injection.
// ============================================

const DATABASE_URL = process.env.DATABASE_URL;

// Retention (how long rows live in the DB before cleanup)
const MESSAGE_RETENTION_MS =
    parseInt(process.env.MESSAGE_RETENTION_DAYS || '30', 10) * 24 * 60 * 60 * 1000;
const WHISPER_RETENTION_MS =
    parseInt(process.env.WHISPER_RETENTION_HOURS || '24', 10) * 60 * 60 * 1000;

// ============ POSTGRESQL BACKEND ============

function createPostgresBackend(connectionString) {
    const { Pool } = require('pg');

    // Render requires SSL for Postgres; local connections do not.
    const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

    const pool = new Pool({
        connectionString,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
    });

    // Don't let a transient pool error crash the whole process.
    pool.on('error', () => {});

    return {
        kind: 'postgres',

        async init() {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS messages (
                    id          TEXT PRIMARY KEY,
                    player      TEXT NOT NULL,
                    msg         TEXT NOT NULL,
                    role        JSONB,
                    type        TEXT NOT NULL DEFAULT 'message',
                    encrypted   BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at  BIGINT NOT NULL
                );
            `);
            await pool.query(
                `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);`
            );

            await pool.query(`
                CREATE TABLE IF NOT EXISTS whispers (
                    id          TEXT PRIMARY KEY,
                    sender      TEXT NOT NULL,
                    target      TEXT NOT NULL,
                    msg         TEXT NOT NULL,
                    encrypted   BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at  BIGINT NOT NULL
                );
            `);
            await pool.query(
                `CREATE INDEX IF NOT EXISTS idx_whispers_sender ON whispers (sender);`
            );
            await pool.query(
                `CREATE INDEX IF NOT EXISTS idx_whispers_target ON whispers (target);`
            );

            await pool.query(`
                CREATE TABLE IF NOT EXISTS bans (
                    username    TEXT PRIMARY KEY,
                    reason      TEXT,
                    banned_by   TEXT,
                    created_at  BIGINT NOT NULL
                );
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS mutes (
                    username    TEXT PRIMARY KEY,
                    unmute_at   BIGINT NOT NULL,
                    muted_by    TEXT,
                    created_at  BIGINT NOT NULL
                );
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS ip_bans (
                    ip_hash     TEXT PRIMARY KEY,
                    username    TEXT,
                    created_at  BIGINT NOT NULL
                );
            `);
        },

        // ---- messages ----
        async saveMessage(m) {
            await pool.query(
                `INSERT INTO messages (id, player, msg, role, type, encrypted, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    m.id,
                    m.player,
                    m.msg,
                    m.role ? JSON.stringify(m.role) : null,
                    m.type || 'message',
                    !!m.encrypted,
                    m.timestamp,
                ]
            );
        },

        async getRecentMessages(limit) {
            const { rows } = await pool.query(
                `SELECT id, player, msg, role, type, encrypted, created_at
                 FROM messages
                 ORDER BY created_at DESC
                 LIMIT $1`,
                [limit]
            );
            return rows.reverse().map((r) => ({
                id: r.id,
                player: r.player,
                msg: r.msg,
                role: r.role,
                type: r.type,
                encrypted: r.encrypted,
                timestamp: Number(r.created_at),
            }));
        },

        async clearMessages() {
            await pool.query(`DELETE FROM messages`);
        },

        // ---- whispers ----
        async saveWhisper(w) {
            await pool.query(
                `INSERT INTO whispers (id, sender, target, msg, encrypted, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [w.id, w.sender, w.target, w.msg, !!w.encrypted, w.timestamp]
            );
        },

        async getWhispersFor(username) {
            const lower = username.toLowerCase();
            const { rows } = await pool.query(
                `SELECT id, sender, target, msg, encrypted, created_at
                 FROM whispers
                 WHERE LOWER(sender) = $1 OR LOWER(target) = $1
                 ORDER BY created_at ASC`,
                [lower]
            );
            return rows.map((r) => ({
                id: r.id,
                sender: r.sender,
                target: r.target,
                msg: r.msg,
                encrypted: r.encrypted,
                timestamp: Number(r.created_at),
            }));
        },

        // ---- bans (user blocks) ----
        async addBan(username, reason, bannedBy) {
            await pool.query(
                `INSERT INTO bans (username, reason, banned_by, created_at)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (username) DO UPDATE
                   SET reason = EXCLUDED.reason,
                       banned_by = EXCLUDED.banned_by,
                       created_at = EXCLUDED.created_at`,
                [username.toLowerCase(), reason || null, bannedBy || null, Date.now()]
            );
        },

        async removeBan(username) {
            await pool.query(`DELETE FROM bans WHERE username = $1`, [
                username.toLowerCase(),
            ]);
        },

        async isBanned(username) {
            const { rowCount } = await pool.query(
                `SELECT 1 FROM bans WHERE username = $1`,
                [username.toLowerCase()]
            );
            return rowCount > 0;
        },

        async listBans() {
            const { rows } = await pool.query(
                `SELECT username, reason, banned_by, created_at FROM bans ORDER BY created_at DESC`
            );
            return rows.map((r) => ({
                username: r.username,
                reason: r.reason,
                bannedBy: r.banned_by,
                timestamp: Number(r.created_at),
            }));
        },

        // ---- ip bans ----
        async addIpBan(ipHash, username) {
            await pool.query(
                `INSERT INTO ip_bans (ip_hash, username, created_at)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (ip_hash) DO UPDATE SET username = EXCLUDED.username`,
                [ipHash, username ? username.toLowerCase() : null, Date.now()]
            );
        },

        // remove all IP bans tied to a username, return the freed ip hashes
        async removeIpBansForUser(username) {
            const { rows } = await pool.query(
                `DELETE FROM ip_bans WHERE username = $1 RETURNING ip_hash`,
                [username.toLowerCase()]
            );
            return rows.map((r) => r.ip_hash);
        },

        async listIpBans() {
            const { rows } = await pool.query(`SELECT ip_hash FROM ip_bans`);
            return rows.map((r) => r.ip_hash);
        },

        // ---- mutes ----
        async addMute(username, unmuteAt, mutedBy) {
            await pool.query(
                `INSERT INTO mutes (username, unmute_at, muted_by, created_at)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (username) DO UPDATE
                   SET unmute_at = EXCLUDED.unmute_at,
                       muted_by = EXCLUDED.muted_by,
                       created_at = EXCLUDED.created_at`,
                [username.toLowerCase(), unmuteAt, mutedBy || null, Date.now()]
            );
        },

        async removeMute(username) {
            await pool.query(`DELETE FROM mutes WHERE username = $1`, [
                username.toLowerCase(),
            ]);
        },

        // returns remaining unmute timestamp (ms) or null
        async getMuteUntil(username) {
            const { rows } = await pool.query(
                `SELECT unmute_at FROM mutes WHERE username = $1`,
                [username.toLowerCase()]
            );
            if (rows.length === 0) return null;
            const until = Number(rows[0].unmute_at);
            if (Date.now() > until) {
                await this.removeMute(username);
                return null;
            }
            return until;
        },

        // ---- maintenance ----
        async cleanupExpired() {
            const now = Date.now();
            await pool.query(`DELETE FROM messages WHERE created_at < $1`, [
                now - MESSAGE_RETENTION_MS,
            ]);
            await pool.query(`DELETE FROM whispers WHERE created_at < $1`, [
                now - WHISPER_RETENTION_MS,
            ]);
            await pool.query(`DELETE FROM mutes WHERE unmute_at < $1`, [now]);
        },

        async stats() {
            const q = async (sql) => Number((await pool.query(sql)).rows[0].c);
            return {
                messages: await q(`SELECT COUNT(*)::int AS c FROM messages`),
                whispers: await q(`SELECT COUNT(*)::int AS c FROM whispers`),
                banned: await q(`SELECT COUNT(*)::int AS c FROM bans`),
                muted: await q(`SELECT COUNT(*)::int AS c FROM mutes`),
            };
        },

        async close() {
            await pool.end();
        },
    };
}

// ============ IN-MEMORY BACKEND (local dev fallback) ============

function createMemoryBackend() {
    let messages = [];
    let whispers = [];
    const bans = new Map(); // username -> {reason, bannedBy, timestamp}
    const mutes = new Map(); // username -> {unmuteAt, mutedBy, timestamp}
    const ipBans = new Map(); // ip_hash -> username

    return {
        kind: 'memory',

        async init() {},

        async saveMessage(m) {
            messages.push({ ...m });
        },
        async getRecentMessages(limit) {
            return messages.slice(-limit).map((m) => ({ ...m }));
        },
        async clearMessages() {
            messages = [];
        },

        async saveWhisper(w) {
            whispers.push({ ...w });
        },
        async getWhispersFor(username) {
            const lower = username.toLowerCase();
            return whispers
                .filter(
                    (w) =>
                        w.sender.toLowerCase() === lower ||
                        w.target.toLowerCase() === lower
                )
                .map((w) => ({ ...w }));
        },

        async addBan(username, reason, bannedBy) {
            bans.set(username.toLowerCase(), {
                reason,
                bannedBy,
                timestamp: Date.now(),
            });
        },
        async removeBan(username) {
            bans.delete(username.toLowerCase());
        },
        async isBanned(username) {
            return bans.has(username.toLowerCase());
        },
        async listBans() {
            return [...bans.entries()].map(([username, v]) => ({
                username,
                reason: v.reason,
                bannedBy: v.bannedBy,
                timestamp: v.timestamp,
            }));
        },

        async addIpBan(ipHash, username) {
            ipBans.set(ipHash, username ? username.toLowerCase() : null);
        },
        async removeIpBansForUser(username) {
            const lower = username.toLowerCase();
            const freed = [];
            for (const [hash, user] of ipBans.entries()) {
                if (user === lower) { freed.push(hash); ipBans.delete(hash); }
            }
            return freed;
        },
        async listIpBans() {
            return [...ipBans.keys()];
        },

        async addMute(username, unmuteAt, mutedBy) {
            mutes.set(username.toLowerCase(), {
                unmuteAt,
                mutedBy,
                timestamp: Date.now(),
            });
        },
        async removeMute(username) {
            mutes.delete(username.toLowerCase());
        },
        async getMuteUntil(username) {
            const entry = mutes.get(username.toLowerCase());
            if (!entry) return null;
            if (Date.now() > entry.unmuteAt) {
                mutes.delete(username.toLowerCase());
                return null;
            }
            return entry.unmuteAt;
        },

        async cleanupExpired() {
            const now = Date.now();
            messages = messages.filter(
                (m) => now - m.timestamp < MESSAGE_RETENTION_MS
            );
            whispers = whispers.filter(
                (w) => now - w.timestamp < WHISPER_RETENTION_MS
            );
            for (const [user, entry] of mutes.entries()) {
                if (now > entry.unmuteAt) mutes.delete(user);
            }
        },

        async stats() {
            return {
                messages: messages.length,
                whispers: whispers.length,
                banned: bans.size,
                muted: mutes.size,
            };
        },

        async close() {},
    };
}

// ============ SELECT BACKEND ============

let backend;

if (DATABASE_URL) {
    backend = createPostgresBackend(DATABASE_URL);
} else {
    console.warn(
        '⚠️  DATABASE_URL is not set — falling back to IN-MEMORY storage.\n' +
            '    Data will NOT persist across restarts. Set DATABASE_URL (PostgreSQL) for production.'
    );
    backend = createMemoryBackend();
}

module.exports = backend;
