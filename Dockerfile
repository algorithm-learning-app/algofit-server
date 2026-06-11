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
# 영속 데이터 볼륨
VOLUME ["/app/data"]
ENV DB_PATH=/app/data/progress.db
EXPOSE 8787
CMD ["node", "dist/index.js"]
