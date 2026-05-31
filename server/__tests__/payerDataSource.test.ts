import { describe, it, expect } from 'vitest';
import {
  getPayerDataSource,
  NullPayerDataSource,
  PayerDataSourceNotConfiguredError,
} from '../services/payerDataSource';

describe('PayerDataSource (vendor-agnostic seam)', () => {
  it('resolves to the Null adapter by default (no vendor wired)', () => {
    const ds = getPayerDataSource();
    expect(ds.vendor).toBe('null');
    expect(ds.isConfigured()).toBe(false);
  });

  it('Null adapter throws not-configured on every data call', async () => {
    const ds = new NullPayerDataSource();
    await expect(ds.beginConnection({ practiceId: 1, patientId: 1, redirectUri: 'x' }))
      .rejects.toBeInstanceOf(PayerDataSourceNotConfiguredError);
    await expect(ds.completeConnection({ code: 'a', state: 'b', expectedState: 'b' }))
      .rejects.toBeInstanceOf(PayerDataSourceNotConfiguredError);
    await expect(ds.fetchCoverage('c')).rejects.toBeInstanceOf(
      PayerDataSourceNotConfiguredError,
    );
    await expect(ds.fetchExplanationOfBenefits('c')).rejects.toBeInstanceOf(
      PayerDataSourceNotConfiguredError,
    );
    await expect(ds.revokeConnection('c')).rejects.toBeInstanceOf(
      PayerDataSourceNotConfiguredError,
    );
  });

  it('not-configured error names the attempted operation', async () => {
    const ds = new NullPayerDataSource();
    await expect(ds.fetchCoverage('c')).rejects.toThrow(/fetchCoverage/);
  });
});
