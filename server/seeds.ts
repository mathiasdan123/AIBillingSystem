import { db } from "./db";
import { practices, cptCodes, icd10Codes, insurances } from "@shared/schema";

export async function seedDatabase() {
  try {
    // Check if data already exists using raw query to avoid schema mismatch issues
    const result = await db.execute<{ count: string }>(`SELECT COUNT(*) as count FROM practices`);
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

    // Seed Common OT CPT Codes
    await db.insert(cptCodes).values([
      {
        code: "97110",
        description: "Therapeutic procedure, 1 or more areas, each 15 minutes; therapeutic exercises to develop strength and endurance, range of motion and flexibility",
        category: "treatment",
        baseRate: "35.00",
        billingUnits: 1,
      },
      {
        code: "97112",
        description: "Therapeutic procedure, 1 or more areas, each 15 minutes; neuromuscular reeducation of movement, balance, coordination, kinesthetic sense, posture, and/or proprioception for sitting and/or standing activities",
        category: "treatment",
        baseRate: "38.00",
        billingUnits: 1,
      },
      {
        code: "97140",
        description: "Manual therapy techniques (eg, mobilization/manipulation, manual lymphatic drainage, manual traction), 1 or more regions, each 15 minutes",
        category: "treatment",
        baseRate: "42.00",
        billingUnits: 1,
      },
      {
        code: "97530",
        description: "Therapeutic activities, direct (one-on-one) patient contact (use of dynamic activities to improve functional performance), each 15 minutes",
        category: "treatment",
        baseRate: "45.00",
        billingUnits: 1,
      },
      {
        code: "97535",
        description: "Self-care/home management training (eg, activities of daily living (ADL) and compensatory training, meal preparation, safety procedures, and instructions in use of assistive technology devices/adaptive equipment) direct one-on-one contact, each 15 minutes",
        category: "treatment",
        baseRate: "48.00",
        billingUnits: 1,
      },
      {
        code: "97003",
        description: "Occupational therapy evaluation",
        category: "evaluation",
        baseRate: "125.00",
        billingUnits: 1,
      },
      {
        code: "97004",
        description: "Occupational therapy re-evaluation",
        category: "evaluation",
        baseRate: "85.00",
        billingUnits: 1,
      },
      {
        code: "97165",
        description: "Occupational therapy evaluation, low complexity",
        category: "evaluation",
        baseRate: "95.00",
        billingUnits: 1,
      },
      {
        code: "97166",
        description: "Occupational therapy evaluation, moderate complexity",
        category: "evaluation",
        baseRate: "135.00",
        billingUnits: 1,
      },
      {
        code: "97167",
        description: "Occupational therapy evaluation, high complexity",
        category: "evaluation",
        baseRate: "175.00",
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