export const LIFECYCLE_STATES = [
  'inbox','spec_d','planned','implementing','review',
  'pr_open','merged','blocked','rejected','failed','changes_requested',
] as const;

export type LifecycleState = typeof LIFECYCLE_STATES[number];

const TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  inbox:              ['spec_d','rejected','blocked'],
  spec_d:             ['planned','rejected','blocked'],
  planned:            ['implementing','rejected','blocked'],
  implementing:       ['review','failed','blocked'],
  review:             ['pr_open','changes_requested','blocked','rejected'],
  pr_open:            ['merged','changes_requested','blocked','rejected'],
  merged:             [],
  blocked:            ['inbox','spec_d','planned','implementing','review','pr_open','rejected'],
  rejected:           [],
  failed:             ['implementing','rejected','blocked'],
  changes_requested:  ['implementing','blocked','rejected'],
};

export function isValidTransition(from: LifecycleState, to: LifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedNext(from: LifecycleState): readonly LifecycleState[] {
  return TRANSITIONS[from];
}
