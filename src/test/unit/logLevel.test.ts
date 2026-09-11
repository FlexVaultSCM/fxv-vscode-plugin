import { describe, expect, it } from 'vitest';

import { LOG_LEVELS, LOG_SEVERITY, isLogLevel } from '../../ui/logLevel';

describe('isLogLevel', () => {
  it('accepts every declared level', () => {
    for (const level of LOG_LEVELS) {
      expect(isLogLevel(level)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isLogLevel('verbose')).toBe(false);
    expect(isLogLevel(undefined)).toBe(false);
    expect(isLogLevel(2)).toBe(false);
  });
});

describe('LOG_SEVERITY', () => {
  it('orders the levels so a lower configured level suppresses a higher one', () => {
    expect(LOG_SEVERITY.off).toBeLessThan(LOG_SEVERITY.error);
    expect(LOG_SEVERITY.error).toBeLessThan(LOG_SEVERITY.info);
    expect(LOG_SEVERITY.info).toBeLessThan(LOG_SEVERITY.debug);
  });

  it('covers every declared level', () => {
    expect(Object.keys(LOG_SEVERITY).sort()).toEqual([...LOG_LEVELS].sort());
  });
});
