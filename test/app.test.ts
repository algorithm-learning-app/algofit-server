import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { signGuestId } from '../src/auth.js';
import { createSqliteStore } from '../src/storage/sqlite.js';
import type { ProgressStore } from '../src/storage/types.js';

const SECRET = 'test-secret';
const GUEST = 'guest-123';
const TOKEN = signGuestId(SECRET, GUEST);

function authHeaders(token = TOKEN): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

describe('algofit-server app', () => {
  let store: ProgressStore;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    store = createSqliteStore(':memory:');
    app = createApp({ store, secret: SECRET });
  });

  afterEach(() => {
    store.close();
  });

  it('GET /health 는 ok 를 반환한다', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('토큰 없이 접근하면 401', async () => {
    const res = await app.request(`/v1/progress/${GUEST}`);
    expect(res.status).toBe(401);
  });

  it('다른 guestId 의 토큰으로는 401 (소유 증명 실패)', async () => {
    const wrong = signGuestId(SECRET, 'someone-else');
    const res = await app.request(`/v1/progress/${GUEST}`, {
      headers: authHeaders(wrong),
    });
    expect(res.status).toBe(401);
  });

  it('저장된 진행이 없으면 GET 404', async () => {
    const res = await app.request(`/v1/progress/${GUEST}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it('PUT 후 GET 으로 같은 진행을 돌려받는다', async () => {
    const put = await app.request(`/v1/progress/${GUEST}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ updatedAt: 1000, data: { xp: 42, level: 2 } }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({
      guestId: GUEST,
      updatedAt: 1000,
      data: { xp: 42, level: 2 },
    });

    const get = await app.request(`/v1/progress/${GUEST}`, {
      headers: authHeaders(),
    });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({
      guestId: GUEST,
      updatedAt: 1000,
      data: { xp: 42, level: 2 },
    });
  });

  it('더 최신 updatedAt 이면 덮어쓴다', async () => {
    await app.request(`/v1/progress/${GUEST}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ updatedAt: 1000, data: { xp: 1 } }),
    });
    const res = await app.request(`/v1/progress/${GUEST}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ updatedAt: 2000, data: { xp: 2 } }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ xp: 2 });
  });

  it('같은 updatedAt 은 멱등하게 덮어쓴다(LWW, > 비교)', async () => {
    await app.request(`/v1/progress/${GUEST}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ updatedAt: 1000, data: { xp: 1 } }),
    });
    const res = await app.request(`/v1/progress/${GUEST}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ updatedAt: 1000, data: { xp: 9 } }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ xp: 9 });
  });

  it('더 오래된 updatedAt 으로 PUT 하면 409 + 현재본 반환', async () => {
    await app.request(`/v1/progress/${GUEST}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ updatedAt: 2000, data: { xp: 2 } }),
    });
    const res = await app.request(`/v1/progress/${GUEST}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ updatedAt: 1000, data: { xp: 1 } }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.current).toEqual({
      guestId: GUEST,
      updatedAt: 2000,
      data: { xp: 2 },
    });
  });

  it('updatedAt 누락/0/음수면 400', async () => {
    for (const updatedAt of [undefined, 0, -5, 'x']) {
      const res = await app.request(`/v1/progress/${GUEST}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ updatedAt, data: { xp: 1 } }),
      });
      expect(res.status).toBe(400);
    }
  });

  it('data 가 객체가 아니면 400', async () => {
    for (const data of [undefined, null, 'str', 42, [1, 2]]) {
      const res = await app.request(`/v1/progress/${GUEST}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ updatedAt: 1000, data }),
      });
      expect(res.status).toBe(400);
    }
  });

  it('깨진 JSON 본문이면 400', async () => {
    const res = await app.request(`/v1/progress/${GUEST}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('형식이 잘못된 guestId 는 400 (토큰 검증 전 거부)', async () => {
    const badId = 'has space/and..slash';
    const res = await app.request(`/v1/progress/${encodeURIComponent(badId)}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });

  describe('본문 크기 제한(maxBodyBytes)', () => {
    let smallStore: ProgressStore;
    let smallApp: ReturnType<typeof createApp>;

    beforeEach(() => {
      smallStore = createSqliteStore(':memory:');
      smallApp = createApp({ store: smallStore, secret: SECRET, maxBodyBytes: 50 });
    });

    afterEach(() => {
      smallStore.close();
    });

    it('본문이 상한을 넘으면 413 (실제 바이트 기준)', async () => {
      // app.request 가 실제 Content-Length 를 설정하므로 사전 거부 경로도 함께 검증된다.
      const big = JSON.stringify({ updatedAt: 1000, data: { blob: 'x'.repeat(200) } });
      expect(big.length).toBeGreaterThan(50);
      const res = await smallApp.request(`/v1/progress/${GUEST}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: big,
      });
      expect(res.status).toBe(413);
    });

    it('상한 이하 본문은 통과한다(200)', async () => {
      const small = JSON.stringify({ updatedAt: 1000, data: {} });
      expect(small.length).toBeLessThanOrEqual(50);
      const res = await smallApp.request(`/v1/progress/${GUEST}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: small,
      });
      expect(res.status).toBe(200);
    });
  });

  it('순차 PUT LWW: 최신 updatedAt 이 이기고 더 오래된 것은 409 로 거부된다', async () => {
    // t=1000 저장
    const r1 = await app.request(`/v1/progress/${GUEST}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ updatedAt: 1000, data: { v: 1 } }),
    });
    expect(r1.status).toBe(200);

    // t=3000 (더 최신) → 채택
    const r2 = await app.request(`/v1/progress/${GUEST}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ updatedAt: 3000, data: { v: 3 } }),
    });
    expect(r2.status).toBe(200);

    // t=2000 (현재본보다 오래됨) → 409, 현재본은 t=3000 그대로
    const r3 = await app.request(`/v1/progress/${GUEST}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ updatedAt: 2000, data: { v: 2 } }),
    });
    expect(r3.status).toBe(409);

    const get = await app.request(`/v1/progress/${GUEST}`, {
      headers: authHeaders(),
    });
    expect(await get.json()).toEqual({
      guestId: GUEST,
      updatedAt: 3000,
      data: { v: 3 },
    });
  });
});
