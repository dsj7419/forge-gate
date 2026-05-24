#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";

import { runCli, type CliIo } from "./cli/run.js";
import type { ValidationReport } from "./validate/findings.js";

const io: CliIo = {
  print: (text) => process.stdout.write(`${text}\n`),
  printError: (text) => process.stderr.write(`${text}\n`),
  writeArtifact: (epicPath: string, report: ValidationReport) => {
    const dir = path.join(epicPath, ".forge");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "validation-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  },
};

process.exit(runCli(process.argv.slice(2), io));
