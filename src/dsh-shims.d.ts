/**
 * Minimal ambient declarations for the @deepseek-ai/* Cordis plugin APIs used by
 * this plugin. In a real DSH profile checkout these types resolve from the
 * installed packages; this shim only lets `tsc --noEmit` validate the plugin's
 * own logic without pulling the whole monorepo here.
 */

declare module "@deepseek-ai/dsh-commands/brand" {
  export function CommandDefinitionId(id: string): string;
}

declare module "@deepseek-ai/dsh-commands" {
  export interface CommandInvocation {
    commandId: string;
    agent: unknown;
    rawInput: string;
    attachments: unknown[];
    signal: AbortSignal;
  }
  export interface CommandRegistration {
    definitionId: string;
    name: string;
    description: string;
    handler: (invocation: CommandInvocation) => Promise<unknown> | unknown;
  }
  export interface CommandsService {
    register(reg: CommandRegistration): unknown;
  }
}

declare module "@deepseek-ai/dsh-compaction" {
  export class ManualCompactionError extends Error {
    code:
      | "busy"
      | "cancelled"
      | "changed"
      | "summary"
      | "commit"
      | "persistence";
  }
  export interface CompactionEngine {
    compactNow(agent: unknown, signal: AbortSignal, commandId: string): Promise<{
      shadowedSeqs: unknown[];
      shadowedTokenCount: number;
      summarySeq: number;
    } | null>;
    config?: Record<string, unknown>;
  }
}

declare module "@deepseek-ai/dsh-compaction-basic" {
  export const name = "compaction-basic";
}
