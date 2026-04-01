# Stage 1: Build the application
FROM public.ecr.aws/docker/library/node:20-slim AS builder

# Set working directory
WORKDIR /app

# Copy package.json only (not package-lock.json to force fresh install)
COPY package.json ./

# Install ALL dependencies fresh to get platform-specific binaries
# This generates a new package-lock.json for Linux
RUN npm install --include=dev

# Copy source files
COPY . .

# Build the application with production optimizations
# NODE_ENV=production enables dead code elimination in esbuild
RUN NODE_ENV=production npm run build

# Verify no vite imports in production build
RUN ! grep -q "from \"vite\"" dist/index.js || (echo "ERROR: vite import found in production build!" && exit 1)

# Stage 2: Production image
FROM public.ecr.aws/docker/library/node:20-slim AS production

# Set working directory
WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Create non-root user for security
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs nodejs

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev && \
    npm cache clean --force

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Copy necessary config files
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/shared ./shared

# Change ownership to non-root user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start the application
CMD ["node", "dist/index.js"]

# Stage 3: Migration image (includes drizzle-kit for schema push)
FROM public.ecr.aws/docker/library/node:20-slim AS migrate

WORKDIR /app

COPY package.json ./
RUN npm install --include=dev && npm cache clean --force

COPY drizzle.config.ts ./
COPY shared ./shared

CMD ["npx", "drizzle-kit", "push"]
