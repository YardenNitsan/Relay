export const schema = `
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS conversations (id text PRIMARY KEY, title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tasks (
 id text PRIMARY KEY, conversation_id text NOT NULL REFERENCES conversations(id), objective text NOT NULL,
 status text NOT NULL, options jsonb NOT NULL, result text, error text, calls_used integer NOT NULL DEFAULT 0,
 stop_generation integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS tasks_conversation ON tasks(conversation_id,created_at);
CREATE TABLE IF NOT EXISTS messages (id text PRIMARY KEY, conversation_id text NOT NULL REFERENCES conversations(id), task_id text REFERENCES tasks(id), role text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id,created_at);
CREATE TABLE IF NOT EXISTS task_steps (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), role text NOT NULL, title text NOT NULL, dependencies jsonb NOT NULL, status text NOT NULL, model_id text, output text, context jsonb, ordinal integer NOT NULL);
CREATE INDEX IF NOT EXISTS steps_task ON task_steps(task_id,ordinal);
CREATE TABLE IF NOT EXISTS agent_runs (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), step_id text NOT NULL REFERENCES task_steps(id), role text NOT NULL, model_id text NOT NULL, status text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
CREATE TABLE IF NOT EXISTS model_calls (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), agent_id text NOT NULL REFERENCES agent_runs(id), model_id text NOT NULL, status text NOT NULL, input_tokens integer, output_tokens integer, cost_usd double precision, context jsonb NOT NULL, error text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
CREATE TABLE IF NOT EXISTS tool_calls (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), agent_id text NOT NULL REFERENCES agent_runs(id), name text NOT NULL, arguments jsonb NOT NULL, status text NOT NULL, result text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
CREATE TABLE IF NOT EXISTS approvals (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), tool_call_id text NOT NULL, tool text NOT NULL, arguments jsonb NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS permission_decisions (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), tool_call_id text NOT NULL, decision text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS verification (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), kind text NOT NULL, summary text NOT NULL, passed boolean NOT NULL, details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS findings (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), agent_id text NOT NULL, model_id text NOT NULL, claim text NOT NULL, provenance jsonb NOT NULL, review_state text NOT NULL DEFAULT 'unreviewed', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS artifacts (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), name text NOT NULL, path text NOT NULL, mime text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS checkpoints (id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks(id), path text NOT NULL, metadata jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS workspaces (id text PRIMARY KEY, name text NOT NULL, source_path text, file_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS provider_connections (provider text PRIMARY KEY, enabled boolean NOT NULL DEFAULT true, secret_reference text, state jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS model_profiles (id text PRIMARY KEY, profile jsonb NOT NULL, measured_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS events (id bigserial PRIMARY KEY, task_id text REFERENCES tasks(id), type text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS events_task ON events(task_id,id);
CREATE TABLE IF NOT EXISTS audit_events (id bigserial PRIMARY KEY, task_id text, operation text NOT NULL, metadata jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, name text NOT NULL, email text UNIQUE, role text NOT NULL, enabled boolean NOT NULL DEFAULT true, permissions jsonb NOT NULL, session_version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), last_active_at timestamptz);
INSERT INTO users(id,name,role,permissions) VALUES ('owner','Local owner','owner','{"providers":["ollama","lmstudio","openai","anthropic","gemini"],"workspaceIds":[],"maxAccess":"workspace","maxConcurrentTasks":4,"maxCallsPerTask":64,"maxSecondsPerTask":3600,"dailyCloudBudgetUsd":0}') ON CONFLICT DO NOTHING;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT 'owner' REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT 'owner' REFERENCES users(id);
CREATE TABLE IF NOT EXISTS sessions (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), csrf_token text NOT NULL, remote boolean NOT NULL, user_agent text NOT NULL, version integer NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_active_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE users ADD COLUMN IF NOT EXISTS external_subject text;
CREATE INDEX IF NOT EXISTS tasks_user ON tasks(user_id,status);
ALTER TABLE model_calls ADD COLUMN IF NOT EXISTS reserved_cost_usd double precision;
ALTER TABLE model_calls ADD COLUMN IF NOT EXISTS cost_state text NOT NULL DEFAULT 'unknown';
ALTER TABLE verification ADD COLUMN IF NOT EXISTS check_key text;
ALTER TABLE verification ADD COLUMN IF NOT EXISTS sequence bigserial;
CREATE INDEX IF NOT EXISTS verification_checks ON verification(task_id,check_key,sequence);
INSERT INTO settings(key,value) VALUES ('control','{"stopped":false,"generation":0}') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;
`;
