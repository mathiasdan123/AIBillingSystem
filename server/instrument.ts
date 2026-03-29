/**
 * Sentry instrumentation — must be loaded BEFORE the main app via Node --import flag.
 * This ensures Sentry can patch HTTP/Express internals before they are first required.
 *
 * Used in production: node --import ./dist/instrument.js dist/index.js
 */
import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    // Do not send PHI or sensitive session data to Sentry
    beforeSend(event: Sentry.ErrorEvent) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
      }
      return event;
    },
  });
}
