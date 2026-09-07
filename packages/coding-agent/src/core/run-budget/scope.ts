import { AsyncLocalStorage } from "node:async_hooks";
import { registerModelCallGuard } from "@dst0/p-ai";
import type { RunBudgetLedger } from "./ledger.ts";

export const runBudgetScope = new AsyncLocalStorage<RunBudgetLedger>();

registerModelCallGuard((call) => runBudgetScope.getStore()?.admit(call));
