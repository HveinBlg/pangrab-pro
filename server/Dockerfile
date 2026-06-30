# PanGrab Pro 后端镜像
FROM node:20-slim
WORKDIR /app

# 仅复制依赖清单先装依赖（better-sqlite3 通常有预编译包，无需额外构建工具；
# 如遇编译失败，把基础镜像换成 node:20 并安装 build-essential python3）
COPY package.json ./
RUN npm install --omit=dev

# 复制源码
COPY . ./

ENV PORT=8787
ENV DB_PATH=/app/data/data.db
EXPOSE 8787

# 数据目录（用 -v 挂载持久化）
RUN mkdir -p /app/data
CMD ["node", "src/index.js"]
