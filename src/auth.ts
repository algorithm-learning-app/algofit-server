import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 동기화 토큰 = HMAC-SHA256(secret, guestId) 의 hex.
 * guestId 만으로 서명하므로 만료가 없고, 클라이언트가 secret 을 알아야 발급 가능하다.
 * (게스트 진행은 민감 데이터가 아니므로 이 수준의 소유 증명으로 충분 — 무작위 guestId 덮어쓰기 방지가 목적)
 */
export function signGuestId(secret: string, guestId: string): string {
  return createHmac('sha256', secret).update(guestId).digest('hex');
}

/** 주어진 토큰이 guestId 에 대한 유효한 서명인지 상수시간 비교로 검증한다. */
export function verifyToken(
  secret: string,
  guestId: string,
  token: string,
): boolean {
  if (!token) return false;
  const expected = Buffer.from(signGuestId(secret, guestId));
  let provided: Buffer;
  try {
    provided = Buffer.from(token);
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/** `Authorization: Bearer <token>` 헤더에서 토큰만 추출. 없으면 빈 문자열. */
export function extractBearer(header: string | undefined): string {
  if (!header) return '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? '';
}
