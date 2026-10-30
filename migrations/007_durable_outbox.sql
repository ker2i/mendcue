-- Preserve historical migrations; scoped writes still use RLS.
ALTER TABLE background_jobs ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE background_jobs ADD COLUMN lease_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE background_jobs ADD COLUMN queue_order BIGSERIAL;
ALTER TABLE background_jobs ADD COLUMN operator_retries INTEGER NOT NULL DEFAULT 0;
CREATE INDEX jobs_available ON background_jobs(status, available_at, created_at);
CREATE UNIQUE INDEX delivery_event_endpoint ON webhook_deliveries(tenant_id, endpoint_id, event_id);

CREATE OR REPLACE FUNCTION worker_lease_job(p_now TIMESTAMPTZ)
RETURNS SETOF background_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE background_jobs SET status='failed', last_error='attempt limit reached after lease expiry', updated_at=p_now
  WHERE attempts>=max_attempts AND (status='pending' OR (status='leased' AND lease_until<=p_now));
  RETURN QUERY UPDATE background_jobs SET status='leased', attempts=attempts+1, lease_version=lease_version+1,
    lease_until=p_now+interval '120 seconds', updated_at=p_now
  WHERE id=(
    SELECT j.id FROM background_jobs j
    WHERE j.available_at<=p_now AND j.attempts<j.max_attempts
      AND (j.status='pending' OR (j.status='leased' AND j.lease_until<=p_now))
      AND NOT EXISTS (
        SELECT 1 FROM background_jobs older
        WHERE j.case_id IS NOT NULL AND older.tenant_id=j.tenant_id AND older.case_id=j.case_id
          AND (older.kind=j.kind OR (older.kind IN ('turn','label') AND j.kind IN ('turn','label')))
          AND older.status IN ('pending','leased','failed')
          AND older.queue_order<j.queue_order
      )
    ORDER BY j.queue_order LIMIT 1 FOR UPDATE OF j SKIP LOCKED
  ) RETURNING background_jobs.*;
END $$;
DROP FUNCTION worker_fail_job(UUID, TEXT, BOOLEAN);
CREATE FUNCTION worker_fail_job(p_id UUID, p_error TEXT, p_retry TIMESTAMPTZ, p_attempt INT DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE background_jobs SET
    status=CASE WHEN p_retry IS NOT NULL AND attempts<max_attempts THEN 'pending' ELSE 'failed' END,
    available_at=COALESCE(p_retry,available_at), lease_until=NULL,
    last_error=p_error, updated_at=now() WHERE id=p_id AND (p_attempt IS NULL OR (status='leased' AND lease_version=p_attempt))
$$;
REVOKE ALL ON FUNCTION worker_fail_job(UUID,TEXT,TIMESTAMPTZ,INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_fail_job(UUID,TEXT,TIMESTAMPTZ,INT) TO app_runtime;

DROP FUNCTION worker_complete_job(UUID);
CREATE FUNCTION worker_complete_job(p_id UUID, p_attempt INT DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE background_jobs SET status='done', lease_until=NULL, updated_at=now(),
    payload=CASE WHEN kind='storage_delete' THEN '{}'::jsonb ELSE payload END
  WHERE id=p_id AND (p_attempt IS NULL OR (status='leased' AND lease_version=p_attempt))
$$;
REVOKE ALL ON FUNCTION worker_complete_job(UUID,INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_complete_job(UUID,INT) TO app_runtime;
GRANT USAGE, SELECT ON SEQUENCE background_jobs_queue_order_seq TO app_runtime;
