export interface CliCommand {
  op: string;
  topicId?: string;
  nodeId?: string;
  eventId?: string;
  data?: unknown;
  search?: string;
  archived?: boolean;
  workspaceId?: string;
  expectUpdatedAt?: number;
}
export interface CliReceipt { requestId: string; fingerprint: string; result: Record<string, unknown>; recordedAt?: number }
export interface CliEnvelope { requestId: string; fingerprint: string; dryRun?: boolean; command: CliCommand }
export interface CliBridge {
  onCliRequest: (callback: (request: { id: string; envelope: CliEnvelope }) => void) => () => void;
  replyCliRequest: (id: string, result: unknown) => void;
  researchCliInfo: () => Promise<{ command: string; connectionFile: string; ready: boolean }>;
}
