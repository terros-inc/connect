# LeadPerfection integration

Connects a Terros company to [LeadPerfection](https://www.leadperfection.com) through the [LeadPerfection API](https://api.leadperfection.com/Help). Two scripts; turn on the direction(s) you need.

| Script              | Slug                  | Direction               | What it does                                                                                                                                                                   |
| ------------------- | --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LeadPerfection Send | `leadperfection-send` | Terros → LeadPerfection | When an account is in one of the stages you pick, sends it to LeadPerfection as a lead, once. The LeadPerfection lead ID is saved as the account's `externalLeadId`.           |
| LeadPerfection Sync | `leadperfection-sync` | LeadPerfection → Terros | Every few minutes, reads recent appointment results and job status changes from LeadPerfection and moves each matching Terros account to the stage you mapped for that status. |

LeadPerfection has no webhooks, so Sync polls.

## For your LeadPerfection security admin

1. Create a LeadPerfection user for Terros with a password.
2. Grant that user the APISECURITY function permissions for the calls the app makes:

   | Script | APISECURITY permission                                             |
   | ------ | ------------------------------------------------------------------ |
   | Send   | `LeadAdd`                                                          |
   | Sync   | `GetSalesApptDetailDateRange`, `GetJobStatusChanges` and `GetLead` |

3. For Sync, also give the user Security → Source API Access to the sources of the leads Terros should follow. Without it, `GetLead` returns no lead data and Sync can only match customers by phone.
4. Tell Terros your API server (`api`, `api2` or `api3`; a token works only on the server that issued it) and your client ID (site code).

When a call is refused for a missing permission, the run fails with a message naming the permission to grant.

## Install and configure

1. **Secrets.** In the install's Install Secrets section set:
   - `server`: the API server prefix, such as `api2` (`apitest` is LeadPerfection's sandbox).
   - `clientId`: your LeadPerfection site code, which is also your site subdomain.
   - `appKey`: the app key LeadPerfection issued to Terros.
   - `username` and `password`: the LeadPerfection user from the section above.
2. **LeadPerfection Send** config:
   - `sendStageIds` (required): comma-separated Terros stage IDs, such as the stage where an appointment is set.
   - `srs_id` (required): the numeric LeadPerfection source sub ID for these leads (SETUP - CUSTOMER - SOURCE SUBS).
   - `sender`, `productID`, `brn_id` (optional): LeadPerfection sender name, product code and market. Left blank, they are not sent, and LeadPerfection picks the market from product and ZIP code.
   - `timeZone` (optional): the IANA time zone of appointment times, such as `America/Chicago`. Blank uses the account owner's time zone.
3. **LeadPerfection Sync** config:
   - `workflowId` (required): the Terros workflow of the mapped stages.
   - `resultStages`: LeadPerfection appointment result → Terros stage ID, for example `Sale` → the stage for customers. Results are LeadPerfection disposition codes such as `Set`, `Sale`, `DNS`, `DNS-U` and `CXL`.
   - `jobStatusStages`: LeadPerfection job status → Terros stage ID, for example `Complete` → the stage for completed jobs.
   - `requestType` (optional): `update` (default) or `upsert`, see [Matching](#matching).
   - `lookbackDays` (optional): how many days back each run reads again. Defaults to 2.
   - `timeZone` (optional): your LeadPerfection site's IANA time zone, used for its dates. Defaults to UTC.
4. **Schedule.** See [Schedule](#schedule).

## What Send sends

An account in one of `sendStageIds` with no `externalLeadId` becomes one LeadPerfection lead (`LeadAdd`):

| LeadPerfection                            | Terros                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `firstname`, `lastname`                   | Resident's first and last name. An account missing either is skipped.                       |
| `address1`, `city`                        | Address line 1 (up to 40 characters) and city, in title case                                |
| `state`, `zip`                            | Two-letter state; 5-digit ZIP, or a Canadian postal code up to 7 characters                 |
| `phone`, `email`                          | Resident's phone and email                                                                  |
| `user1`, `user2`                          | Owner's (setter's) and closer's email                                                       |
| `notes`                                   | Account note                                                                                |
| `apptdate`, `appttime`                    | The account's appointment, both or neither, in the configured or owner's time zone          |
| `lognumber`                               | Terros account ID, which Sync uses to find the account again                                |
| `pro_id`                                  | Owner's Terros external user ID, when it is a number (the rep's LeadPerfection employee ID) |
| `sender`, `srs_id`, `productID`, `brn_id` | Install config                                                                              |

Once an account has an `externalLeadId`, Send skips it. Sync sets one on every account it links to or creates from a LeadPerfection customer (the customer's inbound lead ID, or `leadperfection:` and the customer ID when it has none), so Sync moving an account into a send stage does not send it back. Changes after the first send are not sent.

LeadPerfection does not merge a second lead for the same account, so Send adds each lead at most once. Before `LeadAdd`, Send claims the account by setting its `externalLeadId` to `pending:`, the time and a random suffix. Only one send can set it, so two changes to an account that arrive together add one lead, not two. When LeadPerfection rate-limits `LeadAdd` or the call fails before it is sent, Send tries again twice within the run. When LeadPerfection refuses the lead (such as a missing permission or a wrong `srs_id`), or those tries run out, Send replaces the claim with `failed:`, the time and the reason, and stops with an error. Send skips an account with a `failed:` value, so a refusal that keeps happening does not call LeadAdd again on every change. A person should fix the cause the reason names, then clear the `externalLeadId` (send `null` to `/account/update`), and the next change in a send stage sends the account. When `LeadAdd` times out (after 20 seconds), loses its connection, gets a server error or an unreadable reply, LeadPerfection may have added the lead anyway. Send then keeps the claim and stops with an error instead of trying again. A person should then look for the account ID as the `lognumber` in LeadPerfection's leads. If the lead is there, set the account's `externalLeadId` to its lead ID. If it is not, clear the `externalLeadId` (send `null` to `/account/update`) and the next change in a send stage sends the account. If an account still shows a `pending:` `externalLeadId` several minutes after the time in it, the send stopped without finishing: check it the same way.

## Matching

Sync looks for each LeadPerfection customer's Terros account in this order, and never by name alone:

1. An account an earlier run linked: Sync saves `leadperfection:` and the LeadPerfection customer ID, such as `leadperfection:1001`, as the account's `sourceId` when it first matches it, unless the account already has a `sourceId` from another system. The prefix keeps another system's account with the same number from matching.
2. The `lognumber` Send put on the lead, which is the Terros account ID.
3. The LeadPerfection lead ID Send saved as `externalLeadId`.
4. The phone number, among up to 1,000 accounts at the customer's ZIP code. Two or more accounts with that phone match nothing.

Steps 2 and 3 read the customer's leads with `GetLead`. A customer with no match is skipped with `requestType: update`; with `upsert`, Sync creates a Terros account for it (name, address, phone and email from LeadPerfection), linked by its customer ID.

## Stages

For each customer, Sync takes the latest appointment result and the latest job status in the window. A mapped job status wins over the appointment result, so an installed job moves past Sale. The account's last action date is the entry date for `Set`, the appointment date for other results, and the contract date for a job status. Unmapped values are left alone, and an account already in its target stage is not changed, so reading the same window again changes nothing.

## Schedule

A scheduled script runs on its install's own schedule, set per install script, not on the script's `cron`: the Integrations page offers Hourly, Daily and Weekly and starts at Daily. Sync is meant to run every 10 minutes, so a Terros admin sets that install script's `schedule` to `rate(10 minutes)` with `/connect/install/update`.

Each run reads the last `lookbackDays` days again, since LeadPerfection has no webhooks and the script keeps no cursor between runs.

## Limits

LeadPerfection allows 60 API calls a minute, and a script run has a minute. One Sync run makes at most 5 `GetJobStatusChanges` pages of 100, one `GetSalesApptDetailDateRange` and 40 `GetLead` lookups, and stops taking new customers 45 seconds after it starts. It reads job status changes newest first, so in a window with more than 500 it reads the newest 500 and skips the older ones, which earlier runs normally read while they were newer. Each run starts at a random customer, so customers left over from lookups or time are reached by a later run, which reads the same window again. Customers already linked cost no `GetLead` call.

## Not covered yet

- Changes to an account after it is sent, such as a new appointment time (`SetAppointment`, `UpdateCustomer`).
