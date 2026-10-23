import { describe, expect, it } from 'vitest';
import { hashCartOwnerToken } from '@/lib/server/commerce/cartOwner';

describe('cart owner hash', () => {
  it('is stable and hex-shaped', () => {
    const a = hashCartOwnerToken('abc123tokenvalue');
    const b = hashCartOwnerToken('abc123tokenvalue');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differs for different tokens', () => {
    expect(hashCartOwnerToken('one')).not.toBe(hashCartOwnerToken('two'));
  });
});
