# GoHighLevel integration

Customer setup, settings, behavior, and troubleshooting are documented in [DOCS.md](DOCS.md).

## Developer notes

The settings in `DOCS.md` describe the `configSchema` in `terros.json`, which is generated from
`src/configFields.ts`. Change a setting there, not in `terros.json` alone; `src/configFields.test.ts` fails if they
differ.
