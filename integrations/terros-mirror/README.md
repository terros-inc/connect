# Terros Mirror

A demo Connect app that shows Terros Connect working end to end without a third-party system. It copies each new account in one Terros company (the source, for example "Acme Solar", a lead-setting company) into a second Terros company (the target, for example "Demo Closer", a closing company), together with the appointment booked on it. The Connect app record is named "Terros"; "Terros Mirror" is what we call this demo.

It is one-way: nothing is written back to the source.

## What it does

The app is installed on the source company only. Terros has no cross-company sharing, and the install's own Connect token is scoped to the source company, so both scripts call the Terros API with the **target company's API key**, stored as the `targetApiKey` install secret. The scripts need no permissions on the source company: everything they copy is in the event payload.

- **Terros Mirror Account Copy** (`src/account.ts`, outgoing on Account): on a new account, calls `account/upsert` in the target with the homeowner's name, email, phone and business name and the address. The source account ID becomes the target account's `sourceId`, and the account source is `Terros Mirror`. Updates and removals in the source are not copied. Owner, closer, workflow stage and custom fields are not copied: their IDs only mean something in the source company, and the target company assigns its own people.
- **Terros Mirror Appointment Copy** (`src/appointment.ts`, outgoing on Event): on a new appointment that has an account, finds the target account by `sourceId` (`account/match`) and calls `calendar/event/upsert` with the title, type, date, duration and note. The source event ID becomes the target event's `sourceId`. If the account has not been copied yet, the run fails so Connect retries it, rather than creating the account itself and racing the account copy.

**Idempotency.** `account/upsert` and `calendar/event/upsert` match an existing record by `sourceId` before they create one, so a repeated event after the copy exists updates the copy instead of creating a second account or appointment.

When no account matches by `sourceId`, `account/upsert` falls back to matching by address, even in a new, empty target. Two source accounts at the same address can therefore end up as one target account (the later copy takes it over), and appointments for the earlier one then fail. If the target company denies duplicate accounts, the second copy saves nothing and its run fails without retries.

**Failures are visible.** A failed Terros API call throws, so the run is logged as failed and retried. A missing `targetApiKey` throws a `PermanentError`, which fails the run without retries.

Only accounts created after the install are copied. An appointment booked later on an older account fails its runs, because that account has no copy.

## Install on two companies

Each company keeps its own install and its own credentials; the app is never moved or shared between companies.

1. **Target company** ("Demo Closer"): create a dedicated API key whose user has company-wide `account:list` (an admin has it), and restrict the key to `account:list`, `account:save` and `event:save`. `account:list` is required: `account/match` only returns accounts the key can view, so without it no appointment is ever copied. `account/upsert` and `calendar/event/upsert` check no permission today, so `account:save` and `event:save` only keep the key working if they start to. Installing the app on the target company is not needed.
2. **Source company** ("Acme Solar"): with `Feature:Connect` on, install the app from the Marketplace. It has no config fields.
3. On that install's **Install Secrets** section, set `targetApiKey` to the target company's key. Set it only there, never in config, tickets, chat or logs.
4. Check it: create an account with an appointment in the source; exactly one account and one appointment appear in the target. With a wrong key, the run shows as failed in the app's run log.

To point the demo at a different target company, replace the `targetApiKey` install secret.
