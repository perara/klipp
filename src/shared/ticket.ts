/** What a report is. Klipp works this out with the user before writing the ticket. */
export const TICKET_TYPES = ['bug', 'feature', 'suggestion', 'question'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const SEVERITIES = ['blocker', 'major', 'minor'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const TYPE_NAMES: Record<TicketType, string> = {
  bug: 'Bug',
  feature: 'Feature request',
  suggestion: 'Suggestion',
  question: 'Question',
};

/** GitHub labels per type; `klipp` marks every ticket Klipp files. Apps can replace them. */
export const DEFAULT_LABELS: Record<TicketType, string[]> = {
  bug: ['bug', 'klipp'],
  feature: ['enhancement', 'klipp'],
  suggestion: ['suggestion', 'klipp'],
  question: ['question', 'klipp'],
};

export interface Ticket {
  type: TicketType;
  title: string;
  /** One to three sentences, in the reporter's terms. */
  summary: string;
  /** Bug. */
  actual?: string;
  expected?: string;
  steps?: string[];
  frequency?: string;
  severity?: Severity;
  /** Feature request. */
  need?: string;
  who_benefits?: string;
  workaround?: string;
  /** Feature request and suggestion. */
  proposal?: string;
  /** Suggestion. */
  current?: string;
  benefit?: string;
  /** Question. */
  question?: string;
  answer?: string;
  /** Where it lives in the code, as path:line, from looking. */
  code_findings?: string;
}

/** Every field but type, steps and severity is text. */
const TEXT_FIELDS: Array<keyof Ticket> = [
  'title',
  'summary',
  'actual',
  'expected',
  'frequency',
  'need',
  'who_benefits',
  'workaround',
  'proposal',
  'current',
  'benefit',
  'question',
  'answer',
  'code_findings',
];

/** What each type needs before it is a ticket the team can act on. */
export const REQUIRED: Record<TicketType, Array<keyof Ticket>> = {
  bug: ['actual', 'expected', 'steps', 'severity'],
  feature: ['need', 'proposal'],
  suggestion: ['current', 'proposal', 'benefit'],
  question: ['question'],
};

/** Steps are a list; everything else is text. */
const filled = (key: string, value: unknown) =>
  key === 'steps'
    ? Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim())
    : typeof value === 'string' && value.trim() !== '';

/**
 * The problems with a proposed ticket, as text for the agent: an unknown type, or the fields
 * its type still needs. Empty when it is ready to show the user.
 */
export function ticketProblems(input: Record<string, unknown>): string[] {
  const type = input.type;
  if (!TICKET_TYPES.includes(type as TicketType)) {
    return [`type must be one of ${TICKET_TYPES.join(', ')}`];
  }
  const missing = (['title', 'summary', ...REQUIRED[type as TicketType]] as string[]).filter(
    (key) => !filled(key, input[key]),
  );
  const problems = missing.length
    ? [`missing for a ${TYPE_NAMES[type as TicketType].toLowerCase()}: ${missing.join(', ')}`]
    : [];
  if (input.severity !== undefined && !SEVERITIES.includes(input.severity as Severity)) {
    problems.push(`severity must be one of ${SEVERITIES.join(', ')}`);
  }
  const steps = input.steps;
  if (steps !== undefined && !(Array.isArray(steps) && steps.every((s) => typeof s === 'string'))) {
    problems.push('steps must be a list of strings');
  }
  const notText = TEXT_FIELDS.filter(
    (key) => input[key] !== undefined && typeof input[key] !== 'string',
  );
  if (notText.length) problems.push(`${notText.join(', ')} must be text`);
  return problems;
}

const section = (heading: string, text: string | undefined) =>
  text?.trim() ? [`### ${heading}`, '', text.trim(), ''] : [];

/** The ticket's Markdown body, before Klipp's page and element details are appended. */
export function ticketBody(ticket: Ticket): string {
  const tags = [
    `**${TYPE_NAMES[ticket.type]}**`,
    ...(ticket.severity ? [`severity: ${ticket.severity}`] : []),
    'reported with Klipp',
  ];
  return `${tags.join(' · ')}\n\n${ticketText(ticket)}`;
}

/** The ticket's own words: the summary and its type's sections, as Markdown. */
export function ticketText(ticket: Ticket): string {
  const lines = [ticket.summary.trim(), ''];
  if (ticket.type === 'bug') {
    lines.push(
      ...section('What happens', ticket.actual),
      ...section('What should happen', ticket.expected),
    );
    const steps = (ticket.steps ?? []).filter((s) => s.trim());
    if (steps.length)
      lines.push('### Steps to reproduce', '', ...steps.map((s, i) => `${i + 1}. ${s.trim()}`), '');
    if (ticket.frequency?.trim()) lines.push(`**How often:** ${ticket.frequency.trim()}`, '');
  } else if (ticket.type === 'feature') {
    lines.push(
      ...section('The need', ticket.need),
      ...section('What would help', ticket.proposal),
      ...section('Who it helps', ticket.who_benefits),
      ...section("How it's done today", ticket.workaround),
    );
  } else if (ticket.type === 'suggestion') {
    lines.push(
      ...section('Today', ticket.current),
      ...section('Suggested change', ticket.proposal),
      ...section('Why', ticket.benefit),
    );
  } else {
    lines.push(
      ...section('The question', ticket.question),
      ...section('What the code says', ticket.answer),
    );
  }
  lines.push(...section('In the code', ticket.code_findings));
  return lines.join('\n').trimEnd();
}

/** The propose_ticket tool's input, as JSON Schema. */
export const TICKET_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: [...TICKET_TYPES],
      description:
        'bug: something does not work as intended. feature: something the app cannot do yet that is needed. suggestion: something that works but could be better. question: how something is meant to work.',
    },
    title: { type: 'string', description: 'Short and specific, as a ticket title.' },
    summary: { type: 'string', description: "One to three sentences, in the reporter's terms." },
    actual: { type: 'string', description: 'Bug: what happens.' },
    expected: { type: 'string', description: 'Bug: what should happen.' },
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Bug: steps to reproduce, in order.',
    },
    frequency: { type: 'string', description: 'Bug: every time, sometimes, once.' },
    severity: {
      type: 'string',
      enum: [...SEVERITIES],
      description: 'Bug: blocker (stops work), major (gets in the way), minor (annoying).',
    },
    need: { type: 'string', description: 'Feature request: the problem or need behind it.' },
    proposal: {
      type: 'string',
      description: 'Feature request or suggestion: what should be built or changed.',
    },
    who_benefits: { type: 'string', description: 'Feature request: who it helps.' },
    workaround: { type: 'string', description: "Feature request: how it's done today." },
    current: { type: 'string', description: 'Suggestion: what is there now.' },
    benefit: { type: 'string', description: 'Suggestion: why the change would be better.' },
    question: { type: 'string', description: 'Question: what the user wants to know.' },
    answer: { type: 'string', description: 'Question: what the code says, if you found it.' },
    code_findings: {
      type: 'string',
      description: 'Where it lives in the code, as path:line, with a sentence each.',
    },
  },
  required: ['type', 'title', 'summary'],
  additionalProperties: false,
};
