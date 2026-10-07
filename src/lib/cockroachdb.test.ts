import { describe, expect, it } from 'bun:test';
import { DATABASE_URL_MISSING, requireDatabaseUrl } from './cockroachdb';

describe('requireDatabaseUrl', () => {
  it('returns a trimmed connection string', () => {
    expect(requireDatabaseUrl('  postgresql://db.example/app  ')).toBe('postgresql://db.example/app');
  });

  it('rejects a missing or blank URL', () => {
    expect(() => requireDatabaseUrl(undefined)).toThrow(DATABASE_URL_MISSING);
    expect(() => requireDatabaseUrl('   ')).toThrow(DATABASE_URL_MISSING);
  });
});
