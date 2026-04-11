import crypto from "node:crypto";
import { createClient } from "redis";
import { loadEnv } from "../../../shared/loadEnv";
import type { TaskMessage, TaskResultMessage, WorkerState } from "../../../shared/taskTypes";

loadEnv();

const orchestratorId = process.env.HOSTNAME || "orchestrator";
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const taskPrefix = process.env.TASK_CHANNEL_PREFIX || "artifactsmmo:tasks";
const resultsChannel = process.env.RESULTS_CHANNEL || "artifactsmmo:results";
const workerStatePrefix = process.env.WORKER_STATE_PREFIX || "artifactsmmo:workers";
const intervalMs = Number(process.env.TASK_INTERVAL_MS || 5000);
const configuredTargets = (process.env.WORKER_TARGETS || "")
  .split(",")
  .map((target) => target.trim())
  .filter(Boolean);

const publisher = createClient({ url: redisUrl });
const subscriber = createClient({ url: redisUrl });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAvailableWorkers(): Promise<string[]> {
  const discoveredWorkerKeys = await publisher.keys(`${workerStatePrefix}:*`);
  const discoveredWorkerIds = discoveredWorkerKeys
    .map((key) => key.slice(`${workerStatePrefix}:`.length))
    .filter(Boolean);
  const targets = configuredTargets.length > 0 ? configuredTargets : discoveredWorkerIds;

  const states = await Promise.all(
    targets.map(async (workerId) => {
      const key = `${workerStatePrefix}:${workerId}`;
      const state = await publisher.hGetAll(key);

      return {
        workerId,
        status: state.status === "busy" ? "busy" : "idle",
        currentJob: state.currentJob || ""
      } as WorkerState;
    })
  );

  return states
    .filter((worker) => worker.status === "idle" && !worker.currentJob)
    .map((worker) => worker.workerId);
}

async function publishTask(task: TaskMessage): Promise<any> {
  return await publisher.publish(`${taskPrefix}:${task.target}`, JSON.stringify(task));
}

async function main(): Promise<void> {
  await publisher.connect();
  await subscriber.connect();

  // Alle Worker schicken ihre Job-Ergebnisse an einen gemeinsamen Rueckkanal.
  await subscriber.subscribe(resultsChannel, (message) => {
    const result = JSON.parse(message) as TaskResultMessage;

    console.log(
      `[orchestrator] worker ${result.workerId} completed ${result.taskId} (${result.status})`
    );
  });

  console.log(`[orchestrator] connected to ${redisUrl}`);

  await sleep(3000)

  let freeWorkers = await getAvailableWorkers()
  console.log(`[orchestrator] free workers: ${freeWorkers.join(", ") || "none"}`);

  if (freeWorkers.length === 0) {
    return;
  }

  const tasks: TaskMessage[] = []

  tasks.push({
    taskId: crypto.randomUUID(),
    orchestratorId,
    target: "olli",
    type: "farm",
    payload: {
      item: "SUNFLOWERS",
      rounds: 1000
    }
  })

  tasks.push({
    taskId: crypto.randomUUID(),
    orchestratorId,
    target: "olli-2",
    type: "farm",
    payload: {
      item: "GUDGEON",
      rounds: 1000
    }
  })

  tasks.push({
    taskId: crypto.randomUUID(),
    orchestratorId,
    target: "olli-3",
    type: "farm",
    payload: {
      item: "COPPER_ORE",
      rounds: 1000
    }
  })

  tasks.push({
    taskId: crypto.randomUUID(),
    orchestratorId,
    target: "olli-4",
    type: "farm",
    payload: {
      item: "ASH_WOOD",
      rounds: 1000
    }
  })

  tasks.push({
    taskId: crypto.randomUUID(),
    orchestratorId,
    target: "olli-5",
    type: "farm",
    payload: {
      item: "ASH_WOOD",
      rounds: 1000
    }
  })

  for (const task of tasks) {
    await publishTask(task)
    console.log(
        `[orchestrator] sent Task: `, tasks[0]
    )
  }
  // while (true) {
  //   const freeWorkers = await getAvailableWorkers();
  //
  //   console.log(`[orchestrator] free workers: ${freeWorkers.join(", ") || "none"}`);
  //
  //
  //
  //   // for (const target of freeWorkers) {
  //   //   const task: TaskMessage = {
  //   //     taskId: crypto.randomUUID(),
  //   //     orchestratorId,
  //   //     target,
  //   //     type: "demo.collect",
  //   //     payload: {
  //   //       round,
  //   //       note: `Demo task for ${target}`
  //   //     }
  //   //   };
  //
  //     // Der Orchestrator published direkt auf den Channel des Ziel-Workers.
  //     await publisher.publish(`${taskPrefix}:${target}`, JSON.stringify(task));
  //     console.log(`[orchestrator] sent ${task.taskId} to ${target}`);
  //     round += 1;
  //   }

    // await sleep(intervalMs);
  // }
}

main().catch((error) => {
  console.error("[orchestrator] crashed", error);
  process.exit(1);
});
