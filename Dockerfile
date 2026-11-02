FROM node:22-bullseye-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# PORT diatur oleh platform hosting (Railway, Koyeb, HF Spaces, dll)
# Fallback ke 3000 jika tidak diset oleh environment
EXPOSE 3000

CMD ["node", "server.js"]
