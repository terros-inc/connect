# Gaiia

Gaiia is intended to hand a Terros account to Gaiia's order flow and sync order and account progress back to
Terros.

The integration is not ready for production use yet. Its order-link and webhook handlers are currently placeholders:
they do not generate links, process webhooks, or sync records. The setup and sync behavior below describe what will
be available after implementation is complete.

## Setup

1. Find the order-flow slug in the URL your team uses to create Gaiia orders. For
   `https://app.gaiia.com/<slug>/orders/active/create`, the value between `app.gaiia.com/` and `/orders` is the slug.
2. Set `slug` to that same value on both **Gaiia Order Link** and **Gaiia Order Webhook**. Enter only the slug, not
   the full URL.
3. Add a strong shared secret named `webhookSecret` to the install secrets for **Gaiia Order Webhook**.
4. Copy the incoming URL for **Gaiia Order Webhook** from the Terros install. In Gaiia Admin, open **Webhooks** and
   register that HTTPS URL with the same shared secret. Once the handler is implemented, it will use the secret to
   verify Gaiia's `X-Gaiia-Webhook-Signature` header.
5. Optionally configure `stageMappings` on **Gaiia Order Webhook** to map Gaiia order or account statuses to Terros
   account stages.

Do not activate this integration for production traffic until the handlers are implemented.

## Intended handoff

After implementation, **Gaiia Order Link** will build a prefilled link to
`https://app.gaiia.com/<slug>/orders/active/create` from the Terros account. Opening the link will let an agent review
and continue the order in Gaiia. The handoff will not create a lead or order through Gaiia's API.

## Intended sync

After implementation, **Gaiia Order Webhook** will use signed Gaiia events and the Terros account reference in the
order metadata to sync:

- the Gaiia order ID and resume link when an order is created;
- the Gaiia account ID, account status, and account overview link when the order creates a Gaiia account; and
- mapped order or account statuses to the configured Terros stages.

Events without a matching Terros account or a configured status mapping will not change an account.
