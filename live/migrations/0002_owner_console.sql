-- Separate website ownership from campaign DM privileges.
CREATE TABLE site_owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1),user_id TEXT NOT NULL UNIQUE REFERENCES users(id),claimed_at INTEGER NOT NULL);
ALTER TABLE definitions ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE definitions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1));
ALTER TABLE access_grants ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE owner_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,target TEXT NOT NULL,before_json TEXT,after_json TEXT,created_at INTEGER NOT NULL);
CREATE INDEX owner_audit_time ON owner_audit(created_at);
CREATE TABLE owner_checks(id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1));
