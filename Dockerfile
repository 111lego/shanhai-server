FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    TRUST_PROXY=1
COPY package.json ./
# only runtime dependency; the static game itself has none
RUN npm install --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/local.mjs"]
