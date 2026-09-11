import * as vscode from 'vscode';

import { LOG_SEVERITY, isLogLevel, type LogLevel } from './logLevel';

const DEFAULT_LEVEL: LogLevel = 'info';

/**
 * The extension's single output channel. Every user-visible diagnostic goes
 * here. Nothing in the extension writes to the developer console.
 */
export class Log implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;
  private level: LogLevel;

  constructor(name = 'FlexVault') {
    this.channel = vscode.window.createOutputChannel(name);
    this.level = readConfiguredLevel();
  }

  /** Re-reads `flexvault.logLevel`. Call on a configuration change. */
  refreshLevel(): void {
    this.level = readConfiguredLevel();
  }

  error(message: string): void {
    this.write('error', message);
  }

  info(message: string): void {
    this.write('info', message);
  }

  debug(message: string): void {
    this.write('debug', message);
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private write(level: Exclude<LogLevel, 'off'>, message: string): void {
    if (LOG_SEVERITY[this.level] < LOG_SEVERITY[level]) {
      return;
    }
    this.channel.appendLine(`${new Date().toISOString()} [${level}] ${message}`);
  }
}

function readConfiguredLevel(): LogLevel {
  const configured = vscode.workspace.getConfiguration('flexvault').get<string>('logLevel');
  return isLogLevel(configured) ? configured : DEFAULT_LEVEL;
}
