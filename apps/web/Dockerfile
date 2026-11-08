FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/ops/package.json packages/ops/
COPY packages/fonts/package.json packages/fonts/
RUN npm ci
COPY . .
# Optional CJK fallback fonts (see apps/api/Dockerfile); sync-fonts copies them to public/fonts.
ARG CJK_FONTS=1
RUN if [ "$CJK_FONTS" = "1" ]; then node packages/fonts/scripts/fetch-cjk.mjs; fi
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build -w apps/web

FROM node:22-slim
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "apps/web"]
