import { describe, it, expect } from 'vitest';
import { validateHandoff } from './handoff.js';

const CANONICAL = `## Handoff
- **From:** BackendDev
- **To:** CTO
- **Next state:** review
- **Summary:** did thing
- **Changed files:** a.py
- **Tests:** pytest a.py — 3 passed
- **Risks:** none
- **Blockers:**`;

describe('validateHandoff', () => {
  it('accepts canonical format', () => {
    const r = validateHandoff(CANONICAL);
    expect(r.ok).toBe(true);
  });
  it('rejects empty', () => {
    expect(validateHandoff('').ok).toBe(false);
    expect(validateHandoff('   \n').ok).toBe(false);
  });
  it('rejects missing From', () => {
    const bad = CANONICAL.replace('- **From:** BackendDev', '');
    expect(validateHandoff(bad).ok).toBe(false);
  });
  it('rejects missing Next state', () => {
    const bad = CANONICAL.replace('- **Next state:** review', '');
    expect(validateHandoff(bad).ok).toBe(false);
  });
});
