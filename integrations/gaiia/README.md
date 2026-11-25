# Gaiia Connect app

This package scaffolds the Gaiia Connect app's order-link and webhook handlers. Handler behavior is intentionally left for later implementation.

## Integration flow

The official handoff URL has this shape:

```text
https://app.gaiia.com/<slug>/orders/active/create?<parameters>
```

The prefilled URL is built locally from data already available to the signed-in agent. The platform holds no Gaiia API key for this link. Register the incoming HTTPS webhook in Gaiia Admin → Webhooks; later implementation will verify the `X-Gaiia-Webhook-Signature` header with the configured shared secret.

## Marketplace listing

- **Name:** Gaiia
- **Description:** Hands a Terros lead to Gaiia's prefilled order flow and syncs order and account updates back.
- **Terms of service:** https://gaiia.com/terms
- **Privacy policy:** https://gaiia.com/privacy-policy
- **Logo:** [`logo.png`](logo.png), copied from the [official 256×256 PNG](https://cdn.prod.website-files.com/685d8548ff18f67e0ca8eebe/68cac21323ea6040241dca17_gaiia-logo.png)

These values belong on the Connect app record after deployment, not in `terros.json`.

## Local development

Run `pnpm test` and `pnpm build` from this directory. Tests must use mocked payloads and must not call live Gaiia APIs or webhooks.
