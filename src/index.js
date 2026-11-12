import { TrackerHub } from './tracker-hub.js';

export { TrackerHub };

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  },
});

function isSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function readSnapshot(db, deviceToken) {
  const [activeResult, queueResult, historyResult, residentsResult] = await Promise.all([
    db.prepare(`
      SELECT slot_id, name, room, started_at, is_from_queue, device_id
      FROM current_usage WHERE slot_id = 1 LIMIT 1
    `).first(),
    db.prepare(`
      SELECT queue_id, name, room, created_at, device_id
      FROM queue ORDER BY created_at ASC, queue_id ASC
    `).all(),
    db.prepare(`
      SELECT history_id, name, room, started_at, ended_at, duration_seconds
      FROM usage_history ORDER BY ended_at DESC, history_id DESC LIMIT 20
    `).all(),
    db.prepare(`
      SELECT resident_id, full_name, room
      FROM residents ORDER BY room ASC, full_name COLLATE NOCASE ASC
    `).all(),
  ]);

  const active = activeResult || null;
  const queueRows = queueResult.results || [];
  const historyRows = historyResult.results || [];
  const residentRows = residentsResult.results || [];

  let myStatus = { status: 'none' };
  if (deviceToken && active?.device_id === deviceToken) {
    myStatus = {
      status: 'active',
      item_id: active.slot_id,
      is_from_queue: Boolean(active.is_from_queue),
      started_at: active.started_at,
      name: active.name,
      room: active.room,
    };
  } else if (deviceToken) {
    const index = queueRows.findIndex((row) => row.device_id === deviceToken);
    if (index >= 0) {
      const row = queueRows[index];
      myStatus = {
        status: 'queued',
        item_id: row.queue_id,
        position: index + 1,
        name: row.name,
        room: row.room,
      };
    }
  }

  return {
    currentUser: active ? {
      name: active.name,
      room: active.room,
      started_at: active.started_at,
      is_from_queue: Boolean(active.is_from_queue),
      isMine: Boolean(deviceToken && active.device_id === deviceToken),
    } : null,
    queue: queueRows.map((row) => ({
      queue_id: row.queue_id,
      name: row.name,
      room: row.room,
      created_at: row.created_at,
      isMine: Boolean(deviceToken && row.device_id === deviceToken),
    })),
    history: historyRows,
    residents: residentRows,
    myStatus,
  };
}

function getHub(env) {
  const id = env.TRACKER_HUB.idFromName('lorong-6-c3-pku-ipb-setrika-tunggal');
  return env.TRACKER_HUB.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/') || path === '/ws') {
      if (!isSameOrigin(request)) return json({ error: 'Origin tidak diizinkan.' }, 403);
    }

    if (path === '/api/health' && request.method === 'GET') {
      try {
        const result = await env.DB.prepare('SELECT COUNT(*) AS total FROM residents').first();
        return json({ ok: true, service: 'setrika-tracker', database: 'connected', residents: result?.total ?? 0 });
      } catch (error) {
        return json({ ok: false, service: 'setrika-tracker', database: 'error', message: error.message }, 500);
      }
    }

    if (path === '/api/state' && request.method === 'GET') {
      try {
        const token = request.headers.get('X-Device-Token') || '';
        const snapshot = await readSnapshot(env.DB, token);
        return json(snapshot);
      } catch (error) {
        return json({ error: 'Gagal membaca database.', detail: error.message }, 500);
      }
    }

    if (path === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('WebSocket upgrade required.', { status: 426 });
      }
      return getHub(env).fetch(request);
    }

    if (['/api/start', '/api/finish', '/api/cancel'].includes(path) && request.method === 'POST') {
      const token = request.headers.get('X-Device-Token') || '';
      if (token.length < 24 || token.length > 128) {
        return json({ error: 'Identitas perangkat tidak valid. Muat ulang website dan coba lagi.' }, 400);
      }
      return getHub(env).fetch(request);
    }

    if (path.startsWith('/api/')) return json({ error: 'Endpoint tidak ditemukan.' }, 404);

    return env.ASSETS.fetch(request);
  },
};
