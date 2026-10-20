# AccuLynx integration

Connects a Terros company to AccuLynx through the [AccuLynx API v2](https://apidocs.acculynx.com). Two scripts; a company turns on the direction(s) it needs. Neither direction is on by default.

| Script           | Slug               | Direction         | What it does                                                                                                                                                                                                                          |
| ---------------- | ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AccuLynx Send    | `acculynx-send`    | Terros → AccuLynx | The first time an account is sent, creates an AccuLynx contact (`recordType: contact`) or a contact and a job for it (`recordType: job`), and saves the new ID as the account's `externalLeadId`. Linked accounts are not sent again. |
| AccuLynx Webhook | `acculynx-webhook` | AccuLynx → Terros | Receives `job.milestone.current_changed` events and sets the Terros account's stage (`workflowTarget`) to the milestone name. Other topics are logged and ignored.                                                                    |

## Locations and API keys

AccuLynx API keys are created per location by an AccuLynx admin (Account Settings > API Keys). Install the app once per location, with that location's key as the `apiKey` secret on both scripts.

- **Send:** with more than one location, set `accountFilterField` (a dotted Terros account field such as `teamId`) and `accountFilterValues` (comma-separated) so each install sends only its own accounts. Without a filter an install sends every account.
- **Webhook:** create one AccuLynx subscription per location (`POST https://api.acculynx.com/webhooks/v2/subscriptions` with the location's key) pointing at that install's webhook URL, and set `subscriptionId` so the install refuses other subscriptions' events.

Job addresses: AccuLynx needs a country with every job address and Terros addresses have none. Set `addressCountry` (such as `US` or `CA`) on each Send install to the country of that location's jobs. Without it, jobs are created with no address rather than a guessed country.

## Webhook authentication

AccuLynx API v2 documents no webhook signature or secret: a subscription returns only its ID, and every event carries that ID in its body, where anyone can write it. Connect also gives the script only the request body, not its headers or query string, so a shared secret in a header or in the URL cannot be checked here.

So the webhook treats an event as a hint. It takes only the job ID from the body and reads the job's current milestone back from AccuLynx with the install's own key, and uses that, never the body's milestone or date. A forged event can at most make Terros show a real job's current AccuLynx milestone, which a genuine event would do anyway. A job ID the key cannot read (another location, a made-up ID) is logged and ignored. In `upsert` mode a forged event for a real, unlinked job of the location can create its Terros account early, as its next genuine milestone change would. The `subscriptionId` check routes events between locations; it is not authentication.

## Retries

A delivery can fail partway and be retried, so Send looks for what an earlier attempt created before creating anything:

1. The contact: contacts created since the account was, searched by the contact's last name (or first or company name) newest first, matching the account ID in `crossReference`. Up to four pages of 25.
2. With `recordType: job` and a contact found in step 1, the contact's job (`GET /contacts/{id}/jobs`).
3. For a job found in step 2, its `Terros` external reference. A new job gets the reference straight away. A failure here fails the delivery.

`externalLeadId` is saved on the account last, so a linked account always has its reference and a failed save is repaired by the retry without a second contact or job.

## Rate limit

AccuLynx allows 10 requests per second per key. Every call waits for a slot in a per-key one-second window, and a `429` is retried up to three times after `Retry-After` (capped at 5 seconds). The window is shared by runs in the same runtime only; separate runtimes do not coordinate. A Send run makes at most seven AccuLynx calls (up to four contact searches, then three lookups or creates), a Webhook run at most three.

## Linking jobs and accounts

With `recordType: job`, Send also adds an AccuLynx job external reference (source `Terros`, project ID = Terros account ID). The webhook reads that reference to find the account.

- `requestType: update`: only jobs with a reference (jobs Send created) move an account. Others are skipped.
- `requestType: upsert`: a job without a reference creates a Terros account, named from the job's primary contact and placed at the job address when AccuLynx returns the job. New AccuLynx jobs are unassigned, and AccuLynx does not return unassigned jobs, so such an account can start without a name or address.

## Not covered yet

- Changes to an account after it is linked are not sent; AccuLynx owns the record from then on.
- Contact mailing addresses go without state and country, which AccuLynx takes as numeric IDs.
- Retry lookups rely on behavior the AccuLynx docs do not state and that was not tried against a live account: that contact search finds a contact created moments earlier and pages by page number, and that a contact's jobs include a new, unassigned job. If a lookup misses, a retry creates a second record as before.
- A webhook for a job AccuLynx does not return through the current-milestone endpoint (it may hide unassigned jobs, as `GET /jobs/{id}` does) is ignored.
- `appId` in `terros.json` is a placeholder until the Connect app record exists, and the app is not yet in the `publish-integrations.yml` list.
