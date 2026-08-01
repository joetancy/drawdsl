import { hasUnclosedQuote, stripComment } from "./parser.js";

export function formatDsl(source: string): string {
    const output: string[] = [];
    let indent = 0;
    let previousWasBlank = true;
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        let statement = lines[index]!;
        while (hasUnclosedQuote(statement) && index + 1 < lines.length) {
            index += 1;
            statement += `\n${lines[index]!}`;
        }
        const statementLines = statement.split("\n");
        const firstLine = statementLines[0]!.trim();
        if (!firstLine) {
            if (!previousWasBlank) output.push("");
            previousWasBlank = true;
            continue;
        }
        const code = stripComment(statement).trim();
        if (code === "}") indent = Math.max(0, indent - 1);
        output.push(`${"    ".repeat(indent)}${firstLine}`);
        output.push(...statementLines.slice(1));
        previousWasBlank = false;
        if (code.endsWith("{")) indent += 1;
    }
    while (output.at(-1) === "") output.pop();
    return `${output.join("\n")}\n`;
}
