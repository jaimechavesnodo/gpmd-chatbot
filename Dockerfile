FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN rm -f .env

EXPOSE 80

ENV PORT=80

CMD ["node", "src/app.js"]
