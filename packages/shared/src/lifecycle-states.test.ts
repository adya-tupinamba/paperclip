import { describe, it, expect } from 'vitest';
import { isValidTransition, LIFECYCLE_STATES } from './lifecycle-states.js';

describe('lifecycle states', () => {
  it('exposes 11 states', () => {
    expect(LIFECYCLE_STATES.length).toBe(11);
  });

  it('permits inbox → spec_d', () => {
    expect(isValidTransition('inbox', 'spec_d')).toBe(true);
  });

  it('rejects inbox → merged (skip states)', () => {
    expect(isValidTransition('inbox', 'merged')).toBe(false);
  });

  it('permits any state → blocked', () => {
    expect(isValidTransition('implementing', 'blocked')).toBe(true);
    expect(isValidTransition('review', 'blocked')).toBe(true);
  });

  it('rejects merged → anything (terminal)', () => {
    expect(isValidTransition('merged', 'inbox')).toBe(false);
    expect(isValidTransition('merged', 'pr_open')).toBe(false);
  });

  it('permits review → changes_requested → implementing', () => {
    expect(isValidTransition('review', 'changes_requested')).toBe(true);
    expect(isValidTransition('changes_requested', 'implementing')).toBe(true);
  });
});
