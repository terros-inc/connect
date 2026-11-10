# ServiceTitan

Sends Terros consultation appointments to ServiceTitan. When a consultation is booked or changed in Terros, the app creates or updates a ServiceTitan job and its appointment, assigned to the matching technician. The sync is one way: changes made in ServiceTitan do not come back to Terros.

## Setup

1. In ServiceTitan, create API credentials for your tenant: an application key, a client ID and a client secret.
2. Install the app and enter these install secrets:
   - `appKey`: the ServiceTitan application key
   - `clientId`: the OAuth client ID
   - `clientSecret`: the OAuth client secret
   - `tenantId`: your numeric ServiceTitan tenant ID
3. In Terros, create an account text custom field to hold the ServiceTitan job link. It can be restricted to certain roles, such as Admin: the install is given read and write access to this one field, so the person saving the install must be able to view and edit it.
4. Fill in the script settings. ServiceTitan IDs are entered as numbers.

| Setting                         | Required | What it does                                                                                      |
| ------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `jobTypeId`                     | yes      | ServiceTitan job type used for new jobs.                                                          |
| `serviceTitanJobId`             | yes      | The Terros account text custom field from step 3 (for example `CF.servicetitanjob`).              |
| `cancelReasonId`                | yes      | ServiceTitan cancellation reason used when a job is replaced because the closer changed.          |
| `customFieldCustomerId`         | no       | ServiceTitan customer custom field that stores the Terros account ID. Turns on customer matching. |
| `customFieldLocationId`         | no       | ServiceTitan location custom field that stores the Terros account ID.                             |
| `customFieldSetter`             | no       | ServiceTitan job custom field that stores the appointment owner's name.                           |
| `customFieldAppointmentOutcome` | no       | ServiceTitan job custom field that stores the appointment status.                                 |
| `campaignIdSetterGen`           | no       | Campaign for appointments whose owner has the Needs Help closer status.                           |
| `campaignIdCloserGen`           | no       | Fallback campaign.                                                                                |
| `campaignIdUnknown`             | no       | Final fallback campaign.                                                                          |
| `teamToBusinessUnitMap`         | no       | Maps a ServiceTitan technician team name to a business unit ID.                                   |

Set at least one campaign that applies to every appointment owner: Needs Help owners use `campaignIdSetterGen`, then `campaignIdCloserGen`, then `campaignIdUnknown`; other owners use `campaignIdCloserGen`, then `campaignIdUnknown`. A technician whose team is not in `teamToBusinessUnitMap` uses their own ServiceTitan business unit.

## What syncs

- **New consultation, account not yet linked:** the app finds the ServiceTitan customer (only when `customFieldCustomerId` is set, by name, address and the stored Terros account ID) or creates a residential customer and location with the account's address, email and phone. It then creates a job with the appointment time and technician, and saves the job link on the Terros account.
- **Changed consultation, account already linked:** the app updates the job's campaign and configured custom fields when they changed, and reschedules the appointment when its start or end time changed.
- **Closer changed:** when the appointment's attendee is a different technician from the one assigned in ServiceTitan, the app creates a replacement job for the same customer and location, links it, and cancels the old job with your cancellation reason.
- **Technician matching:** the attendee is matched to a ServiceTitan technician by their linked user ID when there is one, otherwise by name.

## What doesn't sync

- Appointments other than consultations, and consultations without an attendee, owner or account.
- A consultation on an account not yet linked to a job when the account has no homeowner details.
- Accounts whose account source is not Terros.
- Appointments whose attendee matches no ServiceTitan technician.
- Deleting a consultation in Terros does not cancel the ServiceTitan job.
- Nothing is written from ServiceTitan back to Terros.

## Known limits

- Only the first customer search result, first technician match, first location and first active assignment are used.
- Without `customFieldCustomerId`, the app cannot find an existing ServiceTitan customer and creates a new one for each newly linked account.
- In rare cases (two updates for the same new appointment at once, or a failure right after a job is created) a duplicate job can be created. The created job ID is always written to the run log.
- If cancelling the old job after a closer change fails, the run log records an error starting with `SERVICETITAN_ABANDONED_CANCEL`, and the old job must be cancelled by hand in ServiceTitan.
- Missing or invalid settings or secrets, or an account without an address, fail the run with an error in the run log.
