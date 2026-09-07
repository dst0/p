import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFixtureFiles, readWorkspaceText } from "./fixture-files.ts";
import { runFixtureCommand } from "./fixture-verification.ts";
import { type BenchmarkTask, createTaskResult } from "./task-definition.ts";

const taskId = "typescript-calculator";
const maxScore = 6;

export const calculatorTask: BenchmarkTask = {
  id: taskId,
  timeoutSeconds: 900,
  maxScore,
  description: "Build a tested TypeScript calculator library and CLI from a written specification",
  files: readFixtureFiles(taskId),
  prompt: `Read requirements.md, package.json, tsconfig.json, and the contract test. Implement the complete TypeScript calculator library and CLI, including a real parser with precedence and unary minus, useful error handling, and your own meaningful unit tests in test/calculator.test.ts. Do not modify the contract test or project configuration. Use the existing toolchain; do not install dependencies. Run npm test, npm run typecheck, and npm run calc -- "2 + 3 * (4 - 1)" before finishing. When all requirements and tests pass, create finish_notes.md summarizing your verification before concluding.`,
  verify(workspace, baseline) {
    const preservedFiles = ["requirements.md", "package.json", "tsconfig.json", "test/calculator.contract.test.ts"];
    const preserved = preservedFiles.every((file) => readWorkspaceText(join(workspace, file)) === baseline[file]);
    const sourceFiles = ["src/calculator.ts", "src/cli.ts"].every((file) => existsSync(join(workspace, file)));
    const ownTest = readWorkspaceText(join(workspace, "test/calculator.test.ts"));
    const ownTests = ownTest !== undefined && /(test|it|describe)\(/.test(ownTest);
    const tests = runFixtureCommand(workspace, ["test"]);
    const typecheck = runFixtureCommand(workspace, ["run", "typecheck"]);
    const cli = runFixtureCommand(workspace, ["run", "calc", "--", "2 + 3 * (4 - 1)"]);
    const testsPass = tests.status === 0;
    const typecheckPasses = typecheck.status === 0;
    const cliOutput = cli.stdout.trim().split(/\r?\n/).at(-1) ?? "";
    const cliWorks = cli.status === 0 && cliOutput === "11";
    return createTaskResult(
      preserved && sourceFiles && ownTests && testsPass && typecheckPasses && cliWorks,
      [
        { name: "requirements, config, and contract preserved", passed: preserved },
        { name: "library and CLI source files exist", passed: sourceFiles },
        { name: "agent added calculator unit tests", passed: ownTests },
        { name: "npm test passes", passed: testsPass },
        { name: "npm run typecheck passes", passed: typecheckPasses },
        { name: "CLI evaluates the acceptance expression", passed: cliWorks },
      ],
      maxScore,
    );
  },
};
