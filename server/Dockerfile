FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
ENV NODE_ENV=production DATA_DIR=/app/data
VOLUME /app/data
EXPOSE 3000
CMD ["node", "src/index.js"]
