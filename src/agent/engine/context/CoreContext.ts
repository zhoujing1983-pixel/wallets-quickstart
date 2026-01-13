export interface CoreContext {
  requestId: string;
  traceId?: string;
  createdAt: number;

  user: {
    id: string;
    role?: string;
    locale?: string;
  };

  channel: "chat" | "api" | "workflow";
  tenantId?: string;
}
