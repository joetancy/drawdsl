import { DRAWIO_RESOURCES } from "../src/generated/drawio-resources.js";

const query = process.argv.slice(2).join(" ").toLowerCase();
if (!query) throw new Error("Usage: npm run resources:search -- <query>");
const matches = Object.entries(DRAWIO_RESOURCES).filter(([id, item]) => `${id} ${item.title} ${item.tags.join(" ")} ${item.drawioShape}`.toLowerCase().includes(query));
for (const [id, item] of matches) console.log(`${id}\n  ${item.title}\n  ${item.drawioShape}`);
if (!matches.length) process.exitCode = 1;
