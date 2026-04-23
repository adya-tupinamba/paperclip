export type HandoffResult = { ok: true } | { ok: false; reason: string };

const REQUIRED_FIELDS = ['From:', 'To:', 'Next state:', 'Summary:', 'Changed files:', 'Tests:'];

export function validateHandoff(md: string | null | undefined): HandoffResult {
  if (!md || !md.trim()) return { ok: false, reason: 'empty' };
  for (const field of REQUIRED_FIELDS) {
    if (!md.includes(field)) return { ok: false, reason: `missing ${field}` };
  }
  return { ok: true };
}
