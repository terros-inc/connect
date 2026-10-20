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

## Rate limit

AccuLynx allows 10 requests per second per key. Every call waits for a slot in a per-key one-second window, and a `429` is retried up to three times after `Retry-After` (capped at 5 seconds). The window is shared by runs in the same runtime only; separate runtimes do not coordinate. A run makes at most four AccuLynx calls.

## Linking jobs and accounts

With `recordType: job`, Send also adds an AccuLynx job external reference (source `Terros`, project ID = Terros account ID). The webhook reads that reference to find the account.

- `requestType: update`: only jobs with a reference (jobs Send created) move an account. Others are skipped.
- `requestType: upsert`: a job without a reference creates a Terros account, named from the job's primary contact and placed at the job address when AccuLynx returns the job. New AccuLynx jobs are unassigned, and AccuLynx does not return unassigned jobs, so such an account can start without a name or address.

## Not covered yet

- Changes to an account after it is linked are not sent; AccuLynx owns the record from then on.
- Contact mailing addresses go without state and country, which AccuLynx takes as numeric IDs.
- AccuLynx documents no webhook signature, so the webhook trusts its URL and the optional `subscriptionId`.
- If the job create fails after the contact was created, the retry creates a second contact.
- `appId` in `terros.json` is a placeholder until the Connect app record exists, and the app is not yet in the `publish-integrations.yml` list.
