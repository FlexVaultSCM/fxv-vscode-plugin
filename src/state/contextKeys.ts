import type { StatusPayload } from '../cli/types.generated';

export type SetContextFn = (key: string, value: unknown) => Thenable<unknown> | Promise<unknown>;

/**
 * Sole owner of setContext across the extension.
 * Keeps context key names and value types in one place.
 */
export class ContextKeys {
  private readonly cache = new Map<string, unknown>();

  constructor(private readonly setContext: SetContextFn) {}

  private async updateKey(key: string, value: unknown): Promise<void> {
    if (this.cache.has(key) && this.cache.get(key) === value) {
      return;
    }
    this.cache.set(key, value);
    await this.setContext(key, value);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.updateKey('flexvault.enabled', enabled);
  }

  async setLoggedIn(loggedIn: boolean): Promise<void> {
    await this.updateKey('flexvault.loggedIn', loggedIn);
  }

  async setHasConflicts(hasConflicts: boolean): Promise<void> {
    await this.updateKey('flexvault.hasConflicts', hasConflicts);
  }

  async setBusy(busy: boolean): Promise<void> {
    await this.updateKey('flexvault.busy', busy);
  }

  async setInterrupted(interrupted: boolean): Promise<void> {
    await this.updateKey('flexvault.interrupted', interrupted);
  }

  async setHeadState(
    headState: 'empty_branch' | 'unparented_draft' | 'parented_draft' | undefined,
  ): Promise<void> {
    await this.updateKey('flexvault.headState', headState);
  }

  async setCliIncompatible(incompatible: boolean): Promise<void> {
    await this.updateKey('flexvault.cliIncompatible', incompatible);
  }

  /**
   * Derive context keys from the latest status snapshot.
   * Null or undefined status resets status-derived keys to their safe defaults.
   */
  async updateFromStatus(status: StatusPayload | undefined): Promise<void> {
    if (!status) {
      await this.setLoggedIn(false);
      await this.setHasConflicts(false);
      await this.setHeadState(undefined);
      return;
    }

    const loggedIn = status.current_user !== undefined && status.current_user !== null;
    const hasConflicts = status.files.some(
      (f) => f.conflict_state !== undefined && f.conflict_state !== null,
    );
    const headState = status.head_commit?.state;

    await this.setLoggedIn(loggedIn);
    await this.setHasConflicts(hasConflicts);
    await this.setHeadState(headState);
    await this.setInterrupted(false);
  }
}
