# ServiceTitan Appointment Sync

One-way port of the legacy ServiceTitan webhook: Terros Consultation events create or update a ServiceTitan job and its last appointment. The account custom field remains the authoritative job link; the event sourceId also stores that job ID.

## Setup

Disable the legacy **SERVICETITAN** webhook before installing this script to avoid double sync. Replace the placeholder appId when provisioning the app. This package is not yet included in the manual publishing workflow; adding it there is a separate release task.

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
3. Find the first technician by attendee.clientUserId when available, otherwise by preferred/first and last name. No match or lookup error skips.
4. For a linked job, inspect the first active assignment on lastAppointmentId. A different technician creates a replacement on the same customer/location, saves both links, then cancels the old job with the configured reason and memo “Closer reassigned via automation”.
5. Otherwise update campaign/custom fields only when legacy diff rules find changes; reschedule only when start or end differs. Backfill a missing or different event sourceId.
6. For an unlinked account, search customers only if customFieldCustomerId is configured. Search uses resident name and normalized address, matches that custom field to the account ID, and selects the first location. Otherwise create a Residential customer with a location, USA address, email/phone contacts, and configured account-ID custom fields. Include coordinates only when present.
7. Create the job with Normal priority, mapped business unit, campaign, configured job custom fields, appointment time/duration and technician, then save both links.

Customer lookup/create failures log and skip, as in the legacy flow. Existing-job reads throw. Assignment lookup failures are treated as no reassignment. Returned job update, reschedule and cancellation errors are logged without throwing, as in legacy. Job-create errors throw. OAuth/API calls use a 30-second timeout; tokens are cached by clientId:clientSecret with 60 seconds of early expiry. No payloads or credential values are logged.

The legacy retry helper makes three attempts on **thrown errors** with exponential delay and 0–10% jitter (5 seconds initially for writes; 3 seconds for location reads). The API returns write errors as values, so those errors are not retried; missing location reads throw and are retried. This distinction is preserved, including its limitations.

## Account updates and run logs

**Account customFields replaces the map.** Verified in the read-only sales reference: `packages/api-canvass/src/account/update.ts:87,127,189,285` saves the validated map; `src/utils/account/customField.ts:16-36` passes existingValues only to validation. `packages/back-common/src/business/report/customField.ts:139-160` constructs a calculator from submitted values, not a merged map. Therefore the SDK account.update call sends the full existing map with the job link changed, preserving unrelated fields. Caveat: account.get returns only the custom fields the script's token may view (`packages/api-canvass/src/utils/account/filterCustomFields.ts`, `back-common/src/customField.ts:51-55`), so a role-restricted field the token cannot view would be dropped by that write. A sales-side partial custom-field update would remove this risk.

`sdk/src/connect/handler.ts` passes through the handler result and offers no skipped-run status API. The platform's `packages/api-connect/src/execution.ts:317-318` reports a successful invocation as success, including normal early returns. Legacy wrote a `success` WebhookHistory row whenever the handler returned, including its early returns (no credentials, no technician, customer failure, remove, non-Consultation), and no row for `skipWebhook` skips (`packages/back-common/src/webhook/fetch.ts:33-35` vs `:37-38`). The entrypoint logs explicit “skipped”, “no-op”, or “wrote changes” outcomes; it emits the latter only after writes succeed. Error logs remain relevant even when the run returns normally. A customer may have been created before a later customer-location failure causes a skip.

## Differences from legacy

- All required config (including jobTypeId) and secrets fail loudly when missing or invalid after payload guards. Legacy skipped missing jobTypeId or credentials. Malformed optional numeric IDs and mapping entries also fail rather than silently disappearing.
- cancelReasonId is required configuration, replacing the tenant-specific constant.
- event.sourceId is written after create/reassign and backfilled for existing jobs.
- Compare before every link write, job PATCH and reschedule; a sequential re-run after creation with current account/payload makes zero writes.
- Rescheduling compares both start and end as instants, fixing duration-only changes and handling timezone offsets.
- SDK account updates preserve the full custom field map and use public API field validation; legacy wrote directly to storage.
- Missing coordinates are omitted. Skip/no-op/write outcomes use Connect logs in place of legacy metrics/history.

## Limits and out of scope

Incoming webhooks, two-way sync, sales changes, production cutover execution and publishing workflow changes are out of scope. Event deletion still does not cancel a job. No pagination is added: first search page, first technician, first location and first active assignment retain legacy behavior.

This port does not add a distributed create lock or transaction. Concurrent unlinked runs, a retried create with an ambiguous response, or failure between job creation and saving its links can create duplicates. Failure after saving replacement links but before cancellation can leave the old job active; subsequent runs follow the replacement link. Review partial failures operationally before retrying. The sequential no-write guarantee depends on receiving the current sourceId payload and reading current account fields.
