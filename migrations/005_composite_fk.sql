-- 005_composite_fk.sql — enforce the tenant/case pair on child records so a
-- row can never reference a case from another tenant.
ALTER TABLE cases ADD CONSTRAINT cases_tenant_case_uniq UNIQUE (tenant_id, id);

ALTER TABLE messages ADD CONSTRAINT messages_tenant_case_fk
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE case_facts ADD CONSTRAINT case_facts_tenant_case_fk
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE attachments ADD CONSTRAINT attachments_tenant_case_fk
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE customer_sessions ADD CONSTRAINT customer_sessions_tenant_case_fk
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE assessments ADD CONSTRAINT assessments_tenant_case_fk
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE handoff_versions ADD CONSTRAINT handoff_versions_tenant_case_fk
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE case_events ADD CONSTRAINT case_events_tenant_case_fk
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_tenant_case_fk
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE repair_outcomes ADD CONSTRAINT repair_outcomes_tenant_case_fk
  FOREIGN KEY (tenant_id, case_id) REFERENCES cases(tenant_id, id) ON DELETE CASCADE;
