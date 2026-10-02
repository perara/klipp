/** The coding agents Klipp can run in the background, with your own login. */
export type AgentId = 'claude' | 'codex';

export interface AgentInfo {
  id: AgentId;
  label: string;
  available: boolean;
}

export interface AgentsResponse {
  agents: AgentInfo[];
  preferred: AgentId;
}

/** A short reference to another element on the page. */
export interface ElementRef {
  id: string;
  tag: string;
  component?: string;
}

/** What Klipp knows about one element. Structure and state, never its text. */
export interface ElementContext {
  /** The Klipp ID, or '' when nothing at or above it was stamped by the build. */
  id: string;
  tag: string;
  attributes: string[];
  states: string[];
  box: string;
  code?: {
    file: string;
    line: number;
    column: number;
    component: string;
    permalink?: string;
    changedLocally?: boolean;
  };
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
export const CLIENT_TOOLS = ['point_at_element', 'inspect_element', 'propose_issue'] as const;
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

export interface IssueDraft {
  title: string;
  body: string;
}

export type IssueResponse = { url: string } | { error: string };
