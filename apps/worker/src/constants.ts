import type { FarmItem } from "../../../shared/taskTypes";

export type Coordinate = {
    x: number;
    y: number;
};

export const coords = {
    ALCHEMY: { x: 2, y: 3},
    MERCHANT: {
        TIMBER: { x: 2, y: 4 },
    },
    TASK_MASTER: {
        FOREST: { x: 4, y: 13 },
        CITY: { x: 1, y: 2 },
    },
    BANK: { x: 4, y: 1 },
    SUNFLOWERS: { x: 2, y: 2 },
    COPPER_ORE: { x: 2, y: 0 },
    IRON_ORE: { x: 1, y: 7 },
    GUDGEON: { x: 4, y: 2 },
    ASH_WOOD: { x: 6, y: 1 },
    CHICKEN: { x: 0, y: 1 },
    YELLOW_SLIME: { x: 1, y: -2 },
    SHRIMP: { x: 5, y: 2 },
} as const;

export const farmCoords = {
    SUNFLOWERS: coords.SUNFLOWERS,
    COPPER_ORE: coords.COPPER_ORE,
    IRON_ORE: coords.IRON_ORE,
    GUDGEON: coords.GUDGEON,
    ASH_WOOD: coords.ASH_WOOD,
    CHICKEN: coords.CHICKEN,
    YELLOW_SLIME: coords.YELLOW_SLIME,
    SHRIMP: coords.SHRIMP,
} satisfies Record<FarmItem, Coordinate>;
