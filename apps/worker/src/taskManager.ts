import {sleep, Worker} from "./index";
import crypto from "node:crypto";
import { farmCoords, coords } from "./constants"
import type { TaskMessage, TaskResultMessage } from "../../../shared/taskTypes";

export class TaskManager {
    constructor(private readonly worker: Worker) {}

    // @ts-ignore
    async handleTask(task: TaskMessage): Promise<TaskResultMessage> {
        for (let i = 0; i < (task.payload.rounds || 1); i++) {
            if (task.type === "farm") {
                await this.handleFarmTask(task)
            } else {
                return {
                    resultId: crypto.randomUUID(),
                    taskId: task.taskId,
                    workerId: this.worker.name,
                    status: "failed",
                    payload: {
                        acceptedTaskType: task.type,
                        reason: "Task not found"
                    }
                }
            }
        }

        return {
            resultId: crypto.randomUUID(),
            taskId: task.taskId,
            workerId: this.worker.name,
            status: "completed",
            payload: {
                acceptedTaskType: task.type
            }
        }
    }

    private async handleDumpInventory(data: any) {
        this.worker.log("Dumping inventory")
        const moveToBank = await this.worker.api.myCharacters.move(this.worker.name, coords.BANK)
        await sleep(moveToBank.data.cooldown.remaining_seconds * 1000)

        const depositItems = data.data.character.inventory
            .filter((item: { quantity: number; }) => item.quantity > 0)
            .map((item: { code: any; quantity: any; }) => ({
                code: item.code,
                quantity: item.quantity
            }));

        const res = await this.worker.api.myCharacters.depositBankItem(this.worker.name, depositItems)
        await sleep(res.data.cooldown.remaining_seconds * 1000)
    }

    private async handleFarmTask(task: TaskMessage): Promise<TaskResultMessage> {
        const { data: char } = await this.worker.api.characters.get(this.worker.name)
        if (!task.payload.item) {
            return {
                resultId: crypto.randomUUID(),
                taskId: task.taskId,
                workerId: this.worker.name,
                status: "failed",
                payload: {
                    acceptedTaskType: task.type,
                    reason: "Farm task requires a valid item"
                }
            }
        }

        const targetCoords = farmCoords[task.payload.item]

        const isSamePosition =
            targetCoords.x === char.x &&
            targetCoords.y === char.y;

        if (!isSamePosition) {
            this.worker.log(`Moving to ${targetCoords.x}, ${targetCoords.y}`)
            const res = await this.worker.api.myCharacters.move(this.worker.name, {
                x: targetCoords.x,
                y: targetCoords.y
            })

            await sleep(res.data.cooldown.remaining_seconds * 1000)
        }

        this.worker.log(`Gathering ${task.payload.item}`)
        const farm = await this.worker.api.myCharacters.gathering(this.worker.name)
        const inventoryCount =
            farm.data.character.inventory?.reduce(
                (sum, item) => sum + item.quantity,
                0
            ) ?? 0;

        const inventoryMax = farm.data.character.inventory_max_items || 0

        await sleep(farm.data.cooldown.remaining_seconds * 1000)

        if (inventoryCount >= inventoryMax - 2) await this.handleDumpInventory(farm)

        return {
            resultId: crypto.randomUUID(),
            taskId: task.taskId,
            workerId: this.worker.name,
            status: "completed",
            payload: {
                acceptedTaskType: task.type
            }
        }
    }
}
