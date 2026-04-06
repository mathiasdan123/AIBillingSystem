import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n"; // Initialize i18n before rendering

// Initialize Sentry for frontend error tracking (optional — no-ops if DSN is not set)
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || "development",
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: import.meta.env.PROD ? 1.0 : 0,
    // HIPAA: Strip PHI from breadcrumbs and events before sending
    beforeSend(event) {
      // Strip query strings (may contain patient IDs, search terms)
      if (event.request) {
        delete event.request.cookies;
        delete event.request.query_string;
        if (event.request.headers) {
          delete event.request.headers.cookie;
          delete event.request.headers.authorization;
        }
      }
      // Scrub breadcrumb data (may contain PHI from fetch/XHR bodies)
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => ({
          ...b,
          data: undefined,
        }));
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      // Strip XHR/fetch request/response bodies from breadcrumbs
      if (breadcrumb.category === "xhr" || breadcrumb.category === "fetch") {
        if (breadcrumb.data) {
          delete breadcrumb.data.request_body;
          delete breadcrumb.data.response_body;
        }
      }
      return breadcrumb;
    },
    // Do not send default PII
    sendDefaultPii: false,
  });
}

createRoot(document.getElementById("root")!).render(<App />);
// Railway rebuild Fri Mar  6 15:28:40 EST 2026
