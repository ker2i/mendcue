-- 002_rls.sql — row-level security. The runtime role must not bypass RLS.
-- App sets: SET LOCAL app.tenant_id = '<tenant>' inside each transaction.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime WITH LOGIN PASSWORD 'change_me_in_production';
  END IF;
END $$;

DO $$
BEGIN
  -- CURRENT_CATALOG is not substituted by GRANT; build the statement dynamically.
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoff_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_outcomes ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies (shared knowledge uses the separate path below).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cases','messages','case_facts','attachments','customer_sessions','assessments',
    'handoff_versions','case_events','background_jobs','idempotency','webhook_endpoints',
    'webhook_deliveries','staff_users','staff_sessions','service_credentials','repair_outcomes'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_iso ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      t);
  END LOOP;
END $$;

-- Knowledge: shared docs visible to all tenants; private docs only to their tenant.
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS knowledge_iso ON knowledge_documents;
CREATE POLICY knowledge_iso ON knowledge_documents
  USING (visibility = 'shared' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (visibility = 'shared' OR tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS knowledge_iso ON knowledge_chunks;
CREATE POLICY knowledge_iso ON knowledge_chunks
  USING (visibility = 'shared' OR tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (visibility = 'shared' OR tenant_id = current_setting('app.tenant_id', true));
