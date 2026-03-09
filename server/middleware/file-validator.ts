/**
 * File Upload Content Validation Middleware
 *
 * Security-focused file validation that verifies actual file content
 * using magic number/file signature detection, not just file extensions.
 *
 * This middleware provides protection against:
 * - Extension spoofing attacks (malicious.exe renamed to image.jpg)
 * - MIME type mismatches
 * - Oversized file uploads
 * - Unauthorized file types
 *
 * Usage:
 *   import { createFileValidator, FileValidationContexts } from './middleware/file-validator';
 *
 *   // Use pre-configured validators for common contexts
 *   app.post('/upload/image', upload.single('file'), createFileValidator(FileValidationContexts.IMAGE), handler);
 *   app.post('/upload/document', upload.single('file'), createFileValidator(FileValidationContexts.DOCUMENT), handler);
 *   app.post('/upload/audio', upload.single('file'), createFileValidator(FileValidationContexts.AUDIO), handler);
 *
 *   // Or create custom validators
 *   app.post('/upload/custom', upload.single('file'), createFileValidator({
 *     allowedTypes: ['image/png', 'application/pdf'],
 *     maxSize: 2 * 1024 * 1024, // 2MB
 *     allowTextFiles: false
 *   }), handler);
 */

import type { Request, Response, NextFunction } from 'express';
import logger from '../services/logger';

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Result of file type validation
 */
export interface FileTypeValidationResult {
  /** Whether the file type is valid */
  valid: boolean;
  /** The MIME type detected from file content (magic numbers) */
  detectedType: string;
  /** The MIME type claimed by the upload (from Content-Type header or file extension) */
  claimedType?: string;
  /** Error message if validation failed */
  error?: string;
}

/**
 * Options for creating a file validator middleware
 */
export interface FileValidatorOptions {
  /** Array of allowed MIME types */
  allowedTypes: string[];
  /** Maximum file size in bytes */
  maxSize: number;
  /** Whether to allow text files that cannot be validated by magic numbers */
  allowTextFiles?: boolean;
  /** Custom error message for invalid file type */
  invalidTypeMessage?: string;
  /** Custom error message for file too large */
  fileTooLargeMessage?: string;
  /** Whether to skip validation and only log warnings (useful for gradual rollout) */
  warnOnly?: boolean;
}

/**
 * File signature definition for magic number detection
 */
interface FileSignature {
  /** Array of bytes (magic numbers) that identify the file type */
  bytes: number[];
  /** Offset where the signature starts in the file */
  offset?: number;
  /** Optional additional bytes to check for subtype detection */
  subtype?: {
    bytes: number[];
    offset: number;
  };
}

// =============================================================================
// Magic Number / File Signature Definitions
// =============================================================================

/**
 * File signatures (magic numbers) for various file types
 * These bytes appear at the start of valid files of each type
 *
 * References:
 * - https://en.wikipedia.org/wiki/List_of_file_signatures
 * - https://www.garykessler.net/library/file_sigs.html
 */
