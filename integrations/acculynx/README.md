# AccuLynx integration

Connects a Terros company to AccuLynx through the [AccuLynx API v2](https://apidocs.acculynx.com). Two scripts; a company turns on the direction(s) it needs. Neither direction is on by default.

| Script           | Slug               | Direction         | What it does                                                                                                                                                                   |
| ---------------- | ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AccuLynx Send    | `acculynx-send`    | Terros → AccuLynx | At configured trigger stages, creates an AccuLynx contact (`recordType: contact`) or a contact and a job for it, then optionally keeps the linked record updated.              |
| AccuLynx Webhook | `acculynx-webhook` | AccuLynx → Terros | Receives milestone, milestone-status, and company-representative events, then updates the linked account's stage, source status, and matched closer. Other topics are ignored. |

## Install and configure

Install the app once per AccuLynx location ([Locations and API keys](#locations-and-api-keys)), turning on the script(s) for the direction(s) the company needs.

1. **Secret.** Set `apiKey`, the location's AccuLynx API key, in the install's Install Secrets section. Never put it in a script's config.
2. **AccuLynx Send** config:
   - `recordType` (required): `contact` or `job`.
   - `contactTypeId` (optional): AccuLynx contact type ID for new contacts. When blank, Send lists the location's contact types and uses the default named `Customer` (case-insensitive), or the first default returned when no default is named Customer. Send stops before creating anything if no default is available.
   - `leadSourceId` (optional): AccuLynx lead source ID for new jobs.
   - `triggerStages` (optional): comma-separated Terros stage IDs (`S.*`) at which accounts are sent. IDs remain stable when a stage is renamed and are recommended for new configuration. Existing stage-name values remain supported and match case-insensitively after trimming. Blank preserves the previous behavior of sending at any stage.
   - `accountFilterField`, `accountFilterValues`: which accounts this location sends; needed with more than one location. For a team field (`owner.teamIds`, `owner.memberOf`, `teamId`, or `team`), an assigned account `teamId` is matched by itself. If the account has no assigned team, the configured field is used as the fallback. A list field matches when any team ID or name exactly matches a configured value.
   - `addressCountry`: an optional fallback two-letter country code, such as `US`, for Account webhooks that omit country.
   - `testMode` (optional, off by default): turn on to validate the API key and preview Send without writing anything. Existing installs with a legacy text value continue to accept `true`, `yes`, `on`, or `1` as on and `false`, `no`, `off`, or `0` as off, ignoring case and surrounding whitespace. Any other legacy text is treated as on and logged so a typo cannot accidentally enable writes.
   - `syncUpdates` (optional, off by default): type `true`, `yes`, `on`, or `1` to update a linked AccuLynx record after later Terros changes. Blank, `false`, `no`, `off`, `0`, and all unrecognized text are off; an unrecognized value is logged. This switch deliberately fails closed so a typo cannot enable vendor writes.
   - `syncStateFieldId`: required when `syncUpdates` is on. Create a Terros account text custom field for integration state and put its `CF.*` ID here. Do not edit this field manually. Send stores a fingerprint of its last synced snapshot and the sent Terros note IDs there, which makes note appends idempotent and lets inbound-only changes stop before any AccuLynx request without duplicating account details in the state field.
3. **AccuLynx Webhook** config:
   - `workflowId` (required): the Terros workflow whose stage follows the AccuLynx milestone.
   - `requestType` (required): `update` or `upsert` ([Linking jobs and accounts](#linking-jobs-and-accounts)). Use `update` so only jobs already linked by Send can move an account.
   - `accountSource` (optional): defaults to `AccuLynx`.
   - Configure the workflow's Integration Mapping with each AccuLynx source value (`Milestone > Status`, or the milestone when there is no status) and its Terros stage/action ID. This is the recommended stage mapping. AccuLynx may return either `Dead` or `Cancelled`, so configure both source values when both can occur.
   - `milestoneStageMapping` (optional legacy override): maps `Milestone > Status` or milestone-only AccuLynx names directly to Terros stage/action IDs (`S.*` / `A.*`). Name-valued targets are ignored. Source names are trimmed and match case-insensitively; `Dead` and `Cancelled` are equivalent. A current status tries the combined key first, then the milestone-only key. When the mapping has no valid match, stage is left unchanged. Without this override, the AccuLynx source value is sent as `workflowTarget` for the workflow Integration Mapping to resolve.
   - `subscriptionId`: from step 5.
4. **Webhook URL.** `https://<terros-api>/connect/incoming/<installId>/acculynx-webhook?apiKey=<dedicated low-privilege Terros key>`. The Webhook's Terros calls run as that key, so use a key owned by a user of the install's company, made for this webhook alone and limited to `account:list`, `account:save`, and `user:list`, plus `account:add` when `requestType` is `upsert`; `user:list` must cover the whole company so closer matching can find every eligible user. The key travels in the URL, so it must grant nothing else.
5. **Subscription.** Create a new location-specific AccuLynx subscription to that URL for `job.milestone.current_changed`, `job.milestone.status.current_changed`, `job.representatives.company_assigned`, and `job.representatives.company_changed` (`POST https://api.acculynx.com/webhooks/v2/subscriptions` with the location's key), and copy the returned subscription ID into `subscriptionId`. Do not modify an existing non-Terros subscription: updating one replaces its entire topic list, and its `consumerUrl` cannot be changed after creation.

## Locations and API keys

AccuLynx API keys are created per location by an AccuLynx admin (Account Settings > API Keys). Install the app once per location, with that location's key as the `apiKey` secret on both scripts.

- **Send:** with more than one location, set `accountFilterField` to a team field (`owner.teamIds`, `owner.memberOf`, `teamId`, or `team`) and `accountFilterValues` to the comma-separated team IDs (or available names) for that location. When the account has an assigned `teamId`, Send matches only that ID and never falls back to the owner, even when the owner belongs to another location's team. `Team.unassigned` is treated as no account team. When the account has no assigned team, Send preserves the configured-field behavior: a list matches when any element's team ID or name is allowed, and a plain value matches exactly. Non-team filter fields retain their prior behavior. Without a filter an install sends every account. `triggerStages` gates only the first create; once an account is linked, `syncUpdates` continues outside those stages. The account filter still gates both creates and updates.

  Account webhooks currently populate `owner.teamIds` from the owner's direct team memberships and do not normally populate `owner.memberOf`. Those memberships do not automatically include ancestor teams, so an owner who belongs only to a child team does not match a parent-team value. Add the owner directly to every parent team that should be a fallback match; Send does not expand the hierarchy.

- **Webhook:** each install has its own AccuLynx subscription ([Install and configure](#install-and-configure), step 5), and `subscriptionId` makes it refuse other subscriptions' events.

Job addresses: AccuLynx needs a country with every job address. Account webhooks historically omitted country; Send now uses the webhook country when present and falls back to the install's `addressCountry` (such as `US` or `CA`) when it is missing. When neither source has a valid two-letter code, jobs are created with no address rather than a guessed country.

## Test mode and send confirmation

Turn `testMode` on for a safe install check. Each Send run makes a read-only request to check the API key. When `contactTypeId` is blank and the webhook could create a contact, it also lists the location's available contact types, logging each type's name and default status and which type Send selected. Configured IDs, linked-account updates, and Account removes skip that list because they do not need default-type discovery. Test mode then logs the stage, filter and linked-record decisions for the account. For team filters, the log identifies the account-team or owner-team fallback path and the team ID or name that matched or was rejected. A qualifying account is prefixed with `DRY RUN:` and includes the exact contact payload and, for `recordType: job`, the job payload with `<created-contact-id>` standing in for the ID AccuLynx would return. Skipped accounts log their reason. Test mode makes no AccuLynx or Terros writes, including no `externalLeadId` update. Request summaries contain only the method, path, status and a short response-body summary; credentials and authorization headers are never logged.

After a normal-mode create, Send logs the returned ID and link, then reads the final contact or job back. A new unassigned job may not be returned by AccuLynx yet; Send logs that likely-unassigned case and still saves `externalLeadId`. Any other read-back failure is also diagnostic only and does not fail an otherwise successful delivery.

For linked accounts, test mode reads the existing AccuLynx record and logs each contact, job, phone, email, or note write that would occur. It does not make those writes and does not update the Terros sync-state field.

## Linked-account updates

With `syncUpdates` off, linked accounts keep the original create-once behavior. With it on, Send compares the account with the snapshot in `syncStateFieldId` before calling AccuLynx. A stage, closer, or `sourceStatus` change written by AccuLynx Webhook is outside that snapshot, so it cannot echo back. Any event with no changed synced field and no new note also stops without an AccuLynx request.

An account that was linked before it had stored sync state is reconciled on its first event after update sync is enabled, even when that event is an inbound stage-only upsert. Later inbound-only events are no-ops once that initial snapshot exists.

When a synced value changed, Send reads the linked contact and updates first name, last name, company name, and mailing address only when their current values differ. It reads email addresses and phone numbers before using AccuLynx's add-only endpoints, so an existing value is never added twice. For `recordType: job`, it resolves the job from `externalLeadId`, loads its primary contact, and also updates a changed job location address and the configured `leadSourceId`. The job address includes the webhook country or `addressCountry` fallback used on create.

Notes present when Send first records its sync state are treated as the create-time baseline. Each later nonempty Terros note is appended once with its `Note.*` ID in the text: a job message for `recordType: job`, or a contact note truncated to AccuLynx's 1,000-character limit for `recordType: contact`. Send never rewrites the job's create-time `notes` field. After successful writes it stores the new snapshot and sent note IDs in the Terros state field; the state-field webhook is therefore a no-op.

AccuLynx's public changelog announces an “Update contact” operation but its API reference index does not currently expose the endpoint schema. Send uses the conventional `PUT /api/v2/contacts/{contactId}` path with the changed basic contact fields; unlike phone and email, this path has not been verified with a live write.
If that basic contact update fails, Send logs the failure and continues independent phone, email, job, and note writes. It retains the prior field fingerprint so a later event retries the basic contact fields without reposting notes that succeeded.

## Webhook authentication

AccuLynx API v2 documents no webhook signature or secret: a subscription returns only its ID, and every event carries that ID in its body, where anyone can write it. Connect also gives the script only the request body, not its headers or query string, so a shared secret in a header or in the URL cannot be checked here.

So the webhook treats an event as a hint. It takes only the job ID from the body and reads the job's current milestone and status, company representative, and representative user back from AccuLynx with the install's own key. It never trusts those fields from the event body. A forged event can at most reapply a real job's current AccuLynx values, which a genuine event would do anyway. A job ID the key cannot read (another location or a made-up ID) is logged and ignored. In `upsert` mode a forged event for a real, unlinked job of the location can create its Terros account early, as its next genuine accepted event would. The `subscriptionId` check routes events between locations; it is not authentication.

The company representative becomes the closer only when AccuLynx returns an email and it matches a Terros user email case-insensitively. A missing representative, missing email, or unmatched email leaves the existing closer unchanged; the webhook never clears it and never reads the AccuLynx sales-owner role.

If the company-representative lookup, representative-user lookup, or Terros user-list lookup fails with a retryable error, the webhook first updates the account's stage and source status without a closer, then fails the delivery. A typed Terros API error or HTTP 401/403 from the user-list lookup is logged and leaves the closer unchanged without failing the delivery.

## Retries

A delivery can fail partway and be retried, so Send looks for what an earlier attempt created before creating anything:

1. The contact: contacts created since the account was, searched by the contact's last name (or first or company name) newest first, matching the account ID in `crossReference`. Up to four pages of 25.
2. With `recordType: job` and a contact found in step 1, the job an earlier attempt created on it. People can add jobs to the contact in AccuLynx, so Send reads each job's `Terros` external references (`GET /contacts/{id}/jobs`, then one lookup per job) and reuses a job only when:
   - its reference names this account (project ID = account ID), or
   - it is the contact's only job and has no `Terros` reference, which is what a failed reference create leaves behind (Send creates one job per contact).

   Otherwise no job is provably this account's, and Send creates a new one rather than link a job of unknown origin.

3. A new or unreferenced job gets the `Terros` reference. A failure here fails the delivery.

`externalLeadId` and the first sync snapshot are saved on the account last, so a linked account always has its reference and a failed save is repaired by the retry without a second contact or job.

## Rate limit

AccuLynx allows 10 requests per second per key. Every call waits for a slot in a per-key one-second window, and a `429` is retried up to three times after `Retry-After` (capped at 5 seconds). The window is shared by runs in the same runtime only; separate runtimes do not coordinate. A Send run makes up to four contact searches, then a job list and one reference lookup per job on a contact found again, then up to two creates. A Webhook run makes up to four requests for a linked job (milestone, references, representative, and representative user) or five for an unlinked upsert (plus the job).

## Linking jobs and accounts

With `recordType: job`, Send also adds an AccuLynx job external reference (source `Terros`, project ID = Terros account ID). The webhook reads that reference to find the account.

- `requestType: update` (recommended): only jobs with a reference (jobs Send created) move an account. Others are skipped.
- `requestType: upsert`: a job without a reference creates a Terros account, named from the job's primary contact and placed at the job address when AccuLynx returns the job. New AccuLynx jobs are unassigned, and AccuLynx does not return unassigned jobs, so such an account can start without a name or address.

## Not covered yet

- Contact mailing addresses go without state and country, which AccuLynx takes as numeric IDs.
- Retry lookups rely on behavior the AccuLynx docs do not state and that was not tried against a live account: that contact search finds a contact created moments earlier and pages by page number, and that a contact's jobs include a new, unassigned job. If a lookup misses, a retry creates a second record as before. A retry also creates a second job when the job it created earlier has no reference and someone added another job to the contact meanwhile.
- A webhook for a job AccuLynx does not return through the current-milestone endpoint (it may hide unassigned jobs, as `GET /jobs/{id}` does) is ignored.
