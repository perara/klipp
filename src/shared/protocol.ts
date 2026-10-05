import type { TicketType } from './ticket.js';

/** The coding agents Klipp can run in the background, with your own login. */
export type AgentId = 'claude' | 'codex';

export interface AgentInfo {
  id: AgentId;
  label: string;
  available: boolean;
  /** Why it isn't, when it isn't: not installed, or a sandbox this machine won't run. */
  problem?: string;
}

export interface AgentsResponse {
  agents: AgentInfo[];
  preferred: AgentId;
  /** Why no agent can run here at all, such as on Windows. */
  problem?: string;
}

/** A short reference to another element on the page. */
export interface ElementRef {
  id: string;
  tag: string;
  component?: string;
}

/** Code a manifest entry points at. */
export interface CodeLocation {
  file: string;
  line: number;
  column: number;
  component: string;
  permalink?: string;
  changedLocally?: boolean;
}

/** Something drawn on a canvas, as the app's canvas adapter describes it. */
export interface CanvasContext {
  /** Names it on the canvas; the element's id with `@key` names it on the page. */
  key: string;
  label: string;
  details?: Record<string, string | number | boolean>;
  /** The JSX that made it, for react-three-fiber objects. */
  code?: CodeLocation;
}

/** What Klipp knows about one element. Structure and state, never its text. */
export interface ElementContext {
  /** The Klipp ID, or '' when nothing at or above it was stamped by the build. */
  id: string;
  tag: string;
  attributes: string[];
  states: string[];
  box: string;
  code?: CodeLocation;
  /** When the element is a canvas the app registered: what is drawn where the user pointed. */
  canvas?: CanvasContext;
  /** The component call sites that led here, nearest first. */
  renderedBy: Array<{ component: string; usedIn: string; file: string; line: number }>;
  /** Child path into markup the build did not stamp, such as a library's DOM. */
  unstampedPath?: string;
  parent?: ElementRef;
  /** What lies under it at the point it was picked, topmost first. */
  beneath: ElementRef[];
}

/** Sent with every message the user types. */
export interface PageContext {
  /** Query values and non-route fragments blanked. */
  url: string;
  viewport: string;
  colorScheme: string;
  userAgent: string;
  recentErrors: string[];
  failedRequests: string[];
  /** The element the user pointed at, if any. */
  element?: ElementContext;
}

/** Tools the agent calls that need the page or the user; the browser answers them. */
export const CLIENT_TOOLS = ['point_at_element', 'inspect_element', 'propose_ticket'] as const;
export type ClientToolName = (typeof CLIENT_TOOLS)[number];

export interface ClientToolCall {
  id: string;
  name: ClientToolName;
  input: Record<string, unknown>;
}

export interface ClientToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

export interface ChatRequest {
  conversation?: string;
  agent: AgentId;
  text: string;
  page: PageContext;
}

export interface ToolResultRequest extends ClientToolResult {
  conversation: string;
}

/** Streamed back as server-sent events, one JSON object per `data:` line. */
export type ChatEvent =
  | { type: 'conversation'; id: string }
  | { type: 'text'; delta: string }
  /** The next text starts a new reply. */
  | { type: 'break' }
  | { type: 'activity'; label: string }
  | { type: 'client_tool'; call: ClientToolCall }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** What is filed: the ticket the user approved, with the page details appended. */
export interface IssueDraft {
  title: string;
  body: string;
  /** Sets the issue's labels. */
  type?: TicketType;
}

/**
 * Files a ticket the agent proposed and the user approved, once. The server has the ticket;
 * the browser adds the page and element details it showed the user under it.
 */
export interface IssueRequest {
  conversation: string;
  /** The id of the propose_ticket call that is waiting on the user. */
  proposal: string;
  footer: string;
}

/** Pairs another device when `allowRemote` is on, with the code the dev server printed. */
export interface PairRequest {
  code: string;
}

export type IssueResponse = { url: string } | { error: string };
