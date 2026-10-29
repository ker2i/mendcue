# Tenant onboarding

Everything organization-specific lives in tenant config — never in the engine.

## Create a tenant (operator SQL / seed pattern)

```sql
INSERT INTO tenants(id, slug, public_key, config) VALUES (
  'tnt_acme', 'acme-repair', 'pk_acme_001',
  '{ ... full TenantConfig JSON ... }'
);
```

Required config fields: name, orgType (`solo_repair` | `repair_company` |
`home_warranty` | `insurance`), branding, contact, timezone (pilot:
`America/Phoenix`), languages, allowedOrigins (EXTERNAL embed origins only —
the platform's own hosted origin is always allowed at runtime), publicKey,
categories, detailedCategories (`refrigerator`, `washer`, `dishwasher` have
detailed playbooks; others use the general path), serviceZips (or `null` for
unrestricted), requireStreetAddress, requiredFields, playbookVersions,
routing, notifications, retention, privacyText, openingMessage,
gasUtilityContact (per service area — e.g. Southwest Gas for Phoenix),
featureFlags.

Embed CORS: host-page session creation answers preflight only for the
platform origin and the tenant's `allowedOrigins`. Staff and integration
APIs emit no CORS headers (same-origin / server-to-server only).

Org type changes default wording/routing only — never the implementation.

## Knowledge ingestion (reviewed flow)

1. Operator uploads a document or approved source URL (staff API / direct DB
   in this release; admin upload UI is a TODO).
2. Record publisher, document type, hash, usage basis.
3. Extract text with page boundaries → page-linked chunks.
4. Declare exact models/categories covered (`explicitModels`, applicability).
5. Reviewer approves → `review_status='approved'`, immutable version.
6. Retrieval serves approved versions only; fuzzy matches never establish
   model applicability. Tenant-private docs need `tenant_id` +
   `visibility='tenant_private'` and never become shared automatically.

Scanned PDFs with unusable text stay unpublished until content is extracted
and reviewed. Do not invent manual contents or page citations.

## Webhooks

Register per tenant in `webhook_endpoints` (HTTPS only, SSRF-host block).
Receivers verify `x-intake-signature: sha256=<hmac(timestamp.body)>`,
dedupe by `event_id`, order by `seq` per case. See
`examples/integration/receiver.mjs`.

## Go-live checklist per tenant

- [ ] Real business name, contact, service ZIPs, timezone verified.
- [ ] Allowed origins set to the real website; demo origins removed.
- [ ] Privacy/consent text approved; demo banner removed.
- [ ] Gas utility contact correct for the service area.
- [ ] Staff accounts created; demo passwords rotated.
- [ ] Webhook endpoint verified with a signed test event.
- [ ] Restore rehearsal completed and dated.
