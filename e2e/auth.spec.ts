import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('clicking Sign In opens the auth modal', async ({ page }) => {
    const signInButton = page.locator('header').getByRole('button', { name: /Sign In/i });
    await signInButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Sign In', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText('Enter your credentials to access your account.')).toBeVisible();
  });

  test('sign in form has email and password fields', async ({ page }) => {
    await page.locator('header').getByRole('button', { name: /Sign In/i }).click();

    const dialog = page.getByRole('dialog');

    const emailInput = dialog.locator('#email');
    const passwordInput = dialog.locator('#password');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    // Check labels
    await expect(dialog.getByLabel('Email')).toBeVisible();
    await expect(dialog.getByLabel('Password')).toBeVisible();
  });

  test('sign in form has submit button', async ({ page }) => {
    await page.locator('header').getByRole('button', { name: /Sign In/i }).click();

    const dialog = page.getByRole('dialog');
    const submitButton = dialog.getByRole('button', { name: 'Sign In', exact: true });
    await expect(submitButton).toBeVisible();
  });

  test('can navigate to sign up mode from sign in', async ({ page }) => {
    await page.locator('header').getByRole('button', { name: /Sign In/i }).click();

    const dialog = page.getByRole('dialog');

    // Click "Sign up" link
    const signUpLink = dialog.getByRole('button', { name: /Sign up/i });
    await expect(signUpLink).toBeVisible();
    await signUpLink.click();

    // Modal should switch to Create Account
    await expect(dialog.getByText('Create Account', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText('Fill in your details to create a new account.')).toBeVisible();
  });

  test('registration form has all required fields', async ({ page }) => {
    await page.locator('header').getByRole('button', { name: /Sign In/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Sign up/i }).click();

    // Check fields
    await expect(dialog.getByLabel('First Name')).toBeVisible();
    await expect(dialog.getByLabel('Last Name')).toBeVisible();
    await expect(dialog.getByLabel('Email')).toBeVisible();
    await expect(dialog.getByLabel('Password')).toBeVisible();

    // Submit button
    const createButton = dialog.getByRole('button', { name: 'Create Account', exact: true });
    await expect(createButton).toBeVisible();
  });

  test('registration form shows password requirements when typing', async ({ page }) => {
    await page.locator('header').getByRole('button', { name: /Sign In/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Sign up/i }).click();

    // Type a weak password to trigger requirements display
    await dialog.getByLabel('Password').fill('abc');

    await expect(dialog.getByText('Password requirements:')).toBeVisible();
    await expect(dialog.getByText('At least 12 characters')).toBeVisible();
    await expect(dialog.getByText('One uppercase letter')).toBeVisible();
    await expect(dialog.getByText('One lowercase letter')).toBeVisible();
    await expect(dialog.getByText('One number')).toBeVisible();
    await expect(dialog.getByText('One special character')).toBeVisible();
  });

  test('create account button is disabled when password is too weak', async ({ page }) => {
    await page.locator('header').getByRole('button', { name: /Sign In/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Sign up/i }).click();

    await dialog.getByLabel('First Name').fill('Test');
    await dialog.getByLabel('Last Name').fill('User');
    await dialog.getByLabel('Email').fill('test@example.com');
    await dialog.getByLabel('Password').fill('weak');

    const createButton = dialog.getByRole('button', { name: 'Create Account', exact: true });
    await expect(createButton).toBeDisabled();
  });

  test('can navigate to forgot password mode', async ({ page }) => {
    await page.locator('header').getByRole('button', { name: /Sign In/i }).click();

    const dialog = page.getByRole('dialog');
    const forgotButton = dialog.getByRole('button', { name: /Forgot Password/i });
    await expect(forgotButton).toBeVisible();
    await forgotButton.click();

    await expect(dialog.getByText('Reset Password', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText('Enter your email to receive a password reset link.')).toBeVisible();

    // Should show email field but not password
    await expect(dialog.getByLabel('Email')).toBeVisible();
    await expect(dialog.locator('#password')).not.toBeVisible();

    const sendButton = dialog.getByRole('button', { name: /Send Reset Link/i });
    await expect(sendButton).toBeVisible();
  });

  test('can navigate back to sign in from forgot password', async ({ page }) => {
    await page.locator('header').getByRole('button', { name: /Sign In/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Forgot Password/i }).click();

    const backLink = dialog.getByRole('button', { name: /Sign in/i });
    await backLink.click();

    await expect(dialog.getByText('Enter your credentials to access your account.')).toBeVisible();
  });

  test('can navigate back to sign in from sign up', async ({ page }) => {
    await page.locator('header').getByRole('button', { name: /Sign In/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Sign up/i }).click();
    await expect(dialog.getByText('Create Account', { exact: true }).first()).toBeVisible();

    const backLink = dialog.getByRole('button', { name: /Sign in/i });
    await backLink.click();

    await expect(dialog.getByText('Enter your credentials to access your account.')).toBeVisible();
  });

  test('password visibility toggle works', async ({ page }) => {
    await page.locator('header').getByRole('button', { name: /Sign In/i }).click();

    const dialog = page.getByRole('dialog');
    const passwordInput = dialog.locator('#password');

    // Default should be password type
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Click toggle button (the eye icon button inside the password field)
    const toggleButton = dialog.locator('#password + button, .relative button').first();
    await toggleButton.click();

    await expect(passwordInput).toHaveAttribute('type', 'text');
  });
});
