# GoHighLevel integration

Connects a Terros company to one GoHighLevel location. Five scripts, one install.

| Script                          | Slug                              | Direction            | What it does                                                                                                                                                                                  |
| ------------------------------- | --------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GoHighLevel Account Sync        | `gohighlevel-account-sync`        | Terros → GoHighLevel | On each account change: creates or updates the contact, syncs notes both ways, saves the contact ID on the account, and creates the opportunity when the account enters an opportunity stage. |
| GoHighLevel Opportunity Webhook | `gohighlevel-opportunity-webhook` | GoHighLevel → Terros | A GoHighLevel workflow reports the pipeline stage a contact moved to. Moves the matching Terros account to the matching stage and imports notes.                                              |
| GoHighLevel Appointment Sync    | `gohighlevel-appointment-sync`    | Terros → GoHighLevel | Creates a GoHighLevel appointment for a Terros consultation, moves it when the Terros event moves, cancels it when the event is removed.                                                      |
| GoHighLevel Appointment Webhook | `gohighlevel-appointment-webhook` | GoHighLevel → Terros | A GoHighLevel workflow reports an appointment change. Moves or removes the linked Terros event.                                                                                               |
| GoHighLevel Resync              | `gohighlevel-resync`              | Terros → GoHighLevel | Run on demand. Finds upcoming consultations with no GoHighLevel appointment, and accounts in an opportunity stage with no contact or opportunity, and repairs only those. See Resync.         |

Once an opportunity or appointment exists, GoHighLevel owns its stage, status and title. Terros only fills in a missing owner (opportunity) or moves an appointment in time and fills in a missing assignee.

The settings below are the `configSchema` in `terros.json`, which is generated from `src/configFields.ts`. Change a setting there, not in `terros.json` alone; `src/configFields.test.ts` fails if they differ.

## Setting up an install

1. In GoHighLevel, create a private integration token with access to contacts, notes, opportunities, pipelines, users, calendars and the location. The exact scope names are not verified here. Save it as the `privateIntegrationToken` secret on the install (all scripts except Appointment Webhook, which makes no GoHighLevel calls).
2. Fill in the settings for each script (below). The same value can be used across scripts.
3. In GoHighLevel, create a workflow that POSTs to each webhook script's URL:
   - Opportunity Webhook: send `customData.pipeline_stage` with the new stage name, plus the standard `location.id` and `contact_id`.
   - Appointment Webhook: send the standard appointment payload (`location.id` and `calendar.*`).
4. Set `dryRun` to `true` first, check the run logs for `DRY RUN:` lines, then clear it.

## Settings

Switches are text. Blank or `false` (also `no`, `off`, `0`) is off. `true` (also `yes`, `on`, `1`) is on. Any other text, such as `ture`, counts as **on** and logs an error, so a typo makes a script do nothing or write nothing rather than run. Lists are comma-separated text; blanks around items are ignored.

| Setting                | Format                             | Scripts                                | Required | Default           | What it does                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------- | -------------------------------------- | -------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `locationId`           | text                               | all five                               | yes      | none              | The GoHighLevel location (sub-account). The Opportunity Webhook throws if a webhook comes from another location; the Appointment Webhook logs and ignores it.                                                                                                                                                                   |
| `pipelineId`           | text                               | Account Sync, Resync                   | yes      | none              | Pipeline where opportunities are looked up and created.                                                                                                                                                                                                                                                                         |
| `calendarId`           | text                               | Appointment Sync, Appointment Webhook  | yes      | none              | Calendar whose appointments are synced. Appointments on other calendars are ignored.                                                                                                                                                                                                                                            |
| `stageMappings`        | key/value rows                     | Account Sync, Opportunity Webhook      | no       | none              | Overrides how stages match, see below.                                                                                                                                                                                                                                                                                          |
| `contactFieldMappings` | key/value rows                     | Account Sync                           | no       | none              | Copies Terros account fields into GoHighLevel contact custom fields. Key: `account.<path>` (for example `account.owner.email`) or a custom field ID `CF.…`. Value: a merge field written exactly `{{ contact.field_key }}`. A value in any other form is skipped with a warning. Only text, numbers and true/false can be sent. |
| `opportunityStages`    | comma-separated Terros stage names | Account Sync                           | no       | `Appointment Set` | An account in one of these stages gets an opportunity if it has none. Names are matched ignoring case. Blank means the default.                                                                                                                                                                                                 |
| `opportunityIdFieldId` | `CF.…` custom field ID             | Account Sync                           | no       | none              | Receives the GoHighLevel opportunity ID. Without it the ID is not stored and each run searches for the opportunity again. A value not starting with `CF.` is ignored with a warning.                                                                                                                                            |
| `alertWebhookUrl`      | URL                                | Account Sync, Appointment Sync, Resync | no       | none              | Receives a JSON POST when a sync needs attention (see Alerts).                                                                                                                                                                                                                                                                  |
| `alertRecipients`      | comma-separated emails             | Account Sync, Appointment Sync         | no       | none              | Copied into the alert JSON as `recipients`. Nothing is emailed by this integration.                                                                                                                                                                                                                                             |
| `mode`                 | `report` or `repair`               | Resync                                 | no       | `report`          | `report` logs what would be created and writes nothing. `repair` creates it. Any other text counts as `report`. A request body can override it for one run.                                                                                                                                                                     |
| `horizonDays`          | number, 1 to 60                    | Resync                                 | no       | `14`              | How far ahead to look for consultations with no appointment. Past events are never touched.                                                                                                                                                                                                                                     |
| `maxRecords`           | number, 1 to 100                   | Resync                                 | no       | `25`              | The most records one run creates (in report mode: reports as missing or failed) before it stops and says more remain.                                                                                                                                                                                                           |
| `timeBudgetSeconds`    | number, 1 to 50                    | Resync                                 | no       | `40`              | After this many seconds a run starts no new record, so it ends before the 60 second script limit.                                                                                                                                                                                                                               |
| `disabled`             | switch                             | all five                               | no       | off               | Kill switch. When on, the script logs that it is disabled and does nothing.                                                                                                                                                                                                                                                     |
| `dryRun`               | switch                             | all five                               | no       | off               | Reads and logs what the script would write, and writes nothing.                                                                                                                                                                                                                                                                 |

