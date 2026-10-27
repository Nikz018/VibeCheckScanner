# Production image for the Next.js app. linux/amd64 and linux/arm64.
# node:22-bookworm publishes both architectures. Do not pin a CPU here.
# The VM builds for its own CPU.
# PDF downloads launch Chromium in this process. Playwright's own browser
# build is installed for the image architecture. Do not install the Debian
# chromium package. It is a different build and breaks on arm64.

FROM node:22-bookworm AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx playwright install --with-deps chromium

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}
RUN NODE_OPTIONS=--max-old-space-size=1536 npx next build

FROM deps AS runner
ENV NODE_ENV=production \
    HOME=/home/vibecheck \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY --from=build /app /app
RUN useradd --create-home --uid 1001 --shell /usr/sbin/nologin vibecheck \
    && mkdir -p /home/vibecheck/.npm \
    && chown -R vibecheck:vibecheck /app /home/vibecheck /ms-playwright
USER vibecheck
EXPOSE 3000
CMD ["sh", "scripts/web-entrypoint.sh"]