const FILE_SIGNATURES: Record<string, FileSignature[]> = {
  // Image formats
  'image/jpeg': [
    { bytes: [0xFF, 0xD8, 0xFF, 0xE0] }, // JFIF
    { bytes: [0xFF, 0xD8, 0xFF, 0xE1] }, // EXIF
    { bytes: [0xFF, 0xD8, 0xFF, 0xE2] }, // Canon
    { bytes: [0xFF, 0xD8, 0xFF, 0xE3] }, // Samsung
    { bytes: [0xFF, 0xD8, 0xFF, 0xE8] }, // SPIFF
    { bytes: [0xFF, 0xD8, 0xFF, 0xDB] }, // Raw JPEG
    { bytes: [0xFF, 0xD8, 0xFF, 0xFE] }, // Comment section
  ],
  'image/png': [
    { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }, // PNG signature
  ],
  'image/gif': [
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
  ],
  'image/webp': [
    { bytes: [0x52, 0x49, 0x46, 0x46], subtype: { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 } }, // RIFF....WEBP
  ],

  // Document formats
  'application/pdf': [
    { bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  ],
  'application/msword': [
    { bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] }, // OLE Compound Document (DOC)
  ],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    { bytes: [0x50, 0x4B, 0x03, 0x04] }, // ZIP-based (DOCX) - PK..
  ],

  // Audio formats
  'audio/mpeg': [
    { bytes: [0xFF, 0xFB] }, // MP3 with MPEG Audio Layer 3 frame sync
    { bytes: [0xFF, 0xFA] }, // MP3 frame sync variant
    { bytes: [0xFF, 0xF3] }, // MP3 frame sync variant
    { bytes: [0xFF, 0xF2] }, // MP3 frame sync variant
    { bytes: [0x49, 0x44, 0x33] }, // ID3v2 tag (common in MP3)
  ],
  'audio/mp3': [
    { bytes: [0xFF, 0xFB] },
    { bytes: [0xFF, 0xFA] },
    { bytes: [0xFF, 0xF3] },
    { bytes: [0xFF, 0xF2] },
    { bytes: [0x49, 0x44, 0x33] },
  ],
  'audio/wav': [
    { bytes: [0x52, 0x49, 0x46, 0x46], subtype: { bytes: [0x57, 0x41, 0x56, 0x45], offset: 8 } }, // RIFF....WAVE
  ],
  'audio/wave': [
    { bytes: [0x52, 0x49, 0x46, 0x46], subtype: { bytes: [0x57, 0x41, 0x56, 0x45], offset: 8 } },
  ],
  'audio/x-wav': [
    { bytes: [0x52, 0x49, 0x46, 0x46], subtype: { bytes: [0x57, 0x41, 0x56, 0x45], offset: 8 } },
  ],
  'audio/x-m4a': [
    { bytes: [0x00, 0x00, 0x00], offset: 0 }, // ftyp at offset 4 (variable size header)
  ],
  'audio/m4a': [
    { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // ftyp at offset 4
  ],
  'audio/mp4': [
    { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // ftyp at offset 4
  ],
  'audio/ogg': [
    { bytes: [0x4F, 0x67, 0x67, 0x53] }, // OggS
  ],
  'application/ogg': [
    { bytes: [0x4F, 0x67, 0x67, 0x53] },
  ],
  'audio/webm': [
    { bytes: [0x1A, 0x45, 0xDF, 0xA3] }, // EBML header (WebM/Matroska)
  ],
  'video/webm': [
    { bytes: [0x1A, 0x45, 0xDF, 0xA3] },
  ],
};

/**
 * MIME type aliases - maps variations of MIME types to canonical types
 */
const MIME_TYPE_ALIASES: Record<string, string> = {
  'audio/mp3': 'audio/mpeg',
  'audio/wave': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/webm': 'video/webm',
  'application/ogg': 'audio/ogg',
};

/**
 * Text-based file types that cannot be validated by magic numbers
 */
const TEXT_BASED_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/html',
  'text/css',
  'text/javascript',
  'application/json',
  'application/xml',
  'text/xml',
]);

// =============================================================================
// Core Validation Functions
// =============================================================================

/**
 * Check if a buffer matches a file signature
 */
function matchesSignature(buffer: Buffer, signature: FileSignature): boolean {
  const offset = signature.offset || 0;

  // Check main signature
  const mainBytesMatch = signature.bytes.every((byte, index) => {
    const bufferIndex = offset + index;
    return bufferIndex < buffer.length && buffer[bufferIndex] === byte;
  });

  if (!mainBytesMatch) {
    return false;
  }

  // Check subtype signature if present
  if (signature.subtype) {
    return signature.subtype.bytes.every((byte, index) => {
      const bufferIndex = signature.subtype!.offset + index;
      return bufferIndex < buffer.length && buffer[bufferIndex] === byte;
    });
  }

  return true;
}

/**
 * Detect the actual file type from buffer content using magic numbers
 */
export function detectFileType(buffer: Buffer): string | null {
  if (buffer.length < 12) {
    // Need at least 12 bytes for reliable detection
    return null;
  }

  // Check each known file type
  for (const [mimeType, signatures] of Object.entries(FILE_SIGNATURES)) {
    for (const signature of signatures) {
      if (matchesSignature(buffer, signature)) {
        // Return canonical MIME type
        return MIME_TYPE_ALIASES[mimeType] || mimeType;
      }
    }
  }

  // Special handling for M4A/MP4 audio files with variable header size
  // These files have 'ftyp' at offset 4 but the first 4 bytes vary
  if (buffer.length >= 12) {
    const ftypCheck = buffer.slice(4, 8).toString('ascii');
    if (ftypCheck === 'ftyp') {
      // Check for M4A/AAC audio container types
      const brand = buffer.slice(8, 12).toString('ascii');
      if (['M4A ', 'M4B ', 'mp42', 'isom', 'mp41'].includes(brand)) {
        return 'audio/mp4';
      }
    }
  }

  return null;
}

/**
 * Validate that a file's content matches its claimed MIME type
 *
 * @param buffer - File content buffer
 * @param allowedTypes - Array of allowed MIME types
 * @returns Validation result with detected type information
 */
