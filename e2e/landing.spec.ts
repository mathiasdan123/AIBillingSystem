import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page loads and displays the brand name', async ({ page }) => {
    const brandName = page.locator('header').getByText('TherapyBill AI');
    await expect(brandName).toBeVisible();
  });

  test('header navigation links are visible on desktop', async ({ page }) => {
    // Features and Pricing links are visible on larger screens
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const featuresLink = page.locator('header a[href="#features"]');
    const pricingLink = page.locator('header a[href="#pricing"]');

    await expect(featuresLink).toBeVisible();
    await expect(pricingLink).toBeVisible();
  });

  test('hero section renders with headline and description', async ({ page }) => {
    const headline = page.getByRole('heading', { level: 1 });
    await expect(headline).toBeVisible();
    await expect(headline).toContainText('All-in-One Platform');

    const description = page.getByText('From patient intake to insurance reimbursement');
    await expect(description).toBeVisible();
  });

  test('hero section displays trust badges', async ({ page }) => {
    await expect(page.getByText('HIPAA Compliant').first()).toBeVisible();
    await expect(page.getByText('SOC 2 Certified').first()).toBeVisible();
    await expect(page.getByText('No Setup Fees')).toBeVisible();
  });

  test('CTA buttons are present in hero section', async ({ page }) => {
    const startTrialButton = page.getByRole('button', { name: /Start Free Trial/i }).first();
    await expect(startTrialButton).toBeVisible();

    const intakeButton = page.getByRole('button', { name: /Try Patient Intake/i });
    await expect(intakeButton).toBeVisible();
  });

  test('Sign In button is present in the header', async ({ page }) => {
    const signInButton = page.locator('header').getByRole('button', { name: /Sign In/i });
    await expect(signInButton).toBeVisible();
  });

  test('features section exists with content', async ({ page }) => {
    const featuresSection = page.locator('#features');
    await expect(featuresSection).toBeAttached();

    await expect(page.getByText('AI That Works While You Treat')).toBeVisible();
  });

  test('pricing section exists with plan cards', async ({ page }) => {
    const pricingSection = page.locator('#pricing');
    await expect(pricingSection).toBeAttached();

    await expect(page.getByText('Simple, Transparent Pricing')).toBeVisible();
    await expect(page.getByText('Solo Practice')).toBeVisible();
    await expect(page.getByText('Growing Practice')).toBeVisible();
    await expect(page.getByText('Enterprise')).toBeVisible();
  });

  test('footer renders with navigation columns', async ({ page }) => {
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();

    // Footer brand
    await expect(footer.getByText('TherapyBill AI')).toBeVisible();

    // Footer section headings
    await expect(footer.getByText('Platform')).toBeVisible();
    await expect(footer.getByText('Support')).toBeVisible();
    await expect(footer.getByText('Legal')).toBeVisible();
  });

  test('footer contains anchor links to page sections', async ({ page }) => {
    const footer = page.locator('footer');

    const footerLinks = await footer.locator('a[href^="#"]').all();
    const hrefs = new Set<string>();
    for (const link of footerLinks) {
      const href = await link.getAttribute('href');
      if (href) hrefs.add(href);
    }
    const hrefArray = Array.from(hrefs);

    expect(hrefArray).toContain('#features');
    expect(hrefArray).toContain('#pricing');
    expect(hrefArray).toContain('#how-it-works');
  });

  test('platform overview section shows capability cards', async ({ page }) => {
    await expect(page.getByText('One Platform. Everything You Need.')).toBeVisible();

    const capabilities = [
      'Patient Intake', 'Scheduling', 'Telehealth', 'Voice Notes',
      'SOAP Notes', 'Auto-Billing', 'Claims', 'Appeals',
      'Messaging', 'Analytics', 'Reviews', 'Compliance',
    ];

    for (const capability of capabilities) {
      await expect(page.getByText(capability, { exact: true }).first()).toBeVisible();
    }
  });
});
