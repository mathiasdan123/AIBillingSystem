import express, { type Express, type Response } from "express";
import fs from "fs";
import path from "path";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Hashed asset URLs Vite emits (filenames contain content hashes), safe to
// cache forever. Everything else (index.html, favicon, manifest, etc.) must
// be revalidated every request so users pick up new builds within one reload.
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const NO_CACHE = "no-cache, no-store, must-revalidate, max-age=0";

export function setStaticCacheHeaders(res: Response, filepath: string): void {
  // Vite puts hashed bundles under /assets/ by default; we keep the same
  // convention. Anything served from that directory has a content hash in
  // its filename, so the URL itself changes on every build.
  if (filepath.includes(`${path.sep}assets${path.sep}`)) {
    res.setHeader("Cache-Control", IMMUTABLE_CACHE);
  } else {
    res.setHeader("Cache-Control", NO_CACHE);
  }
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Block source maps from being served publicly (they go to Sentry, not browsers)
  app.use("*.map", (_req, res) => {
    res.status(404).end();
  });

  app.use(
    express.static(distPath, {
      setHeaders: setStaticCacheHeaders,
    }),
  );

  // SPA fallback — every unknown URL gets the HTML shell. Must NEVER be
  // cached, or users keep loading a stale shell that points at old bundles.
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", NO_CACHE);
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
