/**
 * The logging surface `src/cli/` depends on. `ui/log.ts` satisfies it, and a
 * test can satisfy it without the editor host.
 */
export interface Logger {
  error(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}
