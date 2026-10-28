import { withoutUploadUrls } from './response.ts'

// `company/get` returns presigned avatar and icon upload URLs to a caller who may update the company; printing them
// would hand a write credential to the terminal or whatever reads its output.
it('drops presigned upload URLs from a response at any depth', () => {
  const company = { companyId: 'C.example', avatarUrl: 'https://cdn.example.test/a.png' }
  expect(
    withoutUploadUrls({
      type: 'success',
      company: {
        ...company,
        uploadAvatarUrl: 'https://upload.example.test/a',
        uploadIconUrl: 'https://upload.example.test/i',
      },
    })
  ).toEqual({ type: 'success', company })
  expect(withoutUploadUrls({ teams: [{ teamId: 'T.example', uploadAvatarUrl: 'x' }], count: 1 })).toEqual({
    teams: [{ teamId: 'T.example' }],
    count: 1,
  })
})
