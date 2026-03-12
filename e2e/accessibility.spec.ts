import { test, expect } from '@playwright/test';

test.describe('Accessibility - Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page has lang attribute on html element', async ({ page }) => {
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('en');
  });

  test('all images have alt text', async ({ page }) => {
    const images = await page.locator('img').all();

    for (const img of images) {
      const alt = await img.getAttribute('alt');
      const ariaHidden = await img.getAttribute('aria-hidden');
      const role = await img.getAttribute('role');

      // Images should have alt text, or be explicitly decorative
      const isDecorative = ariaHidden === 'true' || role === 'presentation' || alt === '';
      const hasAlt = alt !== null;

      expect(hasAlt || isDecorative, `Image missing alt text: ${await img.evaluate(el => el.outerHTML)}`).toBeTruthy();
    }
  });

  test('no empty links on the page', async ({ page }) => {
    const links = await page.locator('a').all();

    for (const link of links) {
      const text = (await link.textContent() || '').trim();
      const ariaLabel = await link.getAttribute('aria-label');
      const title = await link.getAttribute('title');
      const hasChildImg = (await link.locator('img, svg').count()) > 0;

      const hasAccessibleName = text.length > 0 || !!ariaLabel || !!title || hasChildImg;

      expect(
        hasAccessibleName,
        `Empty link found: ${await link.evaluate(el => el.outerHTML)}`
      ).toBeTruthy();
    }
  });

  test('no empty buttons on the page', async ({ page }) => {
    const buttons = await page.locator('button').all();

    for (const button of buttons) {
      const text = (await button.textContent() || '').trim();
      const ariaLabel = await button.getAttribute('aria-label');
      const title = await button.getAttribute('title');
      const hasChildContent = (await button.locator('img, svg').count()) > 0;

      const hasAccessibleName = text.length > 0 || !!ariaLabel || !!title || hasChildContent;

      expect(
        hasAccessibleName,
        `Empty button found: ${await button.evaluate(el => el.outerHTML)}`
      ).toBeTruthy();
    }
  });

  test('form inputs have associated labels', async ({ page }) => {
    // Open the auth modal to expose form inputs
    await page.locator('header').getByRole('button', { name: /Sign In/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const inputs = await dialog.locator('input').all();

    for (const input of inputs) {
      const id = await input.getAttribute('id');
      const ariaLabel = await input.getAttribute('aria-label');
      const ariaLabelledBy = await input.getAttribute('aria-labelledby');
      const type = await input.getAttribute('type');

      // Hidden inputs don't need labels
      if (type === 'hidden') continue;

      // Check for an associated label via id, aria-label, or aria-labelledby
      let hasLabel = !!ariaLabel || !!ariaLabelledBy;

      if (id) {
        const labelCount = await dialog.locator(`label[for="${id}"]`).count();
        hasLabel = hasLabel || labelCount > 0;
      }

      // Also check if the input is inside a label
      const parentLabel = await input.locator('xpath=ancestor::label').count();
      hasLabel = hasLabel || parentLabel > 0;

      expect(
        hasLabel,
        `Input without label: id="${id}", type="${type}"`
      ).toBeTruthy();
    }
  });

  test('interactive elements are keyboard focusable', async ({ page }) => {
    // Tab to the first interactive element and verify focus is visible
    await page.keyboard.press('Tab');

    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeAttached();
  });

  test('heading hierarchy is logical', async ({ page }) => {
    const headings = await page.locator('h1, h2, h3, h4, h5, h6').all();

    expect(headings.length).toBeGreaterThan(0);

    // Check that there is exactly one h1
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);

    // Verify heading levels don't skip (e.g., h1 then h3 without h2)
    let previousLevel = 0;
    for (const heading of headings) {
      const tagName = await heading.evaluate(el => el.tagName.toLowerCase());
      const level = parseInt(tagName.charAt(1), 10);

      // Heading levels should not jump more than 1 level down
      if (previousLevel > 0) {
        expect(
          level <= previousLevel + 1,
          `Heading level jumped from h${previousLevel} to h${level}: "${await heading.textContent()}"`
        ).toBeTruthy();
      }

      previousLevel = level;
    }
  });

  test('color contrast: text is not invisible (basic check)', async ({ page }) => {
    // Basic check that major text elements are not set to transparent or same as background
    const heroHeading = page.getByRole('heading', { level: 1 });
    await expect(heroHeading).toBeVisible();

    // Verify the heading has non-zero dimensions
    const box = await heroHeading.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test('main content landmark exists', async ({ page }) => {
    const main = page.locator('#main-content');
    await expect(main).toBeAttached();
  });
});

test.describe('Accessibility - Auth Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('header').getByRole('button', { name: /Sign In/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('auth modal has dialog role', async ({ page }) => {
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
  });

  test('auth modal has a title', async ({ page }) => {
    const dialog = page.getByRole('dialog');
    // Dialog should have a heading
    const heading = dialog.locator('h2, [role="heading"]').first();
    await expect(heading).toBeVisible();
  });

  test('auth modal has a description', async ({ page }) => {
    const dialog = page.getByRole('dialog');
    const description = dialog.getByText('Enter your credentials to access your account.');
    await expect(description).toBeVisible();
  });

  test('sign up form inputs have labels', async ({ page }) => {
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Sign up/i }).click();

    // All form fields should have labels
    await expect(dialog.getByLabel('First Name')).toBeVisible();
    await expect(dialog.getByLabel('Last Name')).toBeVisible();
    await expect(dialog.getByLabel('Email')).toBeVisible();
    await expect(dialog.getByLabel('Password')).toBeVisible();
  });
});

test.describe('Accessibility - Authenticated App (mocked)', () => {
  test.beforeEach(async ({ page }) => {
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

    await page.route('**/api/**', (route) => {
      const url = route.request().url();
      if (url.includes('/api/auth/me')) return;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });
  });

  test('skip-to-content link exists', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    // The skip link is screen-reader-only but should exist in the DOM
    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toBeAttached({ timeout: 10000 });
    await expect(skipLink).toHaveText(/Skip to main content/i);
  });

  test('navigation has proper ARIA role and label', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible({ timeout: 10000 });
    await expect(nav).toHaveAttribute('role', 'navigation');
  });

  test('navigation uses list structure', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible({ timeout: 10000 });

    const list = nav.locator('ul[role="list"]');
    await expect(list).toBeVisible();

    const listItems = await list.locator('li').count();
    expect(listItems).toBeGreaterThan(0);
  });

  test('decorative icons have aria-hidden', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible({ timeout: 10000 });

    // Check that SVG icons in nav items are aria-hidden
    const navIcons = await nav.locator('li svg').all();

    for (const icon of navIcons) {
      const ariaHidden = await icon.getAttribute('aria-hidden');
      expect(ariaHidden, 'Navigation icon should have aria-hidden="true"').toBe('true');
    }
  });

  test('active navigation item has aria-current="page"', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible({ timeout: 10000 });

    const activeItem = nav.locator('a[aria-current="page"]');
    await expect(activeItem).toBeAttached();
    await expect(activeItem).toHaveText(/Dashboard/);
  });

  test('mobile menu button has aria-expanded attribute', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    await page.waitForTimeout(2000);

    const menuButton = page.getByRole('button', { name: /Open menu/i });
    await expect(menuButton).toBeVisible({ timeout: 10000 });
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    await menuButton.click();

    // After clicking, the button label changes to "Close menu"
    const closeButton = page.getByRole('button', { name: /Close menu/i });
    await expect(closeButton).toHaveAttribute('aria-expanded', 'true');
  });
});
