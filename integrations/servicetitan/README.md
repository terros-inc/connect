# ServiceTitan Appointment Sync

One-way port of the legacy ServiceTitan webhook: Terros Consultation events create or update a ServiceTitan job and its last appointment. The account custom field remains the authoritative job link; the event sourceId also stores it. Links are written as `tenantId:jobId`. A bare numeric job ID in the account field (written by legacy) is still read as this install's tenant and rewritten with the prefix on the next sync. In event sourceId only the prefixed form is trusted, because legacy never wrote it and a bare number there may come from another integration.

## Setup

Disable the customer's legacy **SERVICETITAN** webhook in sales in the same step the Connect install is turned on, so the two never sync the same events. Replace the placeholder appId when provisioning the app. This package is not yet included in the manual publishing workflow; adding it there is a separate release task.

Grant exactly `account:list`, `account:save`, `event:read`, and `event:save`. There is no `account:read` type: sales `account/get` checks visibility with `isAccountViewable`, which reads the `account:list` scopes (`packages/api-canvass/src/account/get.ts:42`, `packages/back-common/src/permissions/accountVisible.ts:22-23`).

Provide install secrets:

| Secret       | Meaning                                 |
| ------------ | --------------------------------------- |
| appKey       | ServiceTitan application key            |
| clientId     | OAuth client ID                         |
| clientSecret | OAuth client secret                     |
| tenantId     | Positive integer ServiceTitan tenant ID |

Configure the script (IDs arrive as strings; numeric IDs must be positive safe integers):

| Field                         | Meaning                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| jobTypeId                     | Required numeric ServiceTitan job type ID                                                                           |
| serviceTitanJobId             | Required Terros **account text custom field** ID, e.g. `CF.servicetitanjob`; must exist and be writable             |
| cancelReasonId                | Required numeric ServiceTitan cancellation reason ID for closer reassignment; no default                            |
| customFieldCustomerId         | Optional numeric ServiceTitan customer custom field type ID; stores the Terros account ID and enables deduplication |
| customFieldLocationId         | Optional numeric ServiceTitan location custom field type ID; stores the Terros account ID                           |
| customFieldSetter             | Optional numeric ServiceTitan job custom field type ID; stores the event owner's name                               |
| customFieldAppointmentOutcome | Optional numeric ServiceTitan job custom field type ID; stores the event status                                     |
| campaignIdSetterGen           | Optional numeric ServiceTitan campaign ID for owner closerStatus Needs_Help                                         |
| campaignIdCloserGen           | Optional numeric ServiceTitan fallback campaign ID                                                                  |
| campaignIdUnknown             | Optional numeric ServiceTitan final fallback campaign ID                                                            |
| teamToBusinessUnitMap         | Optional mapping: ServiceTitan technician team name → numeric ServiceTitan business unit ID                         |

Configure at least one campaign applicable to every owner: Needs_Help uses setterGen if set, otherwise closerGen, otherwise unknown; other statuses use closerGen then unknown. Missing an applicable campaign throws. Unmapped technician teams use the technician's businessUnitId; absence of both throws.

## Flow

