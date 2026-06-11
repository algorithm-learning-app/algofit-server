export interface Config {
  port: number;
  host: string;
  dbPath: string;
  secret: string;
}

/** 환경변수에서 설정을 읽는다. SYNC_SECRET 누락 시 즉시 throw(부팅 실패). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const secret = env.SYNC_SECRET ?? env.HANDOFF_SECRET ?? '';
  if (!secret) {
    throw new Error(
      'SYNC_SECRET 환경변수가 필요합니다. 모바일 --dart-define=SYNC_SECRET 과 같은 값을 설정하세요.',
    );
  }

  const port = Number(env.PORT ?? '8787');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT 가 올바르지 않습니다: ${env.PORT}`);
  }

  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    dbPath: env.DB_PATH ?? './data/progress.db',
    secret,
  };
}
