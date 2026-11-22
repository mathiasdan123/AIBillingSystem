import { describe, it, expect } from 'vitest';
import { apiErrorMessage } from '../apiError';

describe('apiErrorMessage', () => {
  it('pulls the server message out of apiRequest\'s "<status>: <json>" error', () => {
    expect(apiErrorMessage(new Error('500: {"message":"Failed to delete claim"}'), 'x')).toBe('Failed to delete claim');
    expect(apiErrorMessage(new Error('409: {"message":"This claim still has linked payment postings, so it can\'t be deleted.","code":"has_linked_records"}'), 'x'))
      .toBe("This claim still has linked payment postings, so it can't be deleted.");
  });
  it('accepts an {error} body and plain text', () => {
    expect(apiErrorMessage(new Error('400: {"error":"Unsupported API version"}'), 'x')).toBe('Unsupported API version');
    expect(apiErrorMessage(new Error('502: Bad Gateway'), 'x')).toBe('Bad Gateway');
    expect(apiErrorMessage(new Error('Submission is taking too long.'), 'x')).toBe('Submission is taking too long.');
  });
  it('falls back when there is nothing usable', () => {
    expect(apiErrorMessage(new Error(''), 'Please try again.')).toBe('Please try again.');
    expect(apiErrorMessage(new Error('500: {"detail":1}'), 'Please try again.')).toBe('{"detail":1}');
    expect(apiErrorMessage(undefined, 'Please try again.')).toBe('Please try again.');
  });
});
