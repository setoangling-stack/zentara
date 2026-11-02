FROM node:22-bullseye-slim

WORKDIR /app

# Salin package dan install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Salin seluruh berkas aplikasi
COPY . .

# Hugging Face Spaces mewajibkan port 7860
ENV PORT=7860
EXPOSE 7860

CMD ["node", "server.js"]
