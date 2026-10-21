import { mkdirSync, writeFileSync } from "node:fs";
import { buildSampleCsv } from "../src/server/sample";

mkdirSync("samples", { recursive: true });
writeFileSync("samples/disputes-today.csv", buildSampleCsv());
console.log("Wrote samples/disputes-today.csv");
