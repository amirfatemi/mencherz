FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV PORT=3000 DB_PATH=/data/mencherz.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p /data && chown node:node /data
COPY shared ./shared
COPY server ./server
COPY --from=build /app/dist ./dist
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.ts"]