export function validateFileType(
  buffer: Buffer,
  allowedTypes: string[]
): FileTypeValidationResult {
  // Normalize allowed types (handle aliases)
  const normalizedAllowedTypes = allowedTypes.map(type =>
    MIME_TYPE_ALIASES[type] || type
  );

  // Detect actual file type from content
  const detectedType = detectFileType(buffer);

  // Handle text-based files
  if (!detectedType) {
    // Check if any text-based types are allowed
    const allowsTextTypes = normalizedAllowedTypes.some(type => TEXT_BASED_TYPES.has(type));
    if (allowsTextTypes) {
      // For text files, we can't validate by magic number
      // Return a special result indicating this
      return {
        valid: true,
        detectedType: 'text/unknown',
        error: undefined,
      };
    }

    return {
      valid: false,
      detectedType: 'unknown',
      error: 'Unable to determine file type from content',
    };
  }

  // Normalize detected type
  const normalizedDetectedType = MIME_TYPE_ALIASES[detectedType] || detectedType;

  // Check if detected type is in allowed list
  const isAllowed = normalizedAllowedTypes.includes(normalizedDetectedType);

  // Special handling for similar types
  if (!isAllowed) {
    // Check for compatible types (e.g., DOCX is ZIP-based, M4A variants)
    if (normalizedDetectedType === 'audio/mp4' &&
        normalizedAllowedTypes.some(t => ['audio/x-m4a', 'audio/m4a'].includes(t))) {
      return {
        valid: true,
        detectedType: normalizedDetectedType,
      };
    }
  }

  return {
    valid: isAllowed,
    detectedType: normalizedDetectedType,
    error: isAllowed ? undefined : `File type '${normalizedDetectedType}' is not allowed`,
  };
}

/**
 * Validate file size against maximum allowed
 *
 * @param size - File size in bytes
 * @param maxBytes - Maximum allowed size in bytes
 * @returns true if file size is within limit
 */
export function validateFileSize(size: number, maxBytes: number): boolean {
  return size > 0 && size <= maxBytes;
}

/**
 * Format bytes into human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Create a file validation middleware with specified options
 *
 * @param options - Validation options including allowed types and size limits
 * @returns Express middleware function
 */
export function createFileValidator(options: FileValidatorOptions) {
  const {
    allowedTypes,
    maxSize,
    allowTextFiles = false,
    invalidTypeMessage,
    fileTooLargeMessage,
    warnOnly = false,
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    // Handle both single file and multiple files
    const files: Express.Multer.File[] = [];

    if ((req as any).file) {
      files.push((req as any).file);
    }
    if ((req as any).files) {
      if (Array.isArray((req as any).files)) {
        files.push(...(req as any).files);
      } else {
        // Handle files object (from fields)
        Object.values((req as any).files).forEach((fileArray: any) => {
          if (Array.isArray(fileArray)) {
            files.push(...fileArray);
          }
        });
      }
    }

    // If no files, skip validation
    if (files.length === 0) {
      return next();
    }

    // Validate each file
    for (const file of files) {
      const buffer = file.buffer;
      const claimedType = file.mimetype;
      const filename = file.originalname;
      const fileSize = file.size;

      // Validate file size
      if (!validateFileSize(fileSize, maxSize)) {
        const message = fileTooLargeMessage ||
          `File '${filename}' exceeds maximum size of ${formatBytes(maxSize)}`;

        logger.warn('File size validation failed', {
          filename,
          fileSize: formatBytes(fileSize),
          maxSize: formatBytes(maxSize),
          claimedType,
        });

        if (warnOnly) {
          logger.warn('File size validation in warn-only mode, allowing file');
        } else {
          return res.status(400).json({
            error: message,
            code: 'FILE_TOO_LARGE',
            maxSize: maxSize,
            fileSize: fileSize,
          });
        }
      }

      // Skip content validation for text files if allowed
      if (allowTextFiles && TEXT_BASED_TYPES.has(claimedType)) {
        continue;
      }

      // Validate file content
      const validationResult = validateFileType(buffer, allowedTypes);

      if (!validationResult.valid) {
        const message = invalidTypeMessage ||
          `File '${filename}' has invalid content. ${validationResult.error || 'File type not allowed.'}`;

        logger.warn('File content validation failed', {
          filename,
          claimedType,
          detectedType: validationResult.detectedType,
          allowedTypes,
          error: validationResult.error,
          firstBytes: buffer.slice(0, 16).toString('hex'),
        });

        if (warnOnly) {
          logger.warn('File validation in warn-only mode, allowing file');
        } else {
          return res.status(400).json({
            error: message,
            code: 'INVALID_FILE_TYPE',
            detectedType: validationResult.detectedType,
            allowedTypes: allowedTypes,
          });
        }
      }

      // Check for MIME type mismatch (content doesn't match claimed type)
      if (validationResult.valid && validationResult.detectedType !== 'text/unknown') {
        const normalizedClaimed = MIME_TYPE_ALIASES[claimedType] || claimedType;
        const normalizedDetected = MIME_TYPE_ALIASES[validationResult.detectedType] || validationResult.detectedType;

        if (normalizedClaimed !== normalizedDetected) {
          logger.info('File MIME type mismatch (content differs from claimed)', {
            filename,
            claimedType,
            detectedType: validationResult.detectedType,
            normalizedClaimed,
            normalizedDetected,
          });
          // Don't block, but log for monitoring
        }
      }
    }

    next();
  };
}

