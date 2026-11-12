-- Setrika Tracker - Cloudflare D1 schema
-- One physical iron: current_usage allows only slot_id = 1.

CREATE TABLE IF NOT EXISTS current_usage (
    slot_id INTEGER PRIMARY KEY CHECK (slot_id = 1),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
    room INTEGER NOT NULL CHECK (room BETWEEN 281 AND 290),
    device_id TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    is_from_queue INTEGER NOT NULL DEFAULT 0 CHECK (is_from_queue IN (0, 1))
);

CREATE TABLE IF NOT EXISTS queue (
    queue_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
    room INTEGER NOT NULL CHECK (room BETWEEN 281 AND 290),
    device_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Prevent the same browser/device from joining the queue more than once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_device_unique
ON queue (device_id);

-- Queue order is oldest registration first; queue_id breaks timestamp ties.
CREATE INDEX IF NOT EXISTS idx_queue_order
ON queue (created_at, queue_id);

CREATE TABLE IF NOT EXISTS usage_history (
    history_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    room INTEGER NOT NULL CHECK (room BETWEEN 281 AND 290),
    device_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS idx_history_ended_at
ON usage_history (ended_at DESC);
