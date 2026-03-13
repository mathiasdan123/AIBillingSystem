import { describe, it, expect } from 'vitest';
import { swaggerSpec } from '../swagger';

describe('Swagger / OpenAPI Spec', () => {
  it('uses OpenAPI 3.0.x version', () => {
    expect(swaggerSpec.openapi).toMatch(/^3\.0\.\d+$/);
  });

  it('has info section with title and version', () => {
    expect(swaggerSpec.info).toBeDefined();
    expect(swaggerSpec.info.title).toBe('TherapyBill AI API');
    expect(swaggerSpec.info.version).toBeDefined();
    expect(typeof swaggerSpec.info.version).toBe('string');
  });

  it('has components section with schemas', () => {
    expect(swaggerSpec.components).toBeDefined();
    expect(swaggerSpec.components.schemas).toBeDefined();
    expect(swaggerSpec.components.schemas.Patient).toBeDefined();
    expect(swaggerSpec.components.schemas.Claim).toBeDefined();
    expect(swaggerSpec.components.schemas.Appointment).toBeDefined();
    expect(swaggerSpec.components.schemas.ErrorResponse).toBeDefined();
  });

  it('has security schemes defined', () => {
    expect(swaggerSpec.components.securitySchemes).toBeDefined();
    expect(swaggerSpec.components.securitySchemes.sessionAuth).toBeDefined();
    expect(swaggerSpec.components.securitySchemes.sessionAuth.type).toBe('apiKey');
  });

  it('has tags for main API sections', () => {
    expect(swaggerSpec.tags).toBeDefined();
    const tagNames = swaggerSpec.tags.map((t: any) => t.name);
    expect(tagNames).toContain('Patients');
    expect(tagNames).toContain('Claims');
    expect(tagNames).toContain('Appointments');
    expect(tagNames).toContain('Authentication');
    expect(tagNames).toContain('Analytics');
  });
});
