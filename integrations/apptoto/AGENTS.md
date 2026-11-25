# Apptoto integration

This package contains the Apptoto appointment sync and webhook handlers. Follow the [GoHighLevel integration guidance](../gohighlevel/AGENTS.md) for the standard package layout, handler wrapper, tests, versioning and manual publish workflow. In particular, the publish bundle is not type-checked and the workflow's integration list is hardcoded.

Apptoto API calls use HTTP Basic authentication with the configured username and API key against `https://api.apptoto.com`. Apptoto does not sign webhook requests, so configure its webhook URL with the platform-required `apiKey` query parameter. The platform validates that key against the install's company before invoking the handler; query parameters are not passed to Connect handlers.

Keep the outgoing and incoming handlers' config schemas aligned where they share install settings. Tests must not call live Apptoto APIs.