1. Skip removes, non-Consultation events, or missing attendee, owner or account.
2. Validate configuration and credentials. Read the full account once; skip accounts whose accountSource is not Terros. Missing location throws.
3. Resolve the job link: the account field first; if it is empty (for example hidden from or inactive for the script's token), a `tenantId:jobId` link in the event sourceId (a bare number there is ignored). A non-empty account field that is not a positive safe integer job ID (bare or `tenantId:`-prefixed) throws an error naming the value instead of creating a new job. A link prefixed with another tenant skips. With neither link, a new job is created (step 6).
4. Find the first technician by attendee.clientUserId when available, otherwise by preferred/first and last name. No match skips; a lookup error fails the run.
5. For a linked job, inspect the first active assignment on lastAppointmentId. A different technician creates a replacement on the same customer/location, saves both links, then cancels the old job with the configured reason and memo “Closer reassigned via automation”. If that cancel fails, the run logs an error starting with `SERVICETITAN_ABANDONED_CANCEL` with the tenant, old and new job IDs, and returns normally; nothing retries it, so the old job must be cancelled by hand. A later run follows the replacement link. If the assignment lookup itself fails, the reassignment check is skipped with a warning and the job is still updated and rescheduled (legacy behavior).
6. Otherwise update campaign/custom fields only when legacy diff rules find changes; reschedule only when start or end differs. Backfill a missing or different event sourceId. The appointment outcome field is written only when the event has a status.
7. For an unlinked account, a resident is required (otherwise skip), search customers only if customFieldCustomerId is configured. Search uses resident name and normalized address, matches that custom field to the account ID, and selects the first location. Otherwise create a Residential customer with a location, USA address, email/phone contacts, and configured account-ID custom fields. Include coordinates only when present.
8. Create the job with Normal priority, mapped business unit, campaign, configured job custom fields, appointment time/duration and technician, then save both links.

## Errors and retries

Sales does not retry a script that throws: it invokes the script synchronously and logs a thrown error as the run's failure. The only redelivery is an engine timeout (the engine and script Lambdas both time out at 60 seconds), and a redelivery after an unlinked create would create a duplicate job. So the script never relies on a throw to retry, and keeps each run well inside the timeout.

- **Run budget.** Each run has a 45-second budget. Each OAuth or API request times out after 10 seconds or the remaining budget, whichever is less, and no request starts with under 1 second left. A ServiceTitan customer or job create does not start with under 20 seconds left; the run is skipped with a "run budget too low" reason instead. A customer created just before a job create is skipped this way stays unlinked; with customFieldCustomerId configured, the next run finds it by search.
- **Retries.** The client returns failures as values marked retryable for HTTP 429, 5xx, network errors and timeouts. Reads and updates (job PATCH, reschedule, cancel) make up to three attempts with exponential delay and 0–10% jitter (3 seconds initially for reads, 5 seconds for updates), but only while at least 15 seconds of budget remain after the delay. Job and customer creates are never retried, because a create that timed out may have succeeded. A just-created customer's empty location page is retried like a transient failure.
- **Terminal errors.** Failures that cannot succeed on a later run with the same input are `PermanentError`s: invalid config or secrets, an invalid account job link, a missing location, campaign or business unit, non-retryable API errors (4xx), and every create failure. The entrypoint logs them as "ServiceTitan sync failed permanently" and returns normally, so any future redelivery of thrown scripts would not replay them. Other failures (retries exhausted, budget exhausted) are rethrown and show as failed runs.
- **Skips.** `skipped` is for business rules (guards above, non-Terros account, no matching technician, missing resident, another tenant's link) and the create budget guard.
- **Validation.** Read responses the sync uses are validated with zod: IDs must be positive integers and appointment times must parse. A create response is validated only for its job or customer ID, so a create that succeeded is always linked; the created ID is logged before the link is saved.
- **Tokens.** Tokens are cached per credential (clientId, tenantId and a SHA-256 prefix of the client secret, never the secret itself), since installs share the Lambda, with 60 seconds of early expiry. A 401 drops the cached token and re-authenticates once within the budget; a second 401 fails. No payloads or credential values are logged.

Legacy logged and skipped customer failures and logged and ignored update and cancel failures.

## Account updates and run logs

**Account customFields replaces the map.** Verified in the read-only sales reference: `packages/api-canvass/src/account/update.ts:87,127,189,285` saves the validated map; `src/utils/account/customField.ts:16-36` passes existingValues only to validation. `packages/back-common/src/business/report/customField.ts:139-160` constructs a calculator from submitted values, not a merged map. Therefore the script re-reads the account right before writing and sends that fresh map with only the job link key changed, preserving unrelated fields. Caveat: account.get returns only the custom fields the script's token may view (`packages/api-canvass/src/utils/account/filterCustomFields.ts`, `back-common/src/customField.ts:51-55`), so a role-restricted field the token cannot view would be dropped by that write. A sales-side partial custom-field update would remove this risk (TECH-6973, TODO in `src/sync.ts`). GoHighLevel sends a single-key `account.upsert`, which merges, so it does not have this problem.

`sdk/src/connect/handler.ts` passes through the handler result and offers no skipped-run status API. The platform's `packages/api-connect/src/execution.ts:317-318` reports a successful invocation as success, including normal early returns. Legacy wrote a `success` WebhookHistory row whenever the handler returned, including its early returns (no credentials, no technician, customer failure, remove, non-Consultation), and no row for `skipWebhook` skips (`packages/back-common/src/webhook/fetch.ts:33-35` vs `:37-38`). The entrypoint logs explicit “skipped”, “no-op”, or “wrote changes” outcomes; it emits the latter only after writes succeed. A customer may have been created before a later failure ends the run; with customFieldCustomerId configured, the next run finds it by search instead of creating another.

## Differences from legacy

- All required config (including jobTypeId) and secrets fail loudly when missing or invalid after payload guards. Legacy skipped missing jobTypeId or credentials. Malformed optional numeric IDs and mapping entries also fail rather than silently disappearing.
- cancelReasonId is required configuration, replacing the tenant-specific constant.
- event.sourceId is written after create/reassign and backfilled for existing jobs.
- Compare before every link write, job PATCH and reschedule; a sequential re-run after creation with current account/payload makes zero writes.
- Rescheduling compares both start and end as instants, fixing duration-only changes and handling timezone offsets.
- SDK account updates re-read and preserve the custom field map and use public API field validation; legacy wrote directly to storage.
- ServiceTitan failures fail the run (logged as permanent, or thrown) instead of being logged and skipped; transient read and update failures are retried within the run budget. Assignment lookup failures still only skip the reassignment check, as in legacy.
- Links carry the tenant ID, and a link from another tenant is skipped.
- Missing coordinates are omitted. Skip/no-op/write outcomes use Connect logs in place of legacy metrics/history.

## Limits and out of scope

Incoming webhooks, two-way sync, sales changes, production cutover execution and publishing workflow changes are out of scope. Event deletion still does not cancel a job. No pagination is added: first search page, first technician, first location and first active assignment retain legacy behavior.

This port does not add a distributed create lock or transaction (TECH-6972). Concurrent unlinked runs, an engine timeout redelivery, or a failure between job creation and saving its links can create duplicates; the run budget makes the timeout case unlikely, and the created job ID is logged before linking. A failed cancel after a reassignment leaves the old job active and is only logged (`SERVICETITAN_ABANDONED_CANCEL`); it is not stored for a later run, because a later run happens only when the event changes again and a pending-cancel note would change the link field format. A cancel that timed out but succeeded and is then retried can be reported as failed. Search the logs for that marker and review partial failures operationally. The sequential no-write guarantee depends on receiving the current sourceId payload and reading current account fields.

## Legacy parity goldens

`src/parity.test.ts` replays the 30 scenarios captured from the legacy ServiceTitan webhook (terros-inc/sales#16522). Fixtures and goldens are in `test/parity/`. Each golden's `legacySha` is the sales commit that produced it. The test runs `sync` with a recording fake ServiceTitan server and fake ports, then diffs the normalized result against the golden. Normalization drops the token call and auth headers, rewrites ids created during the run to `$customer1` / `$location1` / `$job1` / `$appt1`, sorts query params, collapses consecutive identical calls into a `retries` count, and leaves metrics out.

`src/parity/allowlist.ts` maps each accepted difference to one of A1–A17 and to the scenarios it covers. A diff that is not on that list fails the scenario. An allowlist entry that no longer matches its scenarios fails too. The legacy cancel reason is the placeholder `9001` in these files.

### Refreshing the goldens

1. In terros-inc/sales, regenerate the fixtures and goldens from the ServiceTitan parity harness under `packages/back-common/src/webhook/serviceTitan` (the capture test is `parity.golden.test.ts`).
2. Copy `fixtures/` and `goldens/` over `integrations/servicetitan/test/parity/fixtures` and `test/parity/goldens`.
3. Replace the legacy hard-coded cancel reason with `9001` in `connectConfig.cancelReasonId` and in every expected `reasonId`. Keep placeholders only: no customer names, emails, phones, addresses, tenant ids, Terros ids, or real ServiceTitan ids.
4. Run `node scripts/check-public-data.mjs` on the branch, then `pnpm --filter @terros-inc/connect-servicetitan exec tsc --noEmit` and `pnpm --filter @terros-inc/connect-servicetitan test`.
5. Update the allowlist only when a diff is already described by A1–A17. A new shape should stay a failing scenario with a TODO, not a wider entry.
