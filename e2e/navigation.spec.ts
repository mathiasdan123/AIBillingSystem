import { test, expect } from '@playwright/test';

/**
 * Navigation tests for the authenticated app experience.
 *
 * Since these tests run without a database, the app will show the
 * unauthenticated landing page. We test the landing page navigation
 * structure and verify that the navigation component defines the
 * expected items by checking the unauthenticated route structure.
 *
 * For authenticated navigation, we mock the auth API response.
 */

test.describe('Landing Page Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('header contains brand logo and name', async ({ page }) => {
    const header = page.locator('header');
    await expect(header.getByText('TherapyBill AI')).toBeVisible();
  });

  test('header has navigation links on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const header = page.locator('header');
    const navLinks = await header.locator('a').all();

    const hrefs = new Set<string>();
    for (const link of navLinks) {
      const href = await link.getAttribute('href');
      if (href) hrefs.add(href);
    }
    const hrefArray = Array.from(hrefs);

    expect(hrefArray).toContain('#features');
    expect(hrefArray).toContain('#pricing');
  });

  test('clicking Features link scrolls to features section', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const featuresLink = page.locator('header a[href="#features"]');
    await featuresLink.click();

    // The features section should be in the viewport
    const featuresSection = page.locator('#features');
    await expect(featuresSection).toBeInViewport({ timeout: 3000 });
  });

  test('clicking Pricing link scrolls to pricing section', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const pricingLink = page.locator('header a[href="#pricing"]');
    await pricingLink.click();

    const pricingSection = page.locator('#pricing');
    await expect(pricingSection).toBeInViewport({ timeout: 3000 });
  });
});

test.describe('Authenticated Navigation (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the auth check endpoint to simulate an authenticated user
    await page.route('**/api/auth/me', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          email: 'test@therapybill.ai',
          firstName: 'Test',
          lastName: 'User',
          role: 'admin',
        }),
      });
    });

    // Mock other API calls that the dashboard might make to prevent errors
    await page.route('**/api/**', (route) => {
      const url = route.request().url();
      // Let the auth endpoint through (already handled above)
      if (url.includes('/api/auth/me')) {
        return;
      }
      // Return empty data for other API calls
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto('/');
  });

  test('sidebar navigation is visible on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    // Wait for the nav to appear (auth state should load)
    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible({ timeout: 10000 });
  });

  test('sidebar contains key navigation items', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible({ timeout: 10000 });

    // Check for core navigation items
    const expectedNavItems = [
      'Dashboard',
      'Patients',
      'Calendar',
      'Claims',
      'SOAP Notes',
      'Settings',
    ];

    for (const itemName of expectedNavItems) {
      const navItem = nav.getByText(itemName, { exact: true });
      await expect(navItem).toBeVisible();
    }
  });

  test('sidebar shows brand name', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible({ timeout: 10000 });
    await expect(nav.getByText('TherapyBill AI')).toBeVisible();
  });

  test('sidebar shows user information', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible({ timeout: 10000 });

    // User name should appear
    await expect(nav.getByText('Test User')).toBeVisible();
  });

  test('sidebar has logout button', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible({ timeout: 10000 });

    const logoutButton = nav.getByRole('button', { name: /Log out/i });
    await expect(logoutButton).toBeVisible();
  });

  test('mobile hamburger menu is visible on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Wait for auth to resolve
    await page.waitForTimeout(2000);

    const menuButton = page.getByRole('button', { name: /Open menu/i });
    await expect(menuButton).toBeVisible({ timeout: 10000 });
  });

  test('mobile menu opens and shows navigation items', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    await page.waitForTimeout(2000);

    const menuButton = page.getByRole('button', { name: /Open menu/i });
    await expect(menuButton).toBeVisible({ timeout: 10000 });
    await menuButton.click();

    const mobileNav = page.locator('nav[aria-label="Mobile navigation"]');
    await expect(mobileNav).toBeVisible();

    await expect(mobileNav.getByText('Dashboard')).toBeVisible();
    await expect(mobileNav.getByText('Patients')).toBeVisible();
    await expect(mobileNav.getByText('Calendar')).toBeVisible();
  });

  test('Dashboard link is active on the root route', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible({ timeout: 10000 });

    const dashboardLink = nav.locator('a[href="/"]');
    await expect(dashboardLink).toHaveAttribute('aria-current', 'page');
  });
});