// =============================================================================
// Pre-configured Validation Contexts
// =============================================================================

/**
 * Pre-configured validation options for common file upload contexts
 */
export const FileValidationContexts = {
  /**
   * Image uploads (profile pictures, attachments, etc.)
   * Allowed: JPEG, PNG, GIF, WebP
   * Max size: 5MB
   */
  IMAGE: {
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    maxSize: 5 * 1024 * 1024, // 5MB
    allowTextFiles: false,
    invalidTypeMessage: 'Only JPEG, PNG, GIF, and WebP images are allowed',
    fileTooLargeMessage: 'Image files must be under 5MB',
  } as FileValidatorOptions,

  /**
   * Document uploads (insurance cards, plan documents, etc.)
   * Allowed: PDF, DOC, DOCX
   * Max size: 10MB
   */
  DOCUMENT: {
    allowedTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    maxSize: 10 * 1024 * 1024, // 10MB
    allowTextFiles: true, // Allow text/plain for .txt files
    invalidTypeMessage: 'Only PDF, DOC, and DOCX documents are allowed',
    fileTooLargeMessage: 'Document files must be under 10MB',
  } as FileValidatorOptions,

  /**
   * Audio uploads for transcription
   * Allowed: MP3, WAV, M4A, OGG
   * Max size: 50MB
   */
  AUDIO: {
    allowedTypes: [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/wave',
      'audio/x-wav',
      'audio/mp4',
      'audio/m4a',
      'audio/x-m4a',
      'audio/ogg',
      'application/ogg',
      'audio/webm',
      'video/webm', // WebM can contain audio only
    ],
    maxSize: 50 * 1024 * 1024, // 50MB
    allowTextFiles: false,
    invalidTypeMessage: 'Only MP3, WAV, M4A, OGG, and WebM audio files are allowed',
    fileTooLargeMessage: 'Audio files must be under 50MB',
  } as FileValidatorOptions,

  /**
   * Plan documents (insurance plans, SBCs)
   * Allowed: PDF, PNG, JPEG (for photos of documents)
   * Max size: 10MB
   */
  PLAN_DOCUMENT: {
    allowedTypes: [
      'application/pdf',
      'image/png',
      'image/jpeg',
    ],
    maxSize: 10 * 1024 * 1024, // 10MB
    allowTextFiles: false,
    invalidTypeMessage: 'Only PDF, PNG, and JPEG files are allowed for plan documents',
    fileTooLargeMessage: 'Plan document files must be under 10MB',
  } as FileValidatorOptions,

  /**
   * Insurance contract/rate files
   * Allowed: PDF, TXT, DOC, DOCX
   * Max size: 10MB
   */
  INSURANCE_CONTRACT: {
    allowedTypes: [
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    maxSize: 10 * 1024 * 1024, // 10MB
    allowTextFiles: true,
    invalidTypeMessage: 'Only PDF, TXT, DOC, and DOCX files are allowed for contracts',
    fileTooLargeMessage: 'Contract files must be under 10MB',
  } as FileValidatorOptions,
};

// =============================================================================
// Utility Exports
// =============================================================================

/**
 * Export file signatures for external use or testing
 */
export const getKnownFileSignatures = () => ({ ...FILE_SIGNATURES });

/**
 * Export text-based types list
 */
export const getTextBasedTypes = () => Array.from(TEXT_BASED_TYPES);

/**
 * Check if a MIME type is known and can be validated
 */
export function isSupportedMimeType(mimeType: string): boolean {
  const normalized = MIME_TYPE_ALIASES[mimeType] || mimeType;
  return normalized in FILE_SIGNATURES || TEXT_BASED_TYPES.has(normalized);
}

export default {
  createFileValidator,
  validateFileType,
  validateFileSize,
  detectFileType,
  FileValidationContexts,
  isSupportedMimeType,
  getKnownFileSignatures,
  getTextBasedTypes,
};
