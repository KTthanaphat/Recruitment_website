PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS requisitions (
  doc_id TEXT PRIMARY KEY,
  pr_approved_date TEXT,
  site TEXT NOT NULL,
  position TEXT NOT NULL,
  department TEXT NOT NULL,
  section TEXT,
  level TEXT,
  head_count INTEGER NOT NULL DEFAULT 1 CHECK (head_count > 0),
  person_in_charge TEXT,
  line_manager TEXT,
  status TEXT NOT NULL DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'filled', 'cancel')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS requisition_logs (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  log_date TEXT NOT NULL,
  status TEXT NOT NULL,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doc_id) REFERENCES requisitions(doc_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_groups (
  doc_group_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  group_id TEXT,
  group_position TEXT NOT NULL,
  channel_fb INTEGER NOT NULL DEFAULT 0 CHECK (channel_fb IN (0, 1)),
  channel_jobthai INTEGER NOT NULL DEFAULT 0 CHECK (channel_jobthai IN (0, 1)),
  channel_jobtopgun INTEGER NOT NULL DEFAULT 0 CHECK (channel_jobtopgun IN (0, 1)),
  channel_jobdb INTEGER NOT NULL DEFAULT 0 CHECK (channel_jobdb IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doc_id) REFERENCES requisitions(doc_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS position_groups (
  group_id TEXT PRIMARY KEY,
  group_position TEXT NOT NULL,
  channel_fb INTEGER NOT NULL DEFAULT 0 CHECK (channel_fb IN (0, 1)),
  channel_jobthai INTEGER NOT NULL DEFAULT 0 CHECK (channel_jobthai IN (0, 1)),
  channel_jobtopgun INTEGER NOT NULL DEFAULT 0 CHECK (channel_jobtopgun IN (0, 1)),
  channel_jobdb INTEGER NOT NULL DEFAULT 0 CHECK (channel_jobdb IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candidates (
  candidate_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone_no TEXT,
  doc_group_id TEXT NOT NULL,
  channel TEXT,
  ref_name TEXT,
  first_contact_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doc_group_id) REFERENCES document_groups(doc_group_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS recruitment_logs (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id TEXT NOT NULL,
  log_date TEXT NOT NULL,
  recruitment_process TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 1 CHECK (round > 0),
  interviewer TEXT,
  result INTEGER CHECK (result IN (0, 1)),
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES candidates(candidate_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS offers (
  offer_id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  accepted_date TEXT,
  first_working_date TEXT,
  offered_type TEXT,
  replaced TEXT,
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES candidates(candidate_id) ON DELETE CASCADE,
  FOREIGN KEY (doc_id) REFERENCES requisitions(doc_id) ON DELETE CASCADE,
  UNIQUE (candidate_id, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_requisition_logs_doc_id ON requisition_logs(doc_id);
CREATE INDEX IF NOT EXISTS idx_document_groups_doc_id ON document_groups(doc_id);
CREATE INDEX IF NOT EXISTS idx_candidates_doc_group_id ON candidates(doc_group_id);
CREATE INDEX IF NOT EXISTS idx_recruitment_logs_candidate_id ON recruitment_logs(candidate_id);
CREATE INDEX IF NOT EXISTS idx_offers_candidate_id ON offers(candidate_id);

CREATE TABLE IF NOT EXISTS change_logs (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  old_data TEXT,
  new_data TEXT
);

CREATE INDEX IF NOT EXISTS idx_change_logs_entity ON change_logs(entity, entity_id);
