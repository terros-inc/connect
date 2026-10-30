# AccuLynx integration

Connects a Terros company to AccuLynx through the [AccuLynx API v2](https://apidocs.acculynx.com). Two scripts; a company turns on the direction(s) it needs. Neither direction is on by default.

| Script           | Slug               | Direction         | What it does                                                                                                                                                                                                                          |
| ---------------- | ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AccuLynx Send    | `acculynx-send`    | Terros → AccuLynx | The first time an account is sent, creates an AccuLynx contact (`recordType: contact`) or a contact and a job for it (`recordType: job`), and saves the new ID as the account's `externalLeadId`. Linked accounts are not sent again. |
| AccuLynx Webhook | `acculynx-webhook` | AccuLynx → Terros | Receives `job.milestone.current_changed` events and sets the Terros account's stage (`workflowTarget`) to the milestone name. Other topics are logged and ignored.                                                                    |

## Install and configure

Install the app once per AccuLynx location ([Locations and API keys](#locations-and-api-keys)), turning on the script(s) for the direction(s) the company needs.

1. **Secret.** Set `apiKey`, the location's AccuLynx API key, in the install's Install Secrets section. Never put it in a script's config.
2. **AccuLynx Send** config:
   - `recordType` (required): `contact` or `job`.
   - `contactTypeId`, `leadSourceId` (optional): AccuLynx IDs for new contacts and jobs.
   - `accountFilterField`, `accountFilterValues`: which accounts this location sends; needed with more than one location.
   - `addressCountry`: the location's two-letter country code, such as `US`, so jobs get an address.
3. **AccuLynx Webhook** config:
   - `workflowId` (required): the Terros workflow whose stage follows the AccuLynx milestone.
   - `requestType` (required): `update` or `upsert` ([Linking jobs and accounts](#linking-jobs-and-accounts)).
   - `accountSource` (optional): defaults to `AccuLynx`.
   - `subscriptionId`: from step 5.
4. **Webhook URL.** `https://<terros-api>/connect/incoming/<installId>/acculynx-webhook?apiKey=<dedicated low-privilege Terros key>`. The Webhook's Terros calls run as that key, so use a key owned by a user of the install's company, made for this webhook alone and limited to `account:list` and `account:save`; it travels in the URL, so it must grant nothing else.
5. **Subscription.** Create the location's AccuLynx subscription to that URL for topic `job.milestone.current_changed` (`POST https://api.acculynx.com/webhooks/v2/subscriptions` with the location's key), and copy the returned subscription ID into `subscriptionId`.

## Locations and API keys

AccuLynx API keys are created per location by an AccuLynx admin (Account Settings > API Keys). Install the app once per location, with that location's key as the `apiKey` secret on both scripts.

- **Send:** with more than one location, set `accountFilterField` (a dotted Terros account field such as `workflowState.workflowId`) and `accountFilterValues` (comma-separated) so each install sends only its own accounts. Without a filter an install sends every account.
- **Webhook:** each install has its own AccuLynx subscription ([Install and configure](#install-and-configure), step 5), and `subscriptionId` makes it refuse other subscriptions' events.

Job addresses: AccuLynx needs a country with every job address and Terros addresses have none. Set `addressCountry` (such as `US` or `CA`) on each Send install to the country of that location's jobs. Without it, jobs are created with no address rather than a guessed country.

## Webhook authentication

AccuLynx API v2 documents no webhook signature or secret: a subscription returns only its ID, and every event carries that ID in its body, where anyone can write it. Connect also gives the script only the request body, not its headers or query string, so a shared secret in a header or in the URL cannot be checked here.

So the webhook treats an event as a hint. It takes only the job ID from the body and reads the job's current milestone back from AccuLynx with the install's own key, and uses that, never the body's milestone or date. A forged event can at most make Terros show a real job's current AccuLynx milestone, which a genuine event would do anyway. A job ID the key cannot read (another location, a made-up ID) is logged and ignored. In `upsert` mode a forged event for a real, unlinked job of the location can create its Terros account early, as its next genuine milestone change would. The `subscriptionId` check routes events between locations; it is not authentication.

## Retries

A delivery can fail partway and be retried, so Send looks for what an earlier attempt created before creating anything:

1. The contact: contacts created since the account was, searched by the contact's last name (or first or company name) newest first, matching the account ID in `crossReference`. Up to four pages of 25.
2. With `recordType: job` and a contact found in step 1, the job an earlier attempt created on it. People can add jobs to the contact in AccuLynx, so Send reads each job's `Terros` external references (`GET /contacts/{id}/jobs`, then one lookup per job) and reuses a job only when:
   - its reference names this account (project ID = account ID), or
   - it is the contact's only job and has no `Terros` reference, which is what a failed reference create leaves behind (Send creates one job per contact).

   Otherwise no job is provably this account's, and Send creates a new one rather than link a job of unknown origin.

3. A new or unreferenced job gets the `Terros` reference. A failure here fails the delivery.

`externalLeadId` is saved on the account last, so a linked account always has its reference and a failed save is repaired by the retry without a second contact or job.

## Rate limit

AccuLynx allows 10 requests per second per key. Every call waits for a slot in a per-key one-second window, and a `429` is retried up to three times after `Retry-After` (capped at 5 seconds). The window is shared by runs in the same runtime only; separate runtimes do not coordinate. A Send run makes up to four contact searches, then a job list and one reference lookup per job on a contact found again, then up to two creates; a Webhook run makes at most three.

## Linking jobs and accounts

With `recordType: job`, Send also adds an AccuLynx job external reference (source `Terros`, project ID = Terros account ID). The webhook reads that reference to find the account.

- `requestType: update`: only jobs with a reference (jobs Send created) move an account. Others are skipped.
- `requestType: upsert`: a job without a reference creates a Terros account, named from the job's primary contact and placed at the job address when AccuLynx returns the job. New AccuLynx jobs are unassigned, and AccuLynx does not return unassigned jobs, so such an account can start without a name or address.

## Not covered yet

- Changes to an account after it is linked are not sent; AccuLynx owns the record from then on.
- Contact mailing addresses go without state and country, which AccuLynx takes as numeric IDs.
- Retry lookups rely on behavior the AccuLynx docs do not state and that was not tried against a live account: that contact search finds a contact created moments earlier and pages by page number, and that a contact's jobs include a new, unassigned job. If a lookup misses, a retry creates a second record as before. A retry also creates a second job when the job it created earlier has no reference and someone added another job to the contact meanwhile.
- A webhook for a job AccuLynx does not return through the current-milestone endpoint (it may hide unassigned jobs, as `GET /jobs/{id}` does) is ignored.
