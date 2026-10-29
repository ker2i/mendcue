-- 004_auth_paths.sql — narrow privileged paths that must work before tenant
-- context exists (session/key lookup, bootstrap consume, worker lease).
-- These SECURITY DEFINER functions are the ONLY way the restricted
-- app_runtime role touches rows without app.tenant_id set. They operate by
-- unguessable hash/id only and are revoked from PUBLIC.
--
-- Everything else runs inside tenant-scoped transactions (see PgStore).

CREATE OR REPLACE FUNCTION auth_session_by_token(p_hash TEXT)
RETURNS SETOF customer_sessions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM customer_sessions WHERE token_hash = p_hash
$$;

CREATE OR REPLACE FUNCTION auth_consume_bootstrap(p_hash TEXT, p_now TIMESTAMPTZ)
RETURNS SETOF customer_sessions
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE customer_sessions SET bootstrap_used = TRUE, bootstrap_code_hash = NULL
  WHERE bootstrap_code_hash = p_hash AND bootstrap_used = FALSE AND expires_at > p_now
  RETURNING customer_sessions.*
$$;

CREATE OR REPLACE FUNCTION auth_staff_session(p_id UUID)
RETURNS SETOF staff_sessions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM staff_sessions WHERE id = p_id
$$;

CREATE OR REPLACE FUNCTION auth_service_key(p_hash TEXT)
RETURNS SETOF service_credentials
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM service_credentials WHERE key_hash = p_hash
$$;

CREATE OR REPLACE FUNCTION worker_lease_job(p_now TIMESTAMPTZ)
RETURNS SETOF background_jobs
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE background_jobs SET status = 'leased', attempts = attempts + 1,
    lease_until = now() + interval '60 seconds', updated_at = now()
  WHERE id = (
    SELECT id FROM background_jobs
    WHERE status = 'pending' OR (status = 'leased' AND lease_until < p_now)
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  RETURNING background_jobs.*
$$;

CREATE OR REPLACE FUNCTION worker_complete_job(p_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE background_jobs SET status = 'done', updated_at = now() WHERE id = p_id
$$;

CREATE OR REPLACE FUNCTION worker_fail_job(p_id UUID, p_error TEXT, p_retry BOOLEAN)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE background_jobs
  SET status = CASE WHEN p_retry THEN 'pending' ELSE 'failed' END,
      lease_until = CASE WHEN p_retry THEN NULL ELSE lease_until END,
      last_error = p_error, updated_at = now()
  WHERE id = p_id
$$;

CREATE OR REPLACE FUNCTION worker_older_turn_pending(p_case UUID, p_before TIMESTAMPTZ, p_exclude UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM background_jobs
    WHERE case_id = p_case AND kind = 'turn' AND id <> p_exclude
      AND status IN ('pending', 'leased') AND created_at < p_before
  )
$$;

-- Lock down: executable by the runtime role only.
REVOKE ALL ON FUNCTION auth_session_by_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_consume_bootstrap(TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_staff_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_service_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_lease_job(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_complete_job(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_fail_job(UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION worker_older_turn_pending(UUID, TIMESTAMPTZ, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_session_by_token(TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION auth_consume_bootstrap(TEXT, TIMESTAMPTZ) TO app_runtime;
GRANT EXECUTE ON FUNCTION auth_staff_session(UUID) TO app_runtime;
GRANT EXECUTE ON FUNCTION auth_service_key(TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION worker_lease_job(TIMESTAMPTZ) TO app_runtime;
GRANT EXECUTE ON FUNCTION worker_complete_job(UUID) TO app_runtime;
GRANT EXECUTE ON FUNCTION worker_fail_job(UUID, TEXT, BOOLEAN) TO app_runtime;
GRANT EXECUTE ON FUNCTION worker_older_turn_pending(UUID, TIMESTAMPTZ, UUID) TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_runtime;
