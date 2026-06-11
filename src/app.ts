import { Hono } from 'hono';

import { extractBearer, verifyToken } from './auth.js';
import type { ProgressStore } from './storage/types.js';

export interface AppOptions {
  store: ProgressStore;
  /** 동기화 토큰 서명 시크릿 (모바일 --dart-define=SYNC_SECRET 과 동일). */
  secret: string;
  /** PUT 요청 본문 크기 상한(바이트). 기본 256KB. */
  maxBodyBytes?: number;
}

interface PutBody {
  updatedAt?: unknown;
  data?: unknown;
}

export function createApp(opts: AppOptions): Hono {
  const { store, secret } = opts;
  const maxBodyBytes = opts.maxBodyBytes ?? 256 * 1024;
  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok' }));

  // guestId 경로 파라미터 + Bearer 토큰 검증 미들웨어.
  app.use('/v1/progress/:guestId', async (c, next) => {
    const guestId = c.req.param('guestId');
    if (!guestId) return c.json({ error: 'guestId required' }, 400);
    // guestId 형식 검증: UUID v4(모바일/웹) 및 base64url 핸드오프 토큰만 허용.
    // 토큰 검증 전에 거부해 비정상 입력을 빠르게 걸러낸다.
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(guestId)) {
      return c.json({ error: 'invalid guestId' }, 400);
    }
    const token = extractBearer(c.req.header('Authorization'));
    if (!verifyToken(secret, guestId, token)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });

  app.get('/v1/progress/:guestId', (c) => {
    const guestId = c.req.param('guestId');
    const record = store.get(guestId);
    if (!record) return c.json({ error: 'not found' }, 404);
    return c.json(record);
  });

  app.put('/v1/progress/:guestId', async (c) => {
    const guestId = c.req.param('guestId');

    // Content-Length 헤더는 빠른 사전 거부용(청크/누락/비정상 값으로 우회 가능).
    const contentLength = Number(c.req.header('Content-Length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return c.json({ error: 'payload too large' }, 413);
    }

    // 실제 바이트 수로 본문 크기를 강제한다(헤더 우회 방지).
    const raw = await c.req.text();
    if (Buffer.byteLength(raw) > maxBodyBytes) {
      return c.json({ error: 'payload too large' }, 413);
    }

    let body: PutBody;
    try {
      body = JSON.parse(raw) as PutBody;
    } catch {
      return c.json({ error: 'invalid json' }, 400);
    }

    const updatedAt = Number(body?.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
      return c.json({ error: 'updatedAt (positive epoch ms) required' }, 400);
    }
    if (body?.data == null || typeof body.data !== 'object' || Array.isArray(body.data)) {
      return c.json({ error: 'data (object) required' }, 400);
    }

    const existing = store.get(guestId);
    // Last-write-wins: 서버에 더 최신본이 있으면 거부하고 현재본을 돌려준다(클라이언트가 채택).
    if (existing && existing.updatedAt > updatedAt) {
      return c.json({ error: 'stale', current: existing }, 409);
    }

    const record = {
      guestId,
      updatedAt,
      data: body.data as Record<string, unknown>,
    };
    store.put(record);
    return c.json(record);
  });

  return app;
}
