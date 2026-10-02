import { describe, expect, it } from 'vitest';
import { ticketBody, ticketProblems, type Ticket } from './ticket.js';

const bug: Ticket = {
  type: 'bug',
  title: 'Save does nothing',
  summary: 'Clicking Save on the editor does nothing.',
  actual: 'Nothing happens.',
  expected: 'The draft is saved.',
  steps: ['Open a draft', 'Click Save'],
  frequency: 'Every time',
  severity: 'major',
  code_findings: 'src/Toolbar.tsx:42 keeps Save disabled until the form is dirty.',
};

describe('ticketProblems', () => {
  it('accepts a ticket that has what its type needs', () => {
    expect(ticketProblems({ ...bug })).toEqual([]);
    expect(
      ticketProblems({ type: 'feature', title: 't', summary: 's', need: 'n', proposal: 'p' }),
    ).toEqual([]);
    expect(
      ticketProblems({
        type: 'suggestion',
        title: 't',
        summary: 's',
        current: 'c',
        proposal: 'p',
        benefit: 'b',
      }),
    ).toEqual([]);
    expect(ticketProblems({ type: 'question', title: 't', summary: 's', question: 'q' })).toEqual(
      [],
    );
  });

  it('names what each type is still missing', () => {
    expect(
      ticketProblems({ type: 'bug', title: 't', summary: 's', actual: 'a', steps: [] }),
    ).toEqual(['missing for a bug: expected, steps, severity']);
    expect(ticketProblems({ type: 'feature', title: 't', summary: ' ', proposal: 'p' })).toEqual([
      'missing for a feature request: summary, need',
    ]);
  });

  it('rejects an unknown type, severity or shape', () => {
    expect(ticketProblems({ type: 'chore' })).toEqual([
      'type must be one of bug, feature, suggestion, question',
    ]);
    expect(ticketProblems({ ...bug, severity: 'meh' })).toEqual([
      'severity must be one of blocker, major, minor',
    ]);
    expect(ticketProblems({ ...bug, steps: 'click' })).toEqual([
      'missing for a bug: steps',
      'steps must be a list of strings',
    ]);
    expect(ticketProblems({ ...bug, steps: ['open', { click: 'Save' }] })).toEqual([
      'steps must be a list of strings',
    ]);
    expect(ticketProblems({ ...bug, code_findings: ['a.ts:1'], workaround: 3 })).toEqual([
      'workaround, code_findings must be text',
    ]);
  });
});

describe('ticketBody', () => {
  it('writes a bug as what happens, what should, steps, and where in the code', () => {
    expect(ticketBody(bug)).toBe(
      [
        '**Bug** · severity: major · reported with Klipp',
        '',
        'Clicking Save on the editor does nothing.',
        '',
        '### What happens',
        '',
        'Nothing happens.',
        '',
        '### What should happen',
        '',
        'The draft is saved.',
        '',
        '### Steps to reproduce',
        '',
        '1. Open a draft',
        '2. Click Save',
        '',
        '**How often:** Every time',
        '',
        '### In the code',
        '',
        'src/Toolbar.tsx:42 keeps Save disabled until the form is dirty.',
      ].join('\n'),
    );
  });

  it('writes a feature request around the need, leaving out what is empty', () => {
    expect(
      ticketBody({
        type: 'feature',
        title: 't',
        summary: 'Export to CSV.',
        need: 'Reports go to Excel.',
        proposal: 'An export button.',
      }),
    ).toBe(
      [
        '**Feature request** · reported with Klipp',
        '',
        'Export to CSV.',
        '',
        '### The need',
        '',
        'Reports go to Excel.',
        '',
        '### What would help',
        '',
        'An export button.',
      ].join('\n'),
    );
  });
});
