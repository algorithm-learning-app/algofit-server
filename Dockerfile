# algofit-server 자체호스팅용 이미지 (멀티스테이지)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# better-sqlite3 네이티브 빌드를 위해 빌드 도구 필요
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci \
  && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci --omit=dev \
  && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist ./dist
# 영속 데이터 볼륨 (SQLite). node 유저가 쓸 수 있도록 소유권 부여 후 비루트로 전환.
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
ENV DB_PATH=/app/data/progress.db
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
