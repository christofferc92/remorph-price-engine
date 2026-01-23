FROM node:20-bullseye-slim AS base
WORKDIR /usr/src/app

COPY package*.json ./
COPY package-lock.json ./
COPY tsconfig.json ./

RUN npm ci

COPY . .

ENV PORT=3000
CMD ["npm", "run", "price-engine:start"]
