/**
 * XSS Sanitization Utilities for HIPAA Security Compliance
 *
 * This module provides sanitization functions to prevent XSS attacks.
 * For production use with rich HTML content, install DOMPurify:
 *   npm install dompurify @types/dompurify
 *
 * Current implementation uses built-in sanitization that works without external dependencies.
 */

// HTML entities map for escaping
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
};

// Reverse map for unescaping (used internally)
const HTML_ENTITIES_REVERSE: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#x2F;': '/',
  '&#x60;': '`',
  '&#x3D;': '=',
  '&#39;': "'",
};

/**
 * Escapes HTML entities for safe display in HTML context.
 * Use this when displaying user input in HTML without allowing any HTML rendering.
 *
 * @param input - The string to escape
 * @returns HTML-escaped string safe for display
 *
 * @example
 * escapeForDisplay('<script>alert("xss")</script>')
 * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 */
export function escapeForDisplay(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input.replace(/[&<>"'`=/]/g, (char) => HTML_ENTITIES[char] || char);
}

/**
 * Sanitizes plain text input by removing potentially dangerous characters.
 * Use this for form inputs, search fields, and other plain text contexts.
 * Preserves normal text while stripping HTML tags and dangerous patterns.
 *
 * @param input - The text to sanitize
 * @returns Sanitized plain text
 *
 * @example
 * sanitizeText('Hello <script>alert("xss")</script> World')
 * // Returns: 'Hello  World'
 */
export function sanitizeText(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  // Remove null bytes
  let sanitized = input.replace(/\0/g, '');

  // Strip all HTML tags
  sanitized = sanitized.replace(/<[^>]*>/g, '');

  // Remove javascript: and data: protocol patterns
  sanitized = sanitized.replace(/javascript\s*:/gi, '');
  sanitized = sanitized.replace(/data\s*:/gi, '');
  sanitized = sanitized.replace(/vbscript\s*:/gi, '');

  // Remove event handler patterns (onclick, onerror, etc.)
  sanitized = sanitized.replace(/on\w+\s*=/gi, '');

  // Trim and normalize whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Sanitizes HTML content, allowing safe HTML tags while removing dangerous elements.
 * Use this for rich text editors and content that should render HTML.
 *
 * Note: For full HTML sanitization in production, install DOMPurify:
 *   npm install dompurify @types/dompurify
 *
 * @param input - The HTML content to sanitize
 * @returns Sanitized HTML string
 *
 * @example
 * sanitizeHTML('<p>Hello</p><script>alert("xss")</script>')
 * // Returns: '<p>Hello</p>'
 */
export function sanitizeHTML(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  // Remove null bytes
  let sanitized = input.replace(/\0/g, '');

  // Remove script tags and their content
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove style tags and their content (can contain expressions)
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove iframe, object, embed, frame tags
  sanitized = sanitized.replace(/<(iframe|object|embed|frame|frameset|applet|base|form|input|button|select|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  sanitized = sanitized.replace(/<(iframe|object|embed|frame|frameset|applet|base|form|input|button|select|textarea)\b[^>]*\/?>/gi, '');

  // Remove link tags (can load external stylesheets)
  sanitized = sanitized.replace(/<link\b[^>]*\/?>/gi, '');

  // Remove meta tags
  sanitized = sanitized.replace(/<meta\b[^>]*\/?>/gi, '');

  // Remove event handlers from remaining tags
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');

  // Remove javascript:, data:, vbscript: protocols from attributes
  sanitized = sanitized.replace(/\s*(href|src|action|formaction|poster|data)\s*=\s*["']?\s*javascript\s*:[^"'>\s]*/gi, '');
  sanitized = sanitized.replace(/\s*(href|src|action|formaction|poster|data)\s*=\s*["']?\s*vbscript\s*:[^"'>\s]*/gi, '');
  sanitized = sanitized.replace(/\s*(href|src|action|formaction|poster|data)\s*=\s*["']?\s*data\s*:[^"'>\s]*/gi, '');

  // Remove expression() in style attributes (IE vulnerability)
  sanitized = sanitized.replace(/style\s*=\s*["'][^"']*expression\s*\([^)]*\)[^"']*["']/gi, '');
  sanitized = sanitized.replace(/style\s*=\s*["'][^"']*url\s*\([^)]*javascript[^)]*\)[^"']*["']/gi, '');

  return sanitized.trim();
}

/**
 * Allowed URL protocols for sanitization
 */
const ALLOWED_URL_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * URL validation options
 */
export interface SanitizeURLOptions {
  /** Additional allowed protocols beyond http, https, mailto, tel */
  allowedProtocols?: string[];
  /** Allow relative URLs (default: true) */
  allowRelative?: boolean;
  /** Require HTTPS only (default: false) */
  requireHTTPS?: boolean;
}

/**
 * Validates and sanitizes a URL, preventing javascript: and data: injection.
 * Returns null if the URL is invalid or potentially dangerous.
 *
 * @param input - The URL to sanitize
 * @param options - Optional configuration
 * @returns Sanitized URL string or null if invalid
 *
 * @example
 * sanitizeURL('https://example.com/page?q=test')
 * // Returns: 'https://example.com/page?q=test'
 *
 * sanitizeURL('javascript:alert("xss")')
 * // Returns: null
 */
export function sanitizeURL(input: string, options: SanitizeURLOptions = {}): string | null {
  if (typeof input !== 'string' || !input.trim()) {
    return null;
  }

  const {
    allowedProtocols = [],
    allowRelative = true,
    requireHTTPS = false,
  } = options;

  // Trim and normalize
  let url = input.trim();

  // Remove null bytes and control characters
  url = url.replace(/[\0\x00-\x1f\x7f]/g, '');

  // Decode any encoded characters that could hide malicious protocols
  // Check multiple times to handle double/triple encoding
  let decoded = url;
  for (let i = 0; i < 3; i++) {
    try {
      const newDecoded = decodeURIComponent(decoded);
      if (newDecoded === decoded) break;
      decoded = newDecoded;
    } catch {
      break;
    }
  }

  // Check for dangerous protocols in decoded form
  const lowercaseDecoded = decoded.toLowerCase().replace(/\s/g, '');
  const dangerousProtocols = ['javascript:', 'vbscript:', 'data:', 'file:'];

  for (const protocol of dangerousProtocols) {
    if (lowercaseDecoded.startsWith(protocol)) {
      return null;
    }
  }

  // Check if it's a relative URL
  const isRelative = !url.includes('://') && !url.startsWith('//');

  if (isRelative) {
    if (!allowRelative) {
      return null;
    }
    // For relative URLs, ensure they start with / or are just paths
    if (url.startsWith('/') || /^[a-zA-Z0-9]/.test(url)) {
      return url;
    }
    return null;
  }

  // Parse and validate absolute URLs
  try {
    const parsedURL = new URL(url);
    const protocol = parsedURL.protocol.toLowerCase();

    // Check protocol
    const allAllowedProtocols = [...ALLOWED_URL_PROTOCOLS, ...allowedProtocols];

    if (requireHTTPS && protocol !== 'https:') {
      return null;
    }

    if (!allAllowedProtocols.includes(protocol)) {
      return null;
    }

    // Return the normalized URL
    return parsedURL.href;
  } catch {
    // If URL parsing fails, it might still be a valid relative URL
    if (allowRelative && url.startsWith('/')) {
      return url;
    }
    return null;
  }
}

/**
 * Batch sanitizes an object's string properties.
 * Useful for sanitizing form data or API payloads.
 *
 * @param obj - Object with string properties to sanitize
 * @param sanitizer - The sanitization function to use (default: sanitizeText)
 * @returns New object with sanitized string values
 *
 * @example
 * const formData = { name: '<b>John</b>', email: 'john@example.com' };
 * sanitizeObject(formData)
 * // Returns: { name: 'John', email: 'john@example.com' }
 */
export function sanitizeObject<T extends Record<string, unknown>>(
  obj: T,
  sanitizer: (input: string) => string = sanitizeText
): T {
  const result = {} as T;

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      (result as Record<string, unknown>)[key] = sanitizer(value);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      (result as Record<string, unknown>)[key] = sanitizeObject(
        value as Record<string, unknown>,
        sanitizer
      );
    } else {
      (result as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}

/**
 * Creates a sanitized string that's safe for use in innerHTML.
 * Combines HTML sanitization with entity escaping for maximum safety.
 *
 * @param input - The content to sanitize
 * @param allowHTML - If true, uses sanitizeHTML; if false, uses escapeForDisplay
 * @returns Safe string for innerHTML
 */
export function createSafeHTML(input: string, allowHTML: boolean = false): string {
  if (typeof input !== 'string') {
    return '';
  }

  return allowHTML ? sanitizeHTML(input) : escapeForDisplay(input);
}
