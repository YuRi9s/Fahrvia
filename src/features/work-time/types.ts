export type ClockAction = "start" | "pause" | "resume" | "finish";
export type ClockCommand = {
  action: ClockAction;
  requestId: string;
  entryId?: string;
  expectedVersion?: number;
};
export type ClockSnapshot = {
  serverNow: string;
  blockedByManualEntry: boolean;
  entry: null | {
    id: string;
    state: "RUNNING" | "PAUSED" | "FINISHED";
    startAt: string;
    endAt: string | null;
    breakStartedAt: string | null;
    breakMilliseconds: number;
    version: number;
    events: { id: string; action: ClockAction; occurredAt: string }[];
  };
};
