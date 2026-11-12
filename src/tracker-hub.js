import { DurableObject } from 'cloudflare:workers';

class TrackerError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export class TrackerHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    // Semua perubahan antrean melewati satu Durable Object dan satu antrean eksekusi.
    this.mutationTail = Promise.resolve();
  }

  runExclusive(task) {
    const result = this.mutationTail.then(task, task);
    this.mutationTail = result.catch(() => undefined);
    return result;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') return this.connectWebSocket(request);

    if (request.method !== 'POST') return json({ error: 'Method tidak diizinkan.' }, 405);

    return this.runExclusive(async () => {
      try {
        const token = request.headers.get('X-Device-Token') || '';
        if (token.length < 24 || token.length > 128) throw new TrackerError('Identitas perangkat tidak valid.', 400);

        let body = {};
        try { body = await request.json(); } catch { throw new TrackerError('Format permintaan tidak valid.', 400); }

        let result;
        if (url.pathname === '/api/start') result = await this.startOrQueue(body, token);
        else if (url.pathname === '/api/finish') result = await this.finishUsage(token);
        else if (url.pathname === '/api/cancel') result = await this.cancelQueue(body, token);
        else return json({ error: 'Endpoint tidak ditemukan.' }, 404);

        this.broadcast({ type: 'refresh' });
        return json(result);
      } catch (error) {
        const status = error instanceof TrackerError ? error.status : 500;
        return json({ error: error.message || 'Terjadi kesalahan pada server.' }, status);
      }
    });
  }

  async startOrQueue(body, token) {
    const residentId = Number(body.residentId);
    if (!Number.isInteger(residentId) || residentId <= 0) {
      throw new TrackerError('Pilih nama penghuni yang terdaftar.', 400);
    }

    const resident = await this.env.DB.prepare(
      'SELECT resident_id, full_name, room FROM residents WHERE resident_id = ? LIMIT 1'
    ).bind(residentId).first();
    if (!resident) throw new TrackerError('Nama penghuni tidak ditemukan di master data.', 404);

    const activeForDevice = await this.env.DB.prepare(
      'SELECT slot_id, name, room FROM current_usage WHERE device_id = ? LIMIT 1'
    ).bind(token).first();
    if (activeForDevice) return { status: 'active', name: activeForDevice.name, room: activeForDevice.room, alreadyRegistered: true };

    const queuedForDevice = await this.env.DB.prepare(
      'SELECT queue_id, name, room FROM queue WHERE device_id = ? LIMIT 1'
    ).bind(token).first();
    if (queuedForDevice) {
      const position = await this.env.DB.prepare(
        'SELECT COUNT(*) AS position FROM queue WHERE created_at < (SELECT created_at FROM queue WHERE queue_id = ?) OR (created_at = (SELECT created_at FROM queue WHERE queue_id = ?) AND queue_id <= ?)'
      ).bind(queuedForDevice.queue_id, queuedForDevice.queue_id, queuedForDevice.queue_id).first();
      return { status: 'queued', position: position?.position ?? 1, alreadyRegistered: true };
    }

    // Cegah satu penghuni tercatat dua kali dari browser/perangkat berbeda.
    const sameResidentActive = await this.env.DB.prepare(
      'SELECT name FROM current_usage WHERE name = ? AND room = ? LIMIT 1'
    ).bind(resident.full_name, resident.room).first();
    const sameResidentQueued = await this.env.DB.prepare(
      'SELECT name FROM queue WHERE name = ? AND room = ? LIMIT 1'
    ).bind(resident.full_name, resident.room).first();
    if (sameResidentActive || sameResidentQueued) {
      throw new TrackerError('Nama ini sudah terdaftar dari perangkat lain. Gunakan perangkat yang digunakan saat mendaftar untuk mengelola giliran.', 409);
    }

    const active = await this.env.DB.prepare(
      'SELECT slot_id FROM current_usage WHERE slot_id = 1 LIMIT 1'
    ).first();

    if (!active) {
      await this.env.DB.prepare(`
        INSERT INTO current_usage (slot_id, name, room, device_id, started_at, is_from_queue)
        VALUES (1, ?, ?, ?, ?, 0)
      `).bind(resident.full_name, resident.room, token, new Date().toISOString()).run();
      return { status: 'active', name: resident.full_name, room: resident.room };
    }

    await this.env.DB.prepare(`
      INSERT INTO queue (name, room, device_id)
      VALUES (?, ?, ?)
    `).bind(resident.full_name, resident.room, token).run();

    const queued = await this.env.DB.prepare(
      'SELECT queue_id FROM queue WHERE device_id = ? LIMIT 1'
    ).bind(token).first();
    const position = await this.env.DB.prepare(
      'SELECT COUNT(*) AS position FROM queue WHERE created_at < (SELECT created_at FROM queue WHERE queue_id = ?) OR (created_at = (SELECT created_at FROM queue WHERE queue_id = ?) AND queue_id <= ?)'
    ).bind(queued.queue_id, queued.queue_id, queued.queue_id).first();

    return { status: 'queued', position: position?.position ?? 1, name: resident.full_name, room: resident.room };
  }

  async finishUsage(token) {
    const current = await this.env.DB.prepare(`
      SELECT slot_id, name, room, device_id, started_at
      FROM current_usage WHERE slot_id = 1 LIMIT 1
    `).first();

    if (!current) throw new TrackerError('Setrika sedang tidak digunakan.', 409);
    if (current.device_id !== token) throw new TrackerError('Hanya perangkat pemakai aktif yang dapat menyelesaikan penggunaan.', 403);

    const next = await this.env.DB.prepare(`
      SELECT queue_id, name, room, device_id, created_at
      FROM queue ORDER BY created_at ASC, queue_id ASC LIMIT 1
    `).first();

    const endedAt = new Date().toISOString();
    const durationSeconds = Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(current.started_at)) / 1000));
    const statements = [
      this.env.DB.prepare(`
        INSERT INTO usage_history (name, room, device_id, started_at, ended_at, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(current.name, current.room, current.device_id, current.started_at, endedAt, durationSeconds),
      this.env.DB.prepare('DELETE FROM current_usage WHERE slot_id = 1 AND device_id = ?').bind(token),
    ];

    if (next) {
      statements.push(this.env.DB.prepare(`
        INSERT INTO current_usage (slot_id, name, room, device_id, started_at, is_from_queue)
        SELECT 1, name, room, device_id, ?, 1 FROM queue WHERE queue_id = ?
      `).bind(endedAt, next.queue_id));
      statements.push(this.env.DB.prepare('DELETE FROM queue WHERE queue_id = ?').bind(next.queue_id));
    }

    // D1 batch bersifat transaksional; jangan menambahkan BEGIN/COMMIT SQL manual.
    await this.env.DB.batch(statements);

    return {
      status: 'finished',
      nextUser: next ? { name: next.name, room: next.room } : null,
      message: next ? `Giliran diberikan kepada ${next.name}.` : 'Setrika sekarang tersedia.',
    };
  }

  async cancelQueue(body, token) {
    const queueId = Number(body.queueId);
    if (!Number.isInteger(queueId) || queueId <= 0) throw new TrackerError('ID antrean tidak valid.', 400);

    const item = await this.env.DB.prepare(
      'SELECT queue_id, name FROM queue WHERE queue_id = ? AND device_id = ? LIMIT 1'
    ).bind(queueId, token).first();
    if (!item) throw new TrackerError('Antrean tidak ditemukan atau bukan milik perangkat ini.', 404);

    await this.env.DB.prepare('DELETE FROM queue WHERE queue_id = ? AND device_id = ?')
      .bind(queueId, token).run();
    return { status: 'cancelled', message: 'Antrean berhasil dibatalkan.' };
  }

  connectWebSocket(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required.', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connectedAt: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, message) {
    if (message === 'ping') {
      try { socket.send('pong'); } catch { /* koneksi mungkin sudah ditutup */ }
    }
  }

  webSocketClose(socket, code, reason) {
    try { socket.close(code, reason); } catch { /* koneksi sudah ditutup */ }
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(payload); } catch { /* abaikan socket yang sudah tidak aktif */ }
    }
  }
}
