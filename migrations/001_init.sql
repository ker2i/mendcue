-- 001_init.sql — core schema. All tenant-owned rows carry tenant_id.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  public_key TEXT UNIQUE NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cases (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  source TEXT NOT NULL,
  conversation_phase TEXT NOT NULL,
  workflow_status TEXT NOT NULL,
  safety_status TEXT NOT NULL,
  disposition TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  external_reference TEXT NULL,
  diagnostic_questions_asked INT NOT NULL DEFAULT 0,
  model_mode TEXT NOT NULL DEFAULT 'fixture',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ NULL,
  UNIQUE (tenant_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_cases_tenant ON cases(tenant_id);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_case ON messages(tenant_id, case_id);

CREATE TABLE IF NOT EXISTS case_facts (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NULL,
  status TEXT NOT NULL,
  source_message_id UUID NULL,
  source_attachment_id UUID NULL,
  certainty TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  supersedes_id UUID NULL,
  confirmed_by TEXT NULL,
  confirmed_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_facts_case ON case_facts(tenant_id, case_id);

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL,
  storage_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  raw_ocr_text TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attachments_case ON attachments(tenant_id, case_id);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  bootstrap_code_hash TEXT NULL,
  bootstrap_used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_csessions_token ON customer_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_csessions_boot ON customer_sessions(bootstrap_code_hash);

CREATE TABLE IF NOT EXISTS assessments (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  hypotheses JSONB NOT NULL,
  recommended_follow_up TEXT NOT NULL,
  knowledge_level TEXT NOT NULL,
  citations JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, case_id)
);

CREATE TABLE IF NOT EXISTS handoff_versions (
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  version INT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot JSONB NOT NULL,
  PRIMARY KEY (case_id, version)
);

CREATE TABLE IF NOT EXISTS case_events (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_case ON case_events(tenant_id, case_id);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL,
  publisher TEXT NOT NULL,
  source_url TEXT NULL,
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  language TEXT NOT NULL,
  brand TEXT NULL,
  explicit_models JSONB NOT NULL DEFAULT '[]',
  explicit_families JSONB NOT NULL DEFAULT '[]',
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hash TEXT NOT NULL,
  version TEXT NOT NULL,
  review_status TEXT NOT NULL,
  reviewed_by TEXT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  tenant_id TEXT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL,
  version TEXT NOT NULL,
  page_index INT NOT NULL,
  page_label TEXT NULL,
  text TEXT NOT NULL,
  applicability JSONB NOT NULL,
  search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_search ON knowledge_chunks USING GIN(search);

CREATE TABLE IF NOT EXISTS document_model_applicability (
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  model_normalized TEXT NOT NULL,
  PRIMARY KEY (document_id, model_normalized)
);

CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  case_id UUID NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  lease_until TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON background_jobs(status, lease_until);

CREATE TABLE IF NOT EXISTS idempotency (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  response_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 1,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_users (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS staff_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS service_credentials (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_svc_hash ON service_credentials(key_hash);

CREATE TABLE IF NOT EXISTS repair_outcomes (
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rating TEXT NOT NULL,
  confirmed_issue TEXT NULL,
  hypotheses_useful BOOLEAN NULL,
  recorded_by UUID NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, case_id)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
