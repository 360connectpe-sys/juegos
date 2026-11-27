# BROTHERS ROYALE — servidor multijugador (Colyseus). Imagen multiarquitectura
# (amd64 y arm64: sirve para Render y para Oracle Ampere A1). Ver DEPLOY.md.

# 1) Compilación del servidor (necesita las dependencias de desarrollo: Vite).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.server.config.ts ./
COPY server ./server
COPY src ./src
RUN npm run build:server && npm prune --omit=dev --no-audit --no-fund

# 2) Ejecución: solo dependencias de producción (podadas arriba, sin volver a
#    descargarlas) y el servidor compilado.
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=2567 \
    HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.js"]
