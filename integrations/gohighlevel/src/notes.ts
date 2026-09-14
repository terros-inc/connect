import { convert } from 'html-to-text'
import {
  type AccountData,
  type AccountNote,
  type SmallUser,
  type UnsavedAccountNote,
  type UserId,
  type UserListInput,
} from '@terros-inc/sdk'
import { formatNote, getUserName, isNotEmpty, normalizeText } from './util.ts'
import { type GoHighLevelUser } from './gohighlevel.ts'

export type GoHighLevelNote = {
  id: string
  body: string
  userId?: string
  dateAdded: string
  contactId: string
}

export type GoHighLevelNoteInput = {
  body: string
}

export function toText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  })
}

type NoteChanges = {
  goHighLevelNotes: GoHighLevelNoteInput[]
  terrosNotes: UnsavedAccountNote[]
}

export function getMissingUserIds(account: Pick<AccountData, 'notes'>, goHighLevelNotes: GoHighLevelNote[]): UserId[] {
  return [...new Set(getMissingNotes(account.notes ?? [], goHighLevelNotes).map((note) => note.userId))]
}

export function getIncomingUserIds(account: Pick<AccountData, 'notes'>, goHighLevelNotes: GoHighLevelNote[]): string[] {
  return [
    ...new Set(
      getIncomingNotes(account.notes ?? [], goHighLevelNotes).flatMap((note) => (note.userId ? [note.userId] : []))
    ),
  ]
}

export function getUserInput(terrosUserIds: UserId[], goHighLevelUserIds: string[]): UserListInput | undefined {
  if (isNotEmpty(goHighLevelUserIds)) return { showArchived: 'all' }
  if (isNotEmpty(terrosUserIds)) return { showArchived: 'all', userIds: terrosUserIds }
}

export function getChanges(
  account: Pick<AccountData, 'notes' | 'closerId' | 'ownerId'>,
  goHighLevelNotes: GoHighLevelNote[],
  users: SmallUser[],
  goHighLevelUsers: GoHighLevelUser[]
): NoteChanges {
  const accountNotes = account.notes ?? []
  const unsyncedTerrosNotes = getMissingNotes(accountNotes, goHighLevelNotes)
  const incomingNotes = getIncomingNotes(accountNotes, goHighLevelNotes)
  const usersById = new Map(users.map((user) => [user.userId, user]))
  const usersByEmail = new Map(users.map((user) => [normalizeText(user.email), user]))
  const goHighLevelUsersById = new Map(goHighLevelUsers.map((user) => [user.id, user]))

  const goHighLevelNoteInputs: GoHighLevelNoteInput[] = unsyncedTerrosNotes.map((note) => ({
    body: formatNote(getUserName(usersById.get(note.userId)), 'Terros', note.noteId, note.text),
  }))

  const fallbackUserId = account.ownerId ?? account.closerId

  const terrosNotes: UnsavedAccountNote[] = incomingNotes.map((note) => {
    const author = note.userId ? goHighLevelUsersById.get(note.userId) : undefined
    const timestamp = Date.parse(note.dateAdded)
    if (Number.isNaN(timestamp)) throw Error(`GoHighLevel note ${note.id} has invalid dateAdded ${note.dateAdded}`)

    const userId = author?.email ? usersByEmail.get(normalizeText(author.email))?.userId : undefined
    return {
      text: formatNote(getUserName(author), 'GHL', note.id, toText(note.body)),
      timestamp,
      userId: userId ?? requireUserId(fallbackUserId),
    }
  })

  return {
    goHighLevelNotes: goHighLevelNoteInputs,
    terrosNotes,
  }
}

type NoteSource = 'GHL' | 'Terros'

function getMissingNotes(accountNotes: AccountNote[], goHighLevelNotes: GoHighLevelNote[]): AccountNote[] {
  const syncedTerrosNoteIds = new Set(
    goHighLevelNotes.flatMap((note) => {
      const noteId = getSourceId(note.body, 'Terros')
      return noteId ? [noteId] : []
    })
  )
  return accountNotes.filter((note) => isNotSource(note.text, 'GHL') && !syncedTerrosNoteIds.has(note.noteId))
}

function getIncomingNotes(accountNotes: AccountNote[], goHighLevelNotes: GoHighLevelNote[]): GoHighLevelNote[] {
  const syncedIds = new Set(
    accountNotes.flatMap((note) => {
      const noteId = getSourceId(note.text, 'GHL')
      return noteId ? [noteId] : []
    })
  )
  return goHighLevelNotes.filter((note) => isNotSource(note.body, 'Terros') && !syncedIds.has(note.id))
}

function isSource(value: string | undefined, source: NoteSource): boolean {
  return getSourceId(value, source) !== undefined
}

function isNotSource(value: string | undefined, source: NoteSource): boolean {
  return !isSource(value, source)
}

function getSourceId(value: string | undefined, source: NoteSource): string | undefined {
  if (!value) return
  const compactMarker = new RegExp(`^.+ \\(${source} ([^)\\n]+)\\): `).exec(value)
  if (compactMarker?.[1]) return compactMarker[1]

  const legacyMarker = new RegExp(`(?:^|\\n\\n)\\[${source} Note ID: ([^\\]\\n]+)\\]$`).exec(value)
  return legacyMarker?.[1]
}

function requireUserId(userId: UserId | undefined): UserId {
  if (!userId) throw Error('No owner or closer on account')
  return userId
}
