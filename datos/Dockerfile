# =====================================================================
# CETIA - Capa de datos
# =====================================================================
FROM node:22-alpine

WORKDIR /app

# Las dependencias primero, aparte del codigo: asi Docker no vuelve a
# instalarlas cada vez que cambia una linea de la aplicacion.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund

COPY src ./src

EXPOSE 4000
CMD ["node", "src/servidor.js"]