Keys not listed here are ignored; each run logs them. `goHighLevelCompanyId` and `teamPipelines` appear in some older installs. Nothing reads either one: the company ID is looked up from the location, and every account uses `pipelineId`, so there is no per-team pipeline.

### Stage mapping

**Terros → GoHighLevel (Account Sync, when it creates an opportunity).** The account's Terros stage name is looked up in the `stageMappings` keys, ignoring case. The matching value is the GoHighLevel stage name. With no match the Terros stage name is used as is. The result must name exactly one stage in the pipeline, otherwise the run fails.

**GoHighLevel → Terros (Opportunity Webhook).** The GoHighLevel stage name is looked up in the `stageMappings` values, ignoring case, and the matching key is sent to Terros as the target stage. With no match the GoHighLevel stage name itself is sent. Terros accepts a stage or action ID, or a name listed in the workflow's integration mappings, and silently ignores anything else. So the key should be a Terros stage ID, or the workflow needs an integration mapping for that name. The webhook also records the GoHighLevel stage name on the account as its source status.

So one table serves both directions only if its keys can be both: a stage name suits outgoing, a stage ID suits incoming. With stage IDs as keys (HQ), incoming works and outgoing falls back to the Terros stage name. If two keys share a value, incoming uses the first.

### Resync

Repairs what earlier incidents lost (an event saved before its stage, an install switched off, an account skipped for no closer). It does two passes, soonest and most urgent first, and nothing else: it never creates contacts for every account, never touches a past event, and never changes an existing appointment or opportunity.

