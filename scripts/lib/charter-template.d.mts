/** Types for the generic charter template merge helper used by scripts and tests. */
export const TEMPLATE_ROOT: string
export interface ApplyResult {
  target: string
  added: string[]
  kept: string[]
  dryRun: boolean
}
export function listTemplateFiles(root?: string): string[]
export function applyCharterTemplate(target: string, options?: { root?: string; dryRun?: boolean }): ApplyResult
export function capabilitySection(): string
