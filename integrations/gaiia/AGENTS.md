# Gaiia integration

This package contains the Gaiia order-link and webhook handlers. Follow the [GoHighLevel integration guidance](../gohighlevel/AGENTS.md) for the standard package layout, handler wrapper, tests, versioning and manual publish workflow. The publish bundle is not type-checked and the workflow's integration list is hardcoded.

The official handoff opens `https://app.gaiia.com/<slug>/orders/active/create?<parameters>`. Build the prefilled link locally from data already available to the signed-in agent; the platform holds no Gaiia API key for this link. Register the incoming HTTPS webhook in Gaiia Admin → Webhooks and verify its `X-Gaiia-Webhook-Signature` with the configured shared secret.

Keep the outgoing and incoming handlers' shared install settings aligned. Tests must use mocked payloads and must not call live Gaiia APIs or webhooks.
