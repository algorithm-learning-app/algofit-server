import { describe, expect, it } from 'vitest';

import { extractBearer, signGuestId, verifyToken } from '../src/auth.js';

const SECRET = 'test-secret';

describe('auth', () => {
  it('같은 guestId+secret 은 같은 서명을 만든다(결정적)', () => {
    expect(signGuestId(SECRET, 'g1')).toBe(signGuestId(SECRET, 'g1'));
  });

  it('guestId 가 다르면 서명이 다르다', () => {
    expect(signGuestId(SECRET, 'g1')).not.toBe(signGuestId(SECRET, 'g2'));
  });

  it('secret 이 다르면 서명이 다르다', () => {
    expect(signGuestId('a', 'g1')).not.toBe(signGuestId('b', 'g1'));
  });

  it('verifyToken 은 올바른 토큰을 통과시킨다', () => {
    const token = signGuestId(SECRET, 'g1');
    expect(verifyToken(SECRET, 'g1', token)).toBe(true);
  });

  it('verifyToken 은 잘못된 토큰/guestId/secret 을 거부한다', () => {
    const token = signGuestId(SECRET, 'g1');
    expect(verifyToken(SECRET, 'g2', token)).toBe(false);
    expect(verifyToken('other', 'g1', token)).toBe(false);
    expect(verifyToken(SECRET, 'g1', 'deadbeef')).toBe(false);
    expect(verifyToken(SECRET, 'g1', '')).toBe(false);
  });

  it('verifyToken 은 비정상 형태의 토큰을 거부한다', () => {
    const valid = signGuestId(SECRET, 'g1');
    // 길이가 다른 비-hex 토큰
    expect(verifyToken(SECRET, 'g1', 'not-a-hex-token')).toBe(false);
    // 유효 서명과 같은 길이지만 값이 다른 토큰 (timingSafeEqual 경로까지 도달)
    const sameLenWrong = 'f'.repeat(valid.length);
    expect(sameLenWrong.length).toBe(valid.length);
    expect(sameLenWrong).not.toBe(valid);
    expect(verifyToken(SECRET, 'g1', sameLenWrong)).toBe(false);
  });

  it('extractBearer 는 Bearer 토큰만 뽑는다', () => {
    expect(extractBearer('Bearer abc')).toBe('abc');
    expect(extractBearer('bearer abc')).toBe('abc');
    expect(extractBearer('  Bearer   abc  ')).toBe('abc');
    expect(extractBearer('Basic abc')).toBe('');
    expect(extractBearer(undefined)).toBe('');
    expect(extractBearer('')).toBe('');
  });
});
