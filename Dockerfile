FROM node:20-alpine

WORKDIR /app

# Install build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Create volume mount points
RUN mkdir -p /app/characters /app/data/images

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server.js"]
