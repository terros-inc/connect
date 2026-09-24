import { type AccountData, type SmallUser } from '@terros-inc/sdk'
import {
  getChanges,
  getIncomingUserIds,
  getMissingUserIds,
  getUserInput,
  toText,
  type GoHighLevelNote,
} from './notes.ts'
import { type GoHighLevelUser } from './gohighlevel.ts'

describe('GoHighLevel note sync', () => {
  test('converts GHL note HTML to text', () => {
    expect(
      toText(
        '<p style="margin:0px; padding-left: 0px!important;">Very &amp; important</p><p>Next<br>line</p>'
      )
    ).toBe('Very & important\n\nNext\nline')
  })

  test('selects the smallest user list needed for note sync', () => {
    expect(getUserInput([], [])).toBeUndefined()
    expect(getUserInput(['U.terros'], [])).toEqual({ showArchived: 'all', userIds: ['U.terros'] })
    expect(getUserInput(['U.terros'], ['ghl-user'])).toEqual({ showArchived: 'all' })
  })

  test('returns only users with unsynced native Terros notes', () => {
    const account: Pick<AccountData, 'notes'> = {
      notes: [
        { noteId: 'Note.new', timestamp: 1, text: 'New', userId: 'U.new' },
        { noteId: 'Note.synced', timestamp: 2, text: 'Synced', userId: 'U.synced' },
        { noteId: 'Note.imported', timestamp: 3, text: 'Joe (GHL ghl-note): Imported', userId: 'U.imported' },
      ],
    }
    const goHighLevelNotes: GoHighLevelNote[] = [
      {
        id: 'ghl-synced',
        body: 'Terry (Terros Note.synced): Synced',
        dateAdded: '2026-09-11T12:00:00.000Z',
        contactId: 'ghl-contact',
      },
    ]

    expect(getMissingUserIds(account, goHighLevelNotes)).toEqual(['U.new'])
    expect(getIncomingUserIds(account, goHighLevelNotes)).toEqual([])
  })

  test('returns the missing note updates for both systems', () => {
    const account: Pick<AccountData, 'notes' | 'closerId' | 'ownerId'> = {
      closerId: 'U.terros',
      notes: [
        {
          noteId: 'Note.terros',
          timestamp: 1,
          text: 'Terros note',
          userId: 'U.terros',
        },
      ],
    }
    const users: SmallUser[] = [
      {
        userId: 'U.terros',
        firstName: 'Terry',
        lastName: 'Terros',
        email: 'terry@example.com',
      },
      {
        userId: 'U.joe',
        firstName: 'Joe',
        lastName: 'Example',
        email: 'joe@example.com',
      },
    ]
    const goHighLevelNotes: GoHighLevelNote[] = [
      {
        id: 'ghl-note',
        body: 'GHL note',
        userId: 'ghl-joe',
        dateAdded: '2026-09-11T12:00:00.000Z',
        contactId: 'ghl-contact',
      },
    ]
    const goHighLevelUsers: GoHighLevelUser[] = [
      {
        id: 'ghl-joe',
        firstName: 'Joe',
        lastName: 'Example',
        email: 'joe@example.com',
      },
    ]

    expect(getIncomingUserIds(account, goHighLevelNotes)).toEqual(['ghl-joe'])
    expect(getChanges(account, goHighLevelNotes, users, goHighLevelUsers)).toEqual({
      goHighLevelNotes: [
        {
          body: 'Terry Terros (Terros Note.terros): Terros note',
        },
      ],
      terrosNotes: [
        {
          text: 'Joe Example (GHL ghl-note): GHL note',
          timestamp: Date.parse('2026-09-11T12:00:00.000Z'),
          userId: 'U.joe',
        },
      ],
    })
  })

  test('does not resync notes whose source IDs already exist', () => {
    const account: Pick<AccountData, 'notes' | 'closerId' | 'ownerId'> = {
      closerId: 'U.terros',
      notes: [
        {
          noteId: 'Note.terros',
          timestamp: 1,
          text: 'Terros note',
          userId: 'U.terros',
        },
        {
          noteId: 'Note.imported',
          timestamp: 2,
          text: 'Joe (GHL ghl-note): Old contents',
          userId: 'U.terros',
        },
      ],
    }
    const goHighLevelNotes: GoHighLevelNote[] = [
      {
        id: 'ghl-imported',
        body: 'Terry(Terros): Old contents\n\n[Terros Note ID: Note.terros]',
        dateAdded: '2026-09-11T12:00:00.000Z',
        contactId: 'ghl-contact',
      },
      {
        id: 'ghl-note',
        body: 'Changed contents',
        dateAdded: '2026-09-11T12:00:00.000Z',
        contactId: 'ghl-contact',
      },
    ]

    expect(getChanges(account, goHighLevelNotes, [], [])).toEqual({
      goHighLevelNotes: [],
      terrosNotes: [],
    })
  })

  test('uses the owner consistently when GHL authors do not match Terros users', () => {
    const account: Pick<AccountData, 'notes' | 'closerId' | 'ownerId'> = {
      ownerId: 'U.owner',
      closerId: 'U.closer',
      notes: [],
    }
    const goHighLevelNotes: GoHighLevelNote[] = [
      {
        id: 'joe-note',
        body: 'Joe contents',
        userId: 'ghl-joe',
        dateAdded: '2026-09-11T12:00:00.000Z',
        contactId: 'ghl-contact',
      },
      {
        id: 'new-note',
        body: 'New contents',
        userId: 'ghl-sam',
        dateAdded: '2026-09-12T12:00:00.000Z',
        contactId: 'ghl-contact',
      },
    ]
    const goHighLevelUsers: GoHighLevelUser[] = [
      {
        id: 'ghl-joe',
        name: 'Joe Example',
      },
      {
        id: 'ghl-sam',
        name: 'Sam Example',
      },
    ]

    expect(getChanges(account, goHighLevelNotes, [], goHighLevelUsers).terrosNotes).toEqual([
      {
        text: 'Joe Example (GHL joe-note): Joe contents',
        timestamp: Date.parse('2026-09-11T12:00:00.000Z'),
        userId: 'U.owner',
      },
      {
        text: 'Sam Example (GHL new-note): New contents',
        timestamp: Date.parse('2026-09-12T12:00:00.000Z'),
        userId: 'U.owner',
      },
    ])
  })
})
