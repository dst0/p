# Benchmark Results: P v110, v111, v112

## Task: Event-Sourced Inventory

Build a transactional event-sourced inventory engine with concurrency, idempotency, replay, and tamper detection.

## Model: mini-pc/sokann-qwen-27b-cache

## Summary Table

| Version | Status    | Quality Score | Checks Passed | Elapsed         |
| ------- | --------- | ------------- | ------------- | --------------- |
| 0.4.110 | timed_out | 2/100         | 1/30          | 1800s (timeout) |
| 0.4.111 | timed_out | 2/100         | 1/30          | 1800s (timeout) |
| 0.4.112 | failed    | 2/100         | 1/30          | <1800s          |

## Detailed Check Results (All Versions Identical)

| Check                                                | Weight | v110 | v111 | v112 |
| ---------------------------------------------------- | ------ | ---- | ---- | ---- |
| README, config, and contract preserved               | 2      | ✅   | ✅   | ✅   |
| index, engine, and store modules exist               | 5      | ❌   | ❌   | ❌   |
| agent added substantial inventory tests              | 2      | ❌   | ❌   | ❌   |
| visible npm test passes                              | 8      | ❌   | ❌   | ❌   |
| npm run typecheck passes                             | 6      | ❌   | ❌   | ❌   |
| exact retry returns the original result              | 2      | ❌   | ❌   | ❌   |
| exact retry appends nothing and preserves version    | 2      | ❌   | ❌   | ❌   |
| changed retry with same command ID is rejected       | 3      | ❌   | ❌   | ❌   |
| cross-command command ID reuse is rejected           | 3      | ❌   | ❌   | ❌   |
| failed batch rolls back every SKU state              | 4      | ❌   | ❌   | ❌   |
| failed batch leaves the log unchanged                | 4      | ❌   | ❌   | ❌   |
| failed batch does not consume command IDs            | 4      | ❌   | ❌   | ❌   |
| successful batch commits ordered cross-SKU effects   | 3      | ❌   | ❌   | ❌   |
| reservation cannot oversell available inventory      | 2      | ❌   | ❌   | ❌   |
| release cannot exceed an order reservation           | 2      | ❌   | ❌   | ❌   |
| shipment cannot exceed an order reservation          | 2      | ❌   | ❌   | ❌   |
| valid release and ship preserve inventory invariants | 3      | ❌   | ❌   | ❌   |
| returned state is deeply isolated                    | 2      | ❌   | ❌   | ❌   |
| returned history is deeply isolated                  | 2      | ❌   | ❌   | ❌   |
| versions and global positions remain contiguous      | 3      | ❌   | ❌   | ❌   |
| JSONL export is deterministic and newline terminated | 2      | ❌   | ❌   | ❌   |
| manifest count and head hash are valid               | 3      | ❌   | ❌   | ❌   |
| event hashes form a valid predecessor chain          | 4      | ❌   | ❌   | ❌   |
| restore exports byte-identical JSONL                 | 3      | ❌   | ❌   | ❌   |
| restore continues positions and hash links           | 4      | ❌   | ❌   | ❌   |
| content tampering is rejected                        | 5      | ❌   | ❌   | ❌   |
| final-byte truncation is rejected                    | 5      | ❌   | ❌   | ❌   |
| data after the manifest is rejected                  | 4      | ❌   | ❌   | ❌   |
| invalid input consumes no ID or position             | 2      | ❌   | ❌   | ❌   |
| stale batch consumes no IDs or positions             | 4      | ❌   | ❌   | ❌   |

## Workspace Output

- **v110**: No `src/` directory created. Only contract test preserved.
- **v111**: Partial output — `src/store.ts` and `src/types.ts` created but incomplete.
- **v112**: No `src/` directory created. Only contract test preserved.

## Notes

All three versions failed to produce working code for the event-sourced inventory task. The only check passed across all versions is "README, config, and contract preserved" (2 points), meaning the fixture files were left untouched but no implementation was generated.

v110 and v111 timed out after 1800 seconds without completing the task. v112 failed before timeout with incomplete output.

v111 showed slightly more progress (created 2 source files) but still did not produce a working implementation.
