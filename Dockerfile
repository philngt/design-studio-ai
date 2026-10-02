FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG PUBLIC_SITE_URL=https://studio.agentkit.best
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
ENV HOST=0.0.0.0 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/shared ./src/shared
COPY --from=build /app/server ./server
COPY --from=build /app/migrations ./migrations
RUN npx playwright install --with-deps chromium
ARG CODING_AGENT_PACKAGES=""
RUN if [ -n "$CODING_AGENT_PACKAGES" ]; then npm install --global $CODING_AGENT_PACKAGES; fi
ENV HOME=/home/node XDG_CONFIG_HOME=/home/node/.config
RUN mkdir -p /data /home/node/.config && chown -R node:node /data /app /home/node
USER node
VOLUME ["/data", "/home/node"]
EXPOSE 8787
CMD ["node", "--import", "tsx", "server/node.ts"]
