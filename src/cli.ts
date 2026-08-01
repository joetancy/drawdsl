import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { formatDsl } from "./formatter.js";
import { layoutDocument } from "./layout/index.js";
import { parseDsl } from "./parser.js";
import { renderDrawio } from "./render/drawio.js";

function usage(): void {
  console.error("Usage: npx tsx src/drawdsl.ts input.drawdsl output.drawio\n       npx tsx src/drawdsl.ts --check input.drawdsl\n       npx tsx src/drawdsl.ts --format [--write] input.drawdsl");
  process.exitCode = 2;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, second] = args;
  if (command === "--check") {
    if (!second || args.length !== 2) return usage();
    parseDsl(await readFile(second, "utf8"));
    console.log(`Valid ${second}`);
    return;
  }
  if (command === "--format") {
    const write = second === "--write";
    const input = args[write ? 2 : 1];
    if (!input || args.length !== (write ? 3 : 2)) return usage();
    const source = await readFile(input, "utf8");
    parseDsl(source);
    const formatted = formatDsl(source);
    if (write) { await writeFile(input, formatted, "utf8"); console.log(`Formatted ${input}`); }
    else process.stdout.write(formatted);
    return;
  }
  if (!command || !second || args.length !== 2) return usage();
  const ast = parseDsl(await readFile(command, "utf8"));
  const result = await layoutDocument(ast);
  await writeFile(second, renderDrawio(result.nodes, result.edges), "utf8");
  console.log(`Created ${second}`);
}
