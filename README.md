# algofit-server

Algofit 게스트 진행(Guest Progress) 동기화 백엔드. **자체호스팅** 전제로 만든 가벼운 서비스다.

- **스택**: Node + TypeScript + [Hono](https://hono.dev) + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **역할**: `guestId` 별 진행 JSON 1건을 저장/조회. 서버는 진행 내용을 불투명(opaque)하게 취급하고, **last-write-wins(`updatedAt`)** 로만 갱신을 판단한다.
- **인증**: `Authorization: Bearer <token>`, `token = HMAC-SHA256(SYNC_SECRET, guestId)` (hex). 모바일 앱과 같은 `SYNC_SECRET` 을 공유한다.

> 게스트 진행은 민감 데이터가 아니므로, "무작위 guestId 덮어쓰기 방지" 수준의 소유 증명만 한다. 로그인/개인정보가 붙으면 별도 인증을 얹어야 한다.

## API

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/health` | 헬스체크 → `{ "status": "ok" }` |
| `GET` | `/v1/progress/:guestId` | 저장된 진행 조회. 없으면 `404`. |
| `PUT` | `/v1/progress/:guestId` | 진행 업서트. 본문 `{ "updatedAt": <epoch ms>, "data": { ... } }`. |

PUT 응답:

- `200` 저장됨 → `{ guestId, updatedAt, data }`
- `409` 서버에 더 최신본 존재 → `{ "error": "stale", "current": { ... } }` (클라이언트가 `current` 를 채택)
- `400` 잘못된 본문 / `401` 인증 실패 / `413` 본문 과대

## 로컬 실행

```bash
npm install
cp .env.example .env      # SYNC_SECRET 을 긴 임의 문자열로 바꾼다
npm run dev               # tsx watch
# 또는
npm run build && npm start
```

테스트 / 타입체크:

```bash
npm test
npm run typecheck
```

빠른 확인:

```bash
GUEST=guest-123
SECRET=change-me-to-a-long-random-string
TOKEN=$(node -e "console.log(require('crypto').createHmac('sha256',process.argv[1]).update(process.argv[2]).digest('hex'))" "$SECRET" "$GUEST")
curl -s localhost:8787/health
curl -s -X PUT localhost:8787/v1/progress/$GUEST \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"updatedAt":1, "data":{"xp":42}}'
curl -s localhost:8787/v1/progress/$GUEST -H "Authorization: Bearer $TOKEN"
```

## 환경변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `SYNC_SECRET` | (필수) | 토큰 서명 시크릿. 모바일 `--dart-define=SYNC_SECRET` 과 동일해야 함. `openssl rand -hex 32` 권장. |
| `PORT` | `8787` | 리슨 포트 |
| `HOST` | `0.0.0.0` | 리슨 호스트 |
| `DB_PATH` | `./data/progress.db` | SQLite 파일 경로. 영속 디스크에 둘 것. |

`HANDOFF_SECRET` 도 `SYNC_SECRET` 대체로 인식한다(둘 다 있으면 `SYNC_SECRET` 우선).

## 배포 (자체호스팅)

### systemd (VPS에 직접)

```bash
npm ci && npm run build
sudo useradd -r -s /usr/sbin/nologin algofit || true
sudo mkdir -p /opt/algofit-server && sudo cp -r dist package.json node_modules /opt/algofit-server/
sudo mkdir -p /var/lib/algofit-server && sudo chown algofit /var/lib/algofit-server
```

`/etc/systemd/system/algofit-server.service`:

```ini
[Unit]
Description=algofit-server
After=network.target

[Service]
User=algofit
WorkingDirectory=/opt/algofit-server
Environment=SYNC_SECRET=<openssl rand -hex 32 결과>
Environment=DB_PATH=/var/lib/algofit-server/progress.db
Environment=PORT=8787
ExecStart=/usr/bin/node dist/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now algofit-server
```

리버스 프록시(Nginx/Caddy)로 HTTPS 를 종단하고 `:8787` 로 프록시한다. 모바일에는 그 HTTPS 도메인을 `--dart-define=SYNC_BASE_URL=https://...` 로 넣는다.

### Docker

```bash
docker build -t algofit-server .
docker run -d --name algofit-server \
  -p 8787:8787 \
  -e SYNC_SECRET=$(openssl rand -hex 32) \
  -v algofit-data:/app/data \
  algofit-server
```

## 백업

SQLite 파일(`DB_PATH`) 하나만 백업하면 된다. WAL 모드이므로 `progress.db`, `progress.db-wal`, `progress.db-shm` 를 함께 복사하거나, `sqlite3 progress.db ".backup backup.db"` 사용.

## 이식성

스토리지는 `src/storage/types.ts` 의 `ProgressStore` 인터페이스로 추상화돼 있다. Hono 앱(`src/app.ts`)은 런타임 비의존이라, 나중에 Cloudflare Workers + D1 로 옮길 경우 `ProgressStore` 구현만 추가하면 된다.
