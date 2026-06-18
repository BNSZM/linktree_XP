FROM node:20-alpine
WORKDIR /app
COPY package.json server.js storage.js ./
ENV NODE_ENV=production
EXPOSE 8787
USER node
CMD ["node", "server.js"]
