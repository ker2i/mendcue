# Operator documentation workflow

No reviewed manufacturer manuals are currently supplied. Seed playbooks remain
examples, and do not establish model-specific coverage. The initial model list
must be selected with the technician; no brand/model coverage is invented here.

Install Poppler (`pdftotext`) on the operator workstation. Poppler 24.02 was verified
using local extracted packages on October 31; it is not bundled in the runtime image.
Obtain a permitted local original yourself; the importer
never fetches URLs. Customer-supplied URLs cannot trigger a server request.
Keep originals, extracted text and completed manifests under ignored private `data/`.

Prepare a manifest with `tenantId`, `publisher`, `title`, `sourceUrl` (or null),
`usageBasis`, `brand`, exact `models`, `version`, `reviewedBy: null`,
`extractionReviewed: false`, `applicabilityReviewed: false`.

```sh
npm run build
node scripts/import-knowledge.mjs prepare data/manifest.json data/original.pdf
```

Review the original and extracted pages, exact model suffixes, printed page labels,
and selected sections. The prepared bundle resets review flags. Set `include: true`
only on applicable reviewed pages, record a real reviewer, and set both review flags.
Scanned PDFs without usable text remain unavailable. No OCR provider is introduced.

```sh
node scripts/import-knowledge.mjs publish data/knowledge/HASH.json
```

The command requires a tenant and database credentials, verifies the retained original
hash, and records the usage basis. Bundle content determines a new immutable document
ID, preserving previous versions. Publishing is idempotent and can be rerun to complete
an interrupted import; documents with no chunks are never retrieved. Model-specific
pages require matching brand plus explicit exact model. Families require enumerated
reviewed membership, never a guessed prefix. Every selected page currently shares the
manifest's exact-model applicability; create separate bundles for different section scopes.
The CLI does not fetch manufacturer sources or provide public original-file URLs.

## Synthetic verification

After building, run `node scripts/knowledge-acceptance.mjs` with `pdftotext` on PATH.
It generates a two-page synthetic PDF in a private temporary directory and exercises
the actual CLI: extraction/page indexes, reset approval flags, original hashes,
permissions, and rejection of unreviewed, unselected or tampered content. It removes
its temporary files afterward and uses no model or real manual.

With `TEST_POSTGRES_URL` pointing to a dedicated local `mendcue_test*` database that
has been migrated and demo-seeded, the same command also publishes the synthetic
fixture and checks selected-page citations, exact-model applicability and tenant
isolation through `PgStore`. This optional run leaves synthetic rows in that test
database. Its scripted fixture review fields establish no real human approval or
manufacturer coverage.
