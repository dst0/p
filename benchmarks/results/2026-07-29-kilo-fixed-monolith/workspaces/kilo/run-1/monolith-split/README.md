# Task report repository

This is an existing TypeScript repository. The public API currently lives in src/monolith.ts, which has grown into a large mixed-responsibility module.

Split it into focused modules for parsing, querying, and reporting. Keep src/monolith.ts as a compatibility facade so existing consumers do not change their import path. Preserve behavior, exports, and output. Do not change the contract tests. Add tests for the extracted modules and run npm test and npm run typecheck.
