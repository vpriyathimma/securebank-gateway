FROM node:20-alpine

WORKDIR /app

# Deps first so a source-only change doesn't reinstall everything.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# The server serves a PRE-BUILT SPA from dist/public — there is no vite dev
# middleware — so the build must happen at image build time.
RUN npx vite build

# `start` runs the TypeScript source through tsx (which is a runtime dependency,
# not a dev one). The esbuild bundle in the old build script was never used.
ENV NODE_ENV=production
EXPOSE 8400
CMD ["npm", "run", "start"]
