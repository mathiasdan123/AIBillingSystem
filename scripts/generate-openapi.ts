/**
 * Generate a static openapi.json from the swagger-jsdoc configuration.
 *
 * Usage:
 *   npm run docs:api
 *
 * Outputs: openapi.json in the project root.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { swaggerSpec } from '../server/swagger';

const outputPath = resolve(import.meta.dirname, '..', 'openapi.json');
writeFileSync(outputPath, JSON.stringify(swaggerSpec, null, 2) + '\n', 'utf-8');

console.log(`OpenAPI spec written to ${outputPath}`);
