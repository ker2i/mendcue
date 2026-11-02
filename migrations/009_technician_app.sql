-- Additive technician app data. Existing submitted handoffs are immutable.
CREATE TABLE appointments (
 tenant_id TEXT NOT NULL REFERENCES tenants(id), case_id UUID NOT NULL,
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
 technician_id TEXT NOT NULL, active BOOLEAN NOT NULL, data JSONB NOT NULL,
 PRIMARY KEY(tenant_id,case_id), FOREIGN KEY(tenant_id,case_id) REFERENCES cases(tenant_id,id) ON DELETE CASCADE,
 CHECK(ends_at>starts_at)
);
CREATE INDEX appointments_calendar ON appointments(tenant_id,starts_at,ends_at) WHERE active;
ALTER TABLE staff_users ADD CONSTRAINT staff_users_tenant_id_uniq UNIQUE(tenant_id,id);
ALTER TABLE staff_sessions ADD CONSTRAINT staff_sessions_tenant_id_uniq UNIQUE(tenant_id,id);
ALTER TABLE staff_sessions ADD CONSTRAINT staff_sessions_owner_uniq UNIQUE(tenant_id,user_id,id);
CREATE TABLE staff_push_subscriptions (
 id UUID PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id UUID NOT NULL,
 session_id UUID NOT NULL, endpoint_hash TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, data JSONB NOT NULL,
 FOREIGN KEY(tenant_id,user_id) REFERENCES staff_users(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,user_id,session_id) REFERENCES staff_sessions(tenant_id,user_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX push_active_endpoint ON staff_push_subscriptions(endpoint_hash) WHERE enabled;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON appointments USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
CREATE POLICY tenant_iso ON staff_push_subscriptions USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON appointments,staff_push_subscriptions TO app_runtime;
-- Mutations and their receipts are committed together through the case CAS.
CREATE UNIQUE INDEX staff_mutation_unique ON case_events(tenant_id,(payload->>'recordedBy'),(payload->>'clientMutationId')) WHERE type='staff_mutation_receipt';
