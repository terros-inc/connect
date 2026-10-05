# GoHighLevel integration

Connects a Terros company to one GoHighLevel location. Four scripts, one install.

| Script                          | Slug                              | Direction            | What it does                                                                                                                                                                                  |
| ------------------------------- | --------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GoHighLevel Account Sync        | `gohighlevel-account-sync`        | Terros → GoHighLevel | On each account change: creates or updates the contact, syncs notes both ways, saves the contact ID on the account, and creates the opportunity when the account enters an opportunity stage. |
| GoHighLevel Opportunity Webhook | `gohighlevel-opportunity-webhook` | GoHighLevel → Terros | A GoHighLevel workflow reports the pipeline stage a contact moved to. Moves the matching Terros account to the matching stage and imports notes.                                              |
| GoHighLevel Appointment Sync    | `gohighlevel-appointment-sync`    | Terros → GoHighLevel | Creates a GoHighLevel appointment for a Terros consultation, moves it when the Terros event moves, cancels it when the event is removed.                                                      |
| GoHighLevel Appointment Webhook | `gohighlevel-appointment-webhook` | GoHighLevel → Terros | A GoHighLevel workflow reports an appointment change. Moves or removes the linked Terros event.                                                                                               |

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

| Setting                | Format                             | Scripts                               | Required | Default           | What it does                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------- | ------------------------------------- | -------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `locationId`           | text                               | all four                              | yes      | none              | The GoHighLevel location (sub-account). The Opportunity Webhook throws if a webhook comes from another location; the Appointment Webhook logs and ignores it.                                                                                                                                                                   |
| `pipelineId`           | text                               | Account Sync                          | yes      | none              | Pipeline where opportunities are looked up and created.                                                                                                                                                                                                                                                                         |
| `calendarId`           | text                               | Appointment Sync, Appointment Webhook | yes      | none              | Calendar whose appointments are synced. Appointments on other calendars are ignored.                                                                                                                                                                                                                                            |
| `stageMappings`        | key/value rows                     | Account Sync, Opportunity Webhook     | no       | none              | Overrides how stages match, see below.                                                                                                                                                                                                                                                                                          |
| `contactFieldMappings` | key/value rows                     | Account Sync                          | no       | none              | Copies Terros account fields into GoHighLevel contact custom fields. Key: `account.<path>` (for example `account.owner.email`) or a custom field ID `CF.…`. Value: a merge field written exactly `{{ contact.field_key }}`. A value in any other form is skipped with a warning. Only text, numbers and true/false can be sent. |
| `opportunityStages`    | comma-separated Terros stage names | Account Sync                          | no       | `Appointment Set` | An account in one of these stages gets an opportunity if it has none. Names are matched ignoring case. Blank means the default.                                                                                                                                                                                                 |
| `opportunityIdFieldId` | `CF.…` custom field ID             | Account Sync                          | no       | none              | Receives the GoHighLevel opportunity ID. Without it the ID is not stored and each run searches for the opportunity again. A value not starting with `CF.` is ignored with a warning.                                                                                                                                            |
| `alertWebhookUrl`      | URL                                | Account Sync, Appointment Sync        | no       | none              | Receives a JSON POST when a sync needs attention (see Alerts).                                                                                                                                                                                                                                                                  |
| `alertRecipients`      | comma-separated emails             | Account Sync, Appointment Sync        | no       | none              | Copied into the alert JSON as `recipients`. Nothing is emailed by this integration.                                                                                                                                                                                                                                             |
| `disabled`             | switch                             | all four                              | no       | off               | Kill switch. When on, the script logs that it is disabled and does nothing.                                                                                                                                                                                                                                                     |
| `dryRun`               | switch                             | all four                              | no       | off               | Reads and logs what the script would write, and writes nothing.                                                                                                                                                                                                                                                                 |

Keys not listed here are ignored; each run logs them. `goHighLevelCompanyId` and `teamPipelines` appear in some older installs. Nothing reads either one: the company ID is looked up from the location, and every account uses `pipelineId`, so there is no per-team pipeline.

### Stage mapping

**Terros → GoHighLevel (Account Sync, when it creates an opportunity).** The account's Terros stage name is looked up in the `stageMappings` keys, ignoring case. The matching value is the GoHighLevel stage name. With no match the Terros stage name is used as is. The result must name exactly one stage in the pipeline, otherwise the run fails.

**GoHighLevel → Terros (Opportunity Webhook).** The GoHighLevel stage name is looked up in the `stageMappings` values, ignoring case, and the matching key is sent to Terros as the target stage. With no match the GoHighLevel stage name itself is sent. Terros accepts a stage or action ID, or a name listed in the workflow's integration mappings, and silently ignores anything else. So the key should be a Terros stage ID, or the workflow needs an integration mapping for that name. The webhook also records the GoHighLevel stage name on the account as its source status.

So one table serves both directions only if its keys can be both: a stage name suits outgoing, a stage ID suits incoming. With stage IDs as keys (HQ), incoming works and outgoing falls back to the Terros stage name. If two keys share a value, incoming uses the first.

### Alerts

`alertWebhookUrl` receives `{ "text", "accountId", "eventId"?, "stage", "message", "recipients" }` as a JSON POST. Triggers:

- Account Sync: an account in an opportunity stage has no closer. Sent once per account, as long as the account has an owner to record it under: a note starting `[GoHighLevel sync alert]` is saved on the account to remember it. These notes are never copied to GoHighLevel.
- Appointment Sync: it refused to create or change an appointment (the linked appointment is missing, on another contact, or the create limit of 2 per event was reached).

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
- `GHL_SYNC_ALERT` an alert was raised; `GHL_SYNC_ALERT delivery failed` the alert webhook did not accept it.
- `Missing required config`, `Unknown config key`, `Config key … is not used` the config needs attention.
- `Config disabled is …` or `Config dryRun is …` a switch holds text that is not true or false.
- `No GoHighLevel user matched` a closer's email has no GoHighLevel user, so nothing is assigned.
- `no Terros account is linked to this contact, skipping` the Opportunity Webhook found no Terros account for the contact. Expected for appointments booked directly in GoHighLevel; it cannot tell that apart from a lost link, and nothing alerts.
- `pipeline stage is blank, so only notes are imported` the workflow posted no stage (a note-change trigger, or a contact with no opportunity). The stage write is skipped and notes are imported as usual.
- `No stageMappings entry matched pipeline stage` the GoHighLevel stage name was sent to Terros as is.

## Developing and publishing

- `pnpm --filter @terros-inc/sdk... build`, then `pnpm exec tsc --noEmit` and `pnpm test` in this directory.
- Bump `version` in `package.json` before publishing; the `publish-integrations.yml` workflow publishes it.
