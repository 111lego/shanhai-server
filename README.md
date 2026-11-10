# 山海五侠 · 大荒行纪 —— 在线版（Render / Docker）

游戏服务器 + 真实账号 + 云存档。前端是同一份构建产物（静态托管时自动回落到本机账号）。

## 存储

- 设置 `DATABASE_URL`（Postgres）→ 用 Postgres，适合 Render 免费套餐（无持久磁盘）
- 未设置 → 用本地 SQLite 文件（`GAME_DATA_DIR`，默认 `runtime/`）

表结构由 `server/pg-store.mjs` 的 `PG_SCHEMA` 在启动时自动创建（等价于 `server/schema.sql`）。

## 本地运行

```bash
DATABASE_URL=postgres://... node server/local.mjs   # Postgres
node server/local.mjs                                # SQLite
```

打开 http://127.0.0.1:4174 ，健康检查 `/healthz`。

## Render

仓库根目录的 `render.yaml` 描述了一个免费 Web Service（Docker）：

- Health Check Path：`/healthz`
- 环境变量：`DATABASE_URL`（在 Render 控制台填，`sync: false` 不入库）
- 免费实例 15 分钟无流量会休眠，冷启动约 30–60 秒

## 账号接口

`POST /api/register`、`POST /api/login`、`POST /api/logout`、`GET /api/me`、`PUT /api/save`
（PBKDF2-SHA256 + 随机盐，`saves.revision` 乐观锁，`rate_limits` 限流）
