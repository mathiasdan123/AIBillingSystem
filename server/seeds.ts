import { getDb } from "./db";
import { practices, cptCodes, icd10Codes, insurances } from "@shared/schema";
import { sql } from "drizzle-orm";

export async function seedDatabase() {
  try {
    // Wait for database to be ready
    const db = await getDb();

    // Check if data already exists
    const result = await db.execute(sql`SELECT COUNT(*) as count FROM practices`);
    const count = parseInt(result.rows[0]?.count || '0', 10);
    if (count > 0) {
      console.log("Database already seeded");
      return;
    }

    // Create sample practice
    const [practice] = await db.insert(practices).values({
      name: "Healing Hands Occupational Therapy",
      npi: "1234567890",
      taxId: "12-3456789",
      address: "123 Therapy Lane, Wellness City, WC 12345",
      phone: "(555) 123-4567",
      email: "admin@healinghands.com",
    }).returning();

    // Seed Common OT CPT Codes - Standard rate $289 per session
    await db.insert(cptCodes).values([
      {
        code: "97110",
        description: "Therapeutic exercises - strength, ROM, flexibility (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97112",
        description: "Neuromuscular reeducation - balance, coordination, posture (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97140",
        description: "Manual therapy - mobilization, manipulation (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97530",
        description: "Therapeutic activities - functional performance (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97535",
        description: "Self-care/ADL training - daily living activities (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97542",
        description: "Wheelchair management training (15 min)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97545",
        description: "Work hardening/conditioning (2 hours)",
        category: "treatment",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97003",
        description: "Occupational therapy evaluation",
        category: "evaluation",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97004",
        description: "Occupational therapy re-evaluation",
        category: "evaluation",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97165",
        description: "OT evaluation - low complexity",
        category: "evaluation",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97166",
        description: "OT evaluation - moderate complexity",
        category: "evaluation",
        baseRate: "289.00",
        billingUnits: 1,
      },
      {
        code: "97167",
        description: "OT evaluation - high complexity",
        category: "evaluation",
        baseRate: "289.00",
        billingUnits: 1,
      },
    ]);

    // Seed Common ICD-10 Codes for OT
    await db.insert(icd10Codes).values([
      {
        code: "Z51.89",
        description: "Encounter for other specified aftercare",
        category: "aftercare",
      },
      {
        code: "M25.561",
        description: "Pain in right knee",
        category: "musculoskeletal",
      },
      {
        code: "M25.562",
        description: "Pain in left knee",
        category: "musculoskeletal",
      },
      {
        code: "M25.511",
        description: "Pain in right shoulder",
        category: "musculoskeletal",
      },
      {
        code: "M25.512",
        description: "Pain in left shoulder",
        category: "musculoskeletal",
      },
      {
        code: "M79.3",
        description: "Panniculitis, unspecified",
        category: "musculoskeletal",
      },
      {
        code: "G93.1",
        description: "Anoxic brain damage, not elsewhere classified",
        category: "neurological",
      },
      {
        code: "I69.351",
        description: "Hemiplegia and hemiparesis following cerebral infarction affecting right dominant side",
        category: "neurological",
      },
      {
        code: "I69.352",
        description: "Hemiplegia and hemiparesis following cerebral infarction affecting left dominant side",
        category: "neurological",
      },
      {
        code: "S72.001A",
        description: "Fracture of unspecified part of neck of right femur, initial encounter for closed fracture",
        category: "injury",
      },
      {
        code: "S72.002A",
        description: "Fracture of unspecified part of neck of left femur, initial encounter for closed fracture",
        category: "injury",
      },
      {
        code: "F84.0",
        description: "Autistic disorder",
        category: "developmental",
      },
      {
        code: "F82",
        description: "Specific developmental disorder of motor function",
        category: "developmental",
      },
    ]);

    // Seed Insurance Companies
    await db.insert(insurances).values([
      {
        name: "Medicare",
        payerCode: "00100",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Medicaid",
        payerCode: "00200",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Blue Cross Blue Shield",
        payerCode: "00300",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Aetna",
        payerCode: "00400",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Cigna",
        payerCode: "00500",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "UnitedHealth",
        payerCode: "00600",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
      {
        name: "Humana",
        payerCode: "00700",
        eligibilityApiConfig: {},
        claimSubmissionConfig: {},
      },
    ]);

    console.log("Database seeded successfully with:", {
      practices: 1,
      cptCodes: 10,
      icd10Codes: 13,
      insurances: 7,
    });
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}