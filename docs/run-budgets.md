# Run budgets

## Contract and implementation plan

A run budget belongs to a session/task, not to a model context window or one
assistant message. The application asks for an explicit choice before its first
model call, including project-instruction compilation. `Unlimited` is a saved,
first-class choice. It never installs a hidden continuation or turn ceiling.
SDK callers can supply a policy; omission uses Unlimited for a new task and
retains a persisted policy when resuming. SDK use does not open a terminal picker.

The limited policy selects one positive amount: model requests, cumulative
tokens, or estimated USD. Continue, retry, compaction, model changes, and tree
navigation retain spend. An explicitly created new session or fork starts a new
scope. Changing policy preserves accumulated spend and never resumes work.

Implementation sequence:

1. Intercept public text and image model dispatch with a browser-safe admission
   interface; establish the session scope before SDK compilation.
2. Keep a separate durable ledger, reserve before dispatch, settle exactly once,
   and retain unresolved spend after a crash. Do not derive spend from messages.
3. Reuse the application's selectors for first-use choice and `/budget`; support
   explicit command-line configuration and actionable noninteractive errors.
4. Test admission, streaming, crash recovery, concurrency, resume, auxiliary
   calls, and UI cancellation with faux providers; obtain adversarial review.
5. Run the full repository gates, installed UI smoke, and exact-head CI before
   claiming this feature or the release is complete.

This plan is not a claim that every gate has passed.

## Design alternatives

- Plumbing a separate client through every helper is explicit, but compiler,
  extraction, verification, and future direct calls can accidentally bypass it.
- A browser-safe dispatch guard resolved through coding-agent async-local scope
  covers existing public helpers without a mutable global current session. This
  is the selected approach. Receipts capture the admitted scope permanently.
- Provider-specific transport hooks could count physical network attempts, but
  require a wider adapter-by-adapter contract. They are not what this UI counts.

Direct provider exports and caller-supplied transports bypass public dispatch;
SDK integrations must preserve admission explicitly when using those escape
hatches. External tool bills and the independent indexing daemon are not part
of this task's model budget.

## Accounting and honest limits

Requests count model adapter invocations, including application retries and
auxiliary calls. Provider-internal HTTP retries or socket fallback can make more
than one network attempt. Admitted failures and cancellations consume a request;
a pre-aborted call does not. A valid response on the last allowed request can
finish successfully; the budget denies the next admission, not that response.

Tokens count input, output/reasoning, cache read, and cache write once; the 1-hour
cache-write subset is not added twice. Token and USD limits are observed-usage
thresholds: the current response can exceed the remaining amount. They are not
hard provider billing caps. Missing usage blocks further estimated-budget work
instead of being interpreted as free usage. USD requires usable model pricing;
an all-zero custom/local model table is not proof of a free service.

Token/USD policies permit one unresolved call at a time. Concurrent admission is
rejected until that call settles; request budgets and Unlimited permit concurrent
calls. Unknown token/cost totals remain marked incomplete even after switching to
Unlimited. Old sessions without a budget ledger start tracking from their first
budget-aware invocation; earlier helper calls cannot be reconstructed reliably.
The ledger is not a retrospective invoice or an account-wide/day-wide limit.

Pricing is expressed per million tokens with separate input/output/cache rates.
Cache modifiers and upstream billing semantics matter; a subscription or BYOK
gateway showing zero does not establish zero provider cost. See the primary
[Kilo usage and billing contract](https://kilo.ai/docs/gateway/usage-and-billing)
and [Anthropic pricing contract](https://platform.claude.com/docs/en/about-claude/pricing).

Budget state contains identifiers, aggregate counts, and unresolved receipt IDs,
never prompts, response bodies, credentials, or headers. The frequently updated
small state file uses atomic JSON replacement and restrictive permissions;
Brotli is unsuitable for these synchronous transactional reads and updates.

Global preferences are user-owned: repository settings cannot relax a budget.
Save failures must be visible. No-session SDK scopes are explicitly ephemeral.
When recovered spend is uncertain, choosing Unlimited or a request-count budget
is an explicit way to continue without pretending the missing usage is known.

## Configuration and recovery

The initial selector offers **Unlimited** and **Limited**. Limited opens a unit
selector and validates the amount. Escape cancels without constructing the model
runtime. `/budget` and Settings → Task budget reuse the same choices. Changes are
saved as the user default, keep active spend, and do not restart queued work.
`/budget status` displays the current policy and recorded totals without edits.

Automation must supply a saved user default or `--budget unlimited`,
`--budget requests:100`, `--budget tokens:500000`, or `--budget usd:5`. An absent
choice exits with `budget_required` before resources or compilation start.
An explicit CLI policy applies to the current task without changing the saved
default. Errors in JSON mode retain a nonzero process exit status.

SDK callers use `CreateAgentSessionOptions.runBudget` for an explicit policy and
`defaultRunBudget` for a new-task default. `session.runBudget.snapshot()` reports
recorded spend; `setPolicy()` changes the active scope without refunding it.
`run()` scopes direct helper calls made by an SDK integration. CLI extension
initialization and SDK-owned resource loading are scoped before dispatch. Custom
resource loaders initialized by the caller before `createAgentSession()` remain
the caller's responsibility.

Persistent state lives at `<sessionDir>/.budgets/<sessionId>.json`. Resume and
session switching reuse that identity; separate controllers for the same
in-memory SessionManager share a ledger. Do not delete a ledger to recover from
a storage error: restore storage access or make an explicit policy choice when
the existing ledger remains readable. Missing previously observed state fails
closed instead of recreating a fresh allowance.
