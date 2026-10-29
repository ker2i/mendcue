-- Usage basis travels with immutable document versions imported by operators.
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS usage_basis TEXT;
