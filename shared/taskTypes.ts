export const FARM_ITEMS = [
  "SUNFLOWERS",
  "COPPER_ORE",
  "GUDGEON",
  "ASH_WOOD",
  "CHICKEN",
  "YELLOW_SLIME"
] as const;

export type FarmItem = (typeof FARM_ITEMS)[number];

export type TaskStatus = "completed" | "failed" | "cancelled" | "timeout" | "unknown";
export type WorkerStatus = "idle" | "busy";

export type TaskPayload = {
  item?: FarmItem;
  amount?: number;
  rounds?: number;
};

export type TaskMessage = {
  taskId: string;
  orchestratorId: string;
  target: string;
  type: string;
  payload: TaskPayload;
};

export type TaskResultMessage = {
  resultId: string;
  taskId: string;
  workerId: string;
  status: TaskStatus;
  payload: {
    acceptedTaskType: string;
    reason?: string;
  };
};

export type WorkerState = {
  workerId: string;
  status: WorkerStatus;
  currentJob: string;
};
