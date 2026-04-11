import dotenv from "dotenv";
import {ArtifactsApi, ArtifactsError} from "artifacts-api-client";
import {coords} from "./constants.js";

dotenv.config({
    path: "../.env"
})

const api = ArtifactsApi.create({
    token: process.env.TOKEN
})

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

console.log(await api.myCharacters.completeTask("olli"))