# JobNimbus integration

Connects a Terros company to JobNimbus through the [JobNimbus API](https://documenter.getpostman.com/view/3919598/S11PpG4x) (`https://app.jobnimbus.com/api1`). Two scripts; a company turns on the direction(s) it needs.

| Script            | Slug                | Direction          | What it does                                                                                                                                                                                                           |
| ----------------- | ------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JobNimbus Send    | `jobnimbus-send`    | Terros → JobNimbus | Creates a JobNimbus job (or contact, `jobNimbusRecord: contact`) when an account reaches a mapped stage with its required fields, saves the jnid as the account's `externalLeadId`, and updates the record after that. |
| JobNimbus Webhook | `jobnimbus-webhook` | JobNimbus → Terros | Receives a JobNimbus Automation webhook for a job, reads the job back from JobNimbus, and sets the Terros account's stage (`workflowTarget`) to the job's current status.                                              |

## Upgrading from 1.x: add the Webhook's API key

From 2.0.0 the Webhook script needs its own `apiKey` secret. Before publishing 2.0.0, add the install's JobNimbus API key as the `apiKey` secret on the JobNimbus Webhook script of every existing install. Until then every webhook delivery fails with `No JobNimbus apiKey`. Nothing else in an install changes.

## API keys and Access Profiles

A JobNimbus admin creates the key under Settings > API. A key acts with the Access Profile chosen for it, so give it one that can read and edit the jobs (or contacts) the install syncs and list the account's users. Records the profile can't see are invisible to both scripts: Send can't find them again, and the Webhook ignores them.

Use the same key as the `apiKey` secret on both scripts.

### Key expiry

JobNimbus keys expire one year after they are created, and keys created before Sep 18, 2026 ("legacy" keys) expire too ([JobNimbus help](https://support.jobnimbus.com/how-do-i-create-an-api-key)). When JobNimbus answers `401` or `403`, both scripts fail the delivery with `JobNimbus rejected this install's API key (…): the key is invalid, expired or lacks access`. Create a new key and replace the `apiKey` secret on both scripts.

## Webhook setup

JobNimbus sends webhooks from Automations. For each status change Terros should follow, create an Automation (Settings > Automations) on jobs whose trigger is the status change and whose action is **Webhook**, pointing at the install's `jobnimbus-webhook` URL. Only the payload's `jnid` is used.

JobNimbus caps how many Automations an account can have, and every webhook Automation counts toward it. Prefer one Automation whose trigger covers all the statuses Terros maps over one per status.

Set `workflowId`, and `requestType`: `update` moves only accounts already linked to the job, `upsert` (the default) also creates an account for a job started in JobNimbus, and `create` only creates.

## Webhook authentication

JobNimbus Automation webhooks are not signed, and Connect gives the script only the request body, so the URL is the only thing a sender needs. The Webhook therefore treats an event as a hint: it takes only `jnid` from the body and reads the job back with the install's key, then uses JobNimbus's current status, name, address, owner and linked account (`external_id`), never the body's. A forged event can at most re-apply a real job's current status, which a genuine event would do anyway; in `upsert` mode it can create the Terros account for a real, unlinked job early. A `jnid` the key can't read is logged and ignored.

## Primary contact

A job has no phone or email fields. When an install sets `contactType`, Send also keeps a contact for the resident (name, address, `email`, `home_phone`), created with `contactType` and `contactStatus` and linked as the job's `primary`. A contact is made only for a resident with a name, once the install's `requiredFields` are filled in. It carries the account ID in `external_id` and is found again by it, like jobs, so later changes update the same contact. Installs that don't set `contactType` get no contacts.

## Retries and duplicates

Every record Send creates carries the Terros account ID in `external_id`. Before creating, Send looks for a record with this account's ID (`GET /jobs?filter={"must":[{"term":{"external_id":…}}]}`) and, if it finds one, updates and links that record instead. So a delivery retried after the `externalLeadId` save failed, or a later change on an account whose `externalLeadId` never reached Terros, updates the job it already has rather than creating a second one.

Only a new record gets `status_name` and `record_type_name`; after that JobNimbus owns them and updates leave them alone.

## Rate limits

JobNimbus publishes no rate limits, so there is no client-side limiter. A `429` is retried up to three attempts in total, after `Retry-After` when JobNimbus sends it and otherwise after 1 then 2 seconds (each wait capped at 5 seconds). A Send run makes at most three calls (users, lookup, create or update), plus two more (lookup, create or update) when it syncs a primary contact; a Webhook run makes two (job, users).

## Not covered yet

- The `external_id` lookup and the `401`/`403` replies for an expired key were not tried against a live JobNimbus account. If the lookup misses, a retry creates a second record as before.
- The lookup and the create are separate calls and JobNimbus documents no idempotency key, so two deliveries for the same unlinked account that run at the same moment can still both create a record. Retries run one after another and are covered.
- Contacts created before 2.0.0 carry no `external_id`, so a retry for one of those can't find it.
- An account that loses its `externalLeadId` and is in an unmapped stage is skipped rather than looked up, so its job isn't updated until it reaches a mapped stage again.
- The Webhook reads jobs only; an Automation on contacts is ignored.
- Linking a contact through the job's `primary` field was not tried against a live JobNimbus account.
- Webhook payloads carry no custom fields, and none are synced either way.
