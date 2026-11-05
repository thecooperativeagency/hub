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
  kind TEXT NOT NULL DEFAULT 'note',
  channels TEXT NOT NULL DEFAULT '[]',
  goal TEXT NOT NULL DEFAULT '',
  offer_link TEXT NOT NULL DEFAULT '',
  creative_request TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  formats TEXT NOT NULL DEFAULT '[]',
  pipeline TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  postengine_post_id TEXT,
  fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status IN ('planned', 'in_progress', 'ready', 'done', 'dropped')),
  CHECK (kind IN ('note', 'post')),
  CHECK (pipeline IN ('', 'brief', 'creative', 'approved', 'queued', 'published')),
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
  duration_min INTEGER NOT NULL DEFAULT 60,
  shot_list TEXT NOT NULL DEFAULT '[]',
  window_start TEXT,
  window_end TEXT,
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
  brief_id TEXT,
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

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL,
  role TEXT NOT NULL,
  assignee TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  due_on TEXT,
  notes TEXT NOT NULL DEFAULT '',
  caption_draft TEXT NOT NULL DEFAULT '',
  asset_urls TEXT NOT NULL DEFAULT '[]',
  fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (role IN ('design', 'copy', 'photo', 'video', 'shoot')),
  CHECK (status IN ('requested', 'in_progress', 'delivered', 'approved')),
  CHECK (fixture IN (0, 1))
);

CREATE TABLE IF NOT EXISTS quarter_plans (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  quarter TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (store_id, quarter),
  CHECK (fixture IN (0, 1))
);

CREATE TABLE IF NOT EXISTS quarter_months (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  month TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT '',
  program_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (plan_id, month)
);

CREATE TABLE IF NOT EXISTS post_slots (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  month TEXT NOT NULL,
  channel TEXT NOT NULL,
  target_count INTEGER NOT NULL,
  UNIQUE (plan_id, month, channel)
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  format TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  shoot_id TEXT,
  fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CHECK (format IN ('photo', 'reel')),
  CHECK (source IN ('delivered', 'postengine', 'drive')),
  CHECK (fixture IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_jobs_brief ON jobs (brief_id);
CREATE INDEX IF NOT EXISTS idx_jobs_assignee ON jobs (assignee, status);
CREATE INDEX IF NOT EXISTS idx_assets_match ON assets (store_id, format);
