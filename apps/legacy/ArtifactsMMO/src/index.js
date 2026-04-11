// import dotenv from "dotenv";
import {ArtifactsApi, ArtifactsError} from "artifacts-api-client";
import {coords} from "./constants.js";
import config from "../config.json" with { type: "json" };
import pino from "pino";


const lokiTransport = pino.transport({
    target: "pino-loki",
    options: {
        host: "http://loki:3100",
        labels: {
            service: "bot"
        },
        propsToLabels: ["worker"],
        batching: true,
        interval: 5
    }
});

const loggerInstance = pino(
    {
        base: null
    },
    pino.multistream([
        { stream: process.stdout },   // 👈 Konsole
        // { stream: lokiTransport }     // 👈 Loki
    ])
);

// dotenv.config({
//     //path: "../.env"
// })

/**
 * @typedef {Object} LogMessage
 * @property {"info" | "error" | "warn" | "debug"} level
 * @property {string} msg
 * @property {string} [worker]
 * @property {Object} [meta]
 */

/**
 * @param {LogMessage} log
 */
function logger(log) {
    if (!log.level || !log.msg) {
        throw new Error("Invalid log object");
    }

    loggerInstance[log.level](
        {
            worker: log.worker || "test",
            ...log.meta
        },
        log.msg
    );
}

logger({
    level: "info",
    msg: "Starting bot... V0.0.3"
})

const api = ArtifactsApi.create({
    token: process.env.TOKEN
})

const characterKey = process.env.CHARACTER;
const characterConfig = characterKey ? config?.[characterKey] : null;

if (!characterKey) {
    throw new Error("CHARACTER env fehlt.");
}

if (!characterConfig?.name) {
    throw new Error(`Kein gueltiger Config-Eintrag fuer CHARACTER=\"${characterKey}\" gefunden.`);
}

export function sleep(ms) {
    logger({
        level: "info",
        msg: "Waiting before next action",
        meta: {
            seconds: ms / 1000
        }
    })
    return new Promise(resolve => setTimeout(resolve, ms + 500));
}


export function getInventoryCount(character) {
    const inv = character.inventory
    let count = 0;

    for (const item of inv) {
        count += item.quantity;
    }

    return {
        max: character.inventory_max_items,
        count
    }
}

export function getCoordsFromConfigItem() {
    const itemCode = characterConfig?.item;

    if (!itemCode) {
        throw new Error(`config.json enthaelt keinen item-Wert fuer ${characterKey}.`);
    }

    const coordKey = itemCode.trim().replaceAll("-", "_").toUpperCase();
    const itemCoords = coords[coordKey];

    if (!itemCoords) {
        throw new Error(`Keine Koordinaten fuer item="${itemCode}" in ${characterKey} gefunden.`);
    }

    return itemCoords;
}

export async function depositToBank(name) {
    const { data } = await api.myCharacters.move(name, coords.BANK)
    await sleep(data.cooldown.remaining_seconds * 1000)
    logger({
        level: "info",
        msg: "Depositing item to bank",
        meta: {
            name
        }
    })

    const depositItems = data.character.inventory
        .filter(item => item.quantity > 0)
        .map(item => ({
            code: item.code,
            quantity: item.quantity
        }));
    const res = await api.myCharacters.depositBankItem(name, depositItems)
    await sleep(res.data.cooldown.remaining_seconds * 1000)
    return getInventoryCount(res.data.character)
}

async function dumpItems() {
    await depositToBank(characterConfig.name)
}

let running = true;

while (running) {
    try {
        const target_coords = getCoordsFromConfigItem();
        const char = await api.characters.get(characterConfig.name)
        if (char.data.x !==target_coords.x || char.data.y !== target_coords.y ) {
            await api.myCharacters.move(characterConfig.name, target_coords)
        }

        let res

        if (characterConfig?.monster) {
            res = await api.myCharacters.fight(characterConfig.name)
            const cooldownSeconds = res?.data?.cooldown?.remaining_seconds ?? 0;
            await sleep(cooldownSeconds * 1000)
            const character = res?.data?.characters[0];

            if (character.hp < 80) {
                const res = await api.myCharacters.rest(characterConfig.name)
                await sleep(res.data.cooldown.remaining_seconds * 1000)
            }

            const inventoryCount = getInventoryCount(character);

            if (inventoryCount.count >= 95) {
                await dumpItems();
            }
        } else {
            res = await api.myCharacters.gathering(characterConfig.name);
            const cooldownSeconds = res?.data?.cooldown?.remaining_seconds ?? 0;
            await sleep(cooldownSeconds * 1000)
            const character = res?.data?.character;
            const inventoryCount = getInventoryCount(character);

            if (inventoryCount.count >= 98) {
                await dumpItems();
            }
        }
    } catch (e) {
        if (e instanceof ArtifactsError) {
            logger({
                level: "error",
                msg: "ArtifactsError",
                meta: {
                    error: e.message,
                    code: e.code,
                    status: e.status
                }
            })
        } else {
            logger({
                level: "error",
                msg: "Unexpected error",
                meta: {
                    error: e.message
                }
            })
        }

        await sleep(5000);
    }
}
