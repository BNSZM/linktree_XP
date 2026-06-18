FROM node:20-alpine
WORKDIR /app
COPY package.json server.js storage.js ./
ENV NODE_ENV=production
EXPOSE 8787
RUN mkdir -p /app/data && chmod 777 /app/data
# 使用 root 运行：Docker 挂载卷默认归 root 所有，node 用户无写权限。
# 容器本身已提供进程隔离，root 运行在此场景下安全可接受。
CMD ["node", "server.js"]
