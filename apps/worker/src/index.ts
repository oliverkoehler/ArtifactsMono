import crypto from "node:crypto";
import { createClient } from "redis";
import { ArtifactsApi } from "artifacts-api-client";
import {TaskManager} from "./taskManager";
import { loadEnv } from "../../../shared/loadEnv";
import type { TaskMessage, TaskResultMessage } from "../../../shared/taskTypes";

loadEnv();

const workerId = process.env.CHARACTER || process.env.HOSTNAME || "worker";
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const taskPrefix = process.env.TASK_CHANNEL_PREFIX || "artifactsmmo:tasks";
const resultsChannel = process.env.RESULTS_CHANNEL || "artifactsmmo:results";
const workerStatePrefix = process.env.WORKER_STATE_PREFIX || "artifactsmmo:workers";

const subscriber = createClient({ url: redisUrl });
const publisher = createClient({ url: redisUrl });

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Worker {
  get state(): "idle" | "busy" {
    return this._state;
  }

  set state(value: "idle" | "busy") {
    this._state = value;
  }

  name: string;
  api: ArtifactsApi
  directChannel: string
  broadcastChannel: string
  private _state: "idle" | "busy" = "idle";

  constructor(name: string, directChanel: string, broadcastChannel: string) {
    this.name = name;
    this.directChannel = directChanel;
    this.broadcastChannel = broadcastChannel;

    if (!process.env.TOKEN) {
      throw new Error("Cant start worker without TOKEN env var.");
    }

    this.api = ArtifactsApi.create({
      token: process.env.TOKEN || ""
    })
  }

  log(msg: string) {
    console.log(`[worker:${this.name}] - ${msg}`)
  }
}

export async function setWorkerState(status: "idle" | "busy", currentJob = ""): Promise<void> {
  await publisher.hSet(`${workerStatePrefix}:${workerId}`, {
    workerId,
    status,
    currentJob
  });
}

export const worker = new Worker(workerId, "", "")

async function handleTask(message: TaskMessage): Promise<TaskResultMessage> {
  const tm = new TaskManager(worker);

  try {
    return await tm.handleTask(message);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown worker error";

    return {
      resultId: crypto.randomUUID(),
      taskId: message.taskId,
      workerId: worker.name,
      status: "failed",
      payload: {
        acceptedTaskType: message.type,
        reason
      }
    };
  }
}

async function processTask(message: TaskMessage, source: "direct" | "broadcast"): Promise<void> {
  console.log(`New message on ${source} channel:`);
  console.log(message);

  await setWorkerState("busy", message.taskId);
  const result = await handleTask(message);
  await publisher.publish(resultsChannel, JSON.stringify(result));
  console.log(result);
  await setWorkerState("idle");
}


async function main(): Promise<void> {
  const directChannel = `${taskPrefix}:${workerId}`;
  const broadcastChannel = `${taskPrefix}:all`;

  worker.directChannel = directChannel;
  worker.broadcastChannel = broadcastChannel;
  worker.state = "idle";
  worker.name = workerId;

  await subscriber.connect();
  await publisher.connect();
  await setWorkerState("idle");

  await subscriber.subscribe(directChannel, async (message) => {
    await processTask(JSON.parse(message), "direct");
  });

  await subscriber.subscribe(broadcastChannel, async (message) => {
    await processTask(JSON.parse(message), "broadcast");
  });

  if (!process.env.CHARACTER) {
    console.warn(
      `[worker:${workerId}] CHARACTER is not set. Local startup works, but task execution requires a valid character name.`
    );
  }

  console.log(`[worker:${workerId}] connected to ${redisUrl}`);
  console.log(`[worker:${workerId}] listening on ${directChannel} and ${broadcastChannel}`);
}

main().catch((error) => {
  console.error(`[worker:${workerId}] crashed`, error);
  process.exit(1);
});