1. **Appointments.** Consultation events from now to `horizonDays` ahead that have an account and a closer but no GoHighLevel appointment id. It creates the appointment through the same guarded path as Appointment Sync (create marker, 2 attempts per event, read-back, never over an existing link) and sends `toNotify: false`, so the closer and homeowner are not messaged. An event whose appointment id is set is never given a new appointment, even when GoHighLevel no longer finds that appointment: it is logged as `linked_appointment_not_found` and left for a person (clear the event's appointment id to have Resync create a new one).
2. **Accounts.** Accounts in one of `opportunityStages` that have a closer but no contact, or a contact with no opportunity. It creates the contact and the opportunity exactly as Account Sync does, including `stageMappings` and `opportunityIdFieldId`. An account that already holds its opportunity id in `opportunityIdFieldId` is not looked at in GoHighLevel at all, so set that field. Without it every account in scope costs two GoHighLevel calls per run, and since accounts are read most recently updated first (up to 3,000 per run), a long list of accounts already in sync can use the whole time budget.

A run stops at `maxRecords` or `timeBudgetSeconds`, whichever comes first, and the summary says `more: true`. Run it again: records already repaired are skipped, so a repeat creates nothing twice.

**Output.** One line per record: `GHL_RESYNC {"mode","kind","id","action","reason"}` where `action` is `would_create`, `created`, `skipped` or `error` and `reason` is a short code (`no_appointment_link`, `no_opportunity`, `no_contact_and_opportunity`, `in_sync`, `linked_appointment_not_found`, `no_ghl_user`, `no_closer`, `create_limit`, `ghl_http_<status>`, …). No names, emails or phones. Accounts outside the configured stages, or already holding their opportunity id, get no line and are only counted. The last line is `GHL_RESYNC_SUMMARY {…counts, "more", "ms"}`, and the same counts are posted to `alertWebhookUrl` (`stage: "Resync"`), so the receiver can mail them.

**Why an incoming script.** The platform also supports `scheduled` scripts, but none has run for this app: the install's schedule is not set from the manifest, and an admin has to set it and the permissions. An incoming script runs the moment someone calls it, so a repair is one request and can be repeated until `more` is false. Add a schedule later only once the first manual runs look right.

**Permissions** the install must grant this script: `account:list`, `account:save`, `company:read`, `event:read`, `event:save`. `event:read` and `account:list` are not held by the other GoHighLevel scripts, so the install's permissions may need them added by an admin with `install:manage`.

**Safe first run.**

1. Publish this version, add the Resync script to the install with the same `locationId`, `pipelineId`, `calendarId`, `stageMappings`, `contactFieldMappings`, `opportunityStages`, `opportunityIdFieldId` and `alertWebhookUrl` as the other scripts, leave `mode` blank, and grant the permissions above.
2. Call it (report mode, the default). It is the same kind of request the GoHighLevel workflows already send to the Appointment Webhook, only with the Resync slug and an empty body:

   ```sh
   curl -X POST "<connect incoming base URL>/connect/incoming/<installId>/gohighlevel-resync" \
     -H "<the API key header the existing webhook calls use>: <key>" \
     -H "Content-Type: application/json" -d '{}'
   ```

3. Read the summary (the alert email, or the `GHL_RESYNC_SUMMARY` log line): `would_create` is what a repair would create, `linkMissing` the events that need a person. Check a few `would_create` ids by hand in GoHighLevel, in particular for appointments someone booked directly there (Resync does not look for those and would create a duplicate).
4. Repair a small batch first: send `-d '{"mode":"repair","maxRecords":3}'`, check those three in GoHighLevel, then repeat with `-d '{"mode":"repair"}'` until the summary says `more: false`. `dryRun` in the install config always wins over the request body.

### Alerts

`alertWebhookUrl` receives `{ "text", "accountId", "eventId"?, "stage", "message", "recipients" }` as a JSON POST. Triggers:

- Account Sync: an account in an opportunity stage has no closer. Sent once per account, as long as the account has an owner to record it under: a note starting `[GoHighLevel sync alert]` is saved on the account to remember it. These notes are never copied to GoHighLevel.
- Appointment Sync: it refused to create or change an appointment (the linked appointment is missing, on another contact, or the create limit of 2 per event was reached).
- Resync: the summary of every run (`stage: "Resync"`, no `accountId`), with the counts in `text`.

Every alert is also logged as `GHL_SYNC_ALERT {…}`. A failed delivery is logged and never fails the sync. Alerts are still sent when `dryRun` is on.

## Worked example: HQ Energy

HQ's Account Sync and Opportunity Webhook config, with ids replaced by placeholders:

```json
{
  "locationId": "<location id>",
  "pipelineId": "<pipeline id>",
  "contactFieldMappings": {
    "CF.<custom field id>": "{{ contact.<field key> }}",
    "account.owner.email": "{{ contact.<owner email field key> }}"
  },
  "opportunityIdFieldId": "CF.<custom field id>",
  "opportunityStages": "<comma-separated Terros stage names>",
  "stageMappings": {
    "<Terros stage id 1>": "Shown",
    "<Terros stage id 2>": "Cancelled Appt/No Show",
    "<Terros stage id 3>": "Declined Proposal",
    "<Terros stage id 4>": "Follow-up/Nurture",
    "<Terros stage id 5>": "Contract Signed",
    "<Terros stage id 6>": "Cancelled Contract",
    "<Terros stage id 7>": "Installed"
  },
  "alertWebhookUrl": "<alert webhook url>",
  "dryRun": "",
  "goHighLevelCompanyId": "<unused>",
  "teamPipelines": { "<team id>": "<pipeline id>" }
}
```

- `dryRun: ""` is off.
- `stageMappings` uses Terros stage IDs as keys. A GoHighLevel move to `Shown` therefore sends that stage ID to Terros, which accepts it directly. On the Terros → GoHighLevel side these ID keys never match a stage name, so Account Sync uses the Terros stage name (for example `Appointment Set`) as the GoHighLevel stage name; that stage must exist with that name in the pipeline.
- `contactFieldMappings` copies one custom field and the owner's email into two GoHighLevel contact fields.
- `goHighLevelCompanyId` and `teamPipelines` have no effect and can be removed from the install whenever someone is in there; leaving them does no harm.

## Logs worth searching

- `DRY RUN:` a script would have written something.
- `GHL_RESYNC` one Resync record; `GHL_RESYNC_SUMMARY` the counts of a Resync run.
- `GHL_SYNC_ALERT` an alert was raised; `GHL_SYNC_ALERT delivery failed` the alert webhook did not accept it.
- `Missing required config`, `Unknown config key`, `Config key … is not used` the config needs attention.
- `Config disabled is …` or `Config dryRun is …` a switch holds text that is not true or false.
- `No GoHighLevel user matched` a closer's email has no GoHighLevel user, so nothing is assigned.
- `No stageMappings entry matched pipeline stage` the GoHighLevel stage name was sent to Terros as is.

## Developing and publishing

- `pnpm --filter @terros-inc/sdk... build`, then `pnpm exec tsc --noEmit` and `pnpm test` in this directory.
- Bump `version` in `package.json` before publishing; the `publish-integrations.yml` workflow publishes it.
