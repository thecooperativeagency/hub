CREATE TABLE IF NOT EXISTS planner_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  postengine_id INTEGER NOT NULL,
  cadence_days INTEGER NOT NULL,
  market TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_items (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  channel TEXT,
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  notes TEXT NOT NULL DEFAULT '',
  fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('planned', 'in_progress', 'ready', 'done', 'dropped')),
  CHECK (owner IS NULL OR owner IN ('Daisy', 'Eleanor', 'Frances', 'Ansel', 'Steve', 'Della', 'Lance')),
  CHECK (fixture IN (0, 1))
);

CREATE TABLE IF NOT EXISTS shoots (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  shoot_on TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  shooter TEXT NOT NULL DEFAULT 'Lance',
  location TEXT NOT NULL DEFAULT '',
  brief TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('planned', 'confirmed', 'done', 'cancelled')),
  CHECK (fixture IN (0, 1))
);

CREATE TABLE IF NOT EXISTS rollouts (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  month TEXT NOT NULL,
  program_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  fixture INTEGER NOT NULL DEFAULT 0,
  UNIQUE (store_id, month),
  CHECK (fixture IN (0, 1))
);

CREATE TABLE IF NOT EXISTS rollout_steps (
  id TEXT PRIMARY KEY,
  rollout_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  owner TEXT,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE (rollout_id, step_key),
  CHECK (status IN ('not_started', 'in_progress', 'waiting', 'done', 'blocked', 'na')),
  CHECK (owner IS NULL OR owner IN ('Daisy', 'Eleanor', 'Frances', 'Ansel', 'Steve', 'Della', 'Lance'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  store_id TEXT,
  title TEXT NOT NULL,
  starts_on TEXT,
  ends_on TEXT,
  decision TEXT NOT NULL DEFAULT 'pending',
  offer TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  owner TEXT,
  fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (decision IN ('pending', 'yes', 'no')),
  CHECK (owner IS NULL OR owner IN ('Daisy', 'Eleanor', 'Frances', 'Ansel', 'Steve', 'Della', 'Lance')),
  CHECK (fixture IN (0, 1))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  store_id TEXT,
  due_on TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT NOT NULL DEFAULT '',
  fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (owner IN ('Daisy', 'Eleanor', 'Frances', 'Ansel', 'Steve', 'Della', 'Lance')),
  CHECK (status IN ('open', 'doing', 'done', 'parked')),
  CHECK (fixture IN (0, 1))
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  store_id TEXT,
  kind TEXT NOT NULL DEFAULT 'creative',
  requested_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT NOT NULL DEFAULT '',
  due_on TEXT,
  fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (kind IN ('creative', 'publish', 'sponsorship', 'program', 'other')),
  CHECK (status IN ('pending', 'approved', 'changes', 'declined')),
  CHECK (requested_by IS NULL OR requested_by IN ('Daisy', 'Eleanor', 'Frances', 'Ansel', 'Steve', 'Della', 'Lance')),
  CHECK (fixture IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_calendar_starts ON calendar_items (starts_on);
CREATE INDEX IF NOT EXISTS idx_shoots_on ON shoots (shoot_on);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks (owner, status);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals (status);
CREATE INDEX IF NOT EXISTS idx_events_decision ON events (decision);
