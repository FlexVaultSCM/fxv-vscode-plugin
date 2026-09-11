export const LOG_LEVELS = ['off', 'error', 'info', 'debug'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SEVERITY: Record<LogLevel, number> = { off: 0, error: 1, info: 2, debug: 3 };

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}
