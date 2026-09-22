import { describe, it, expect } from 'vitest';
import { enrichApprovalPageContext } from '../lib/bots/botApprovalScreenshot';

describe('botApprovalScreenshot (pass-through — no VM)', () => {
  it('returns the page context unchanged', () => {
    const page = { url: 'https://example.com/pay', targetText: 'Pay' };
    expect(enrichApprovalPageContext('m1', page)).toBe(page);
  });
});
