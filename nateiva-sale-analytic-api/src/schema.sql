CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role ENUM('Expert', 'SubAdmin', 'SuperAdmin') NOT NULL DEFAULT 'Expert',
  city VARCHAR(120) NOT NULL DEFAULT 'DOUALA',
  active TINYINT(1) NOT NULL DEFAULT 1,
  data_scope ENUM('own', 'all') NOT NULL DEFAULT 'own',
  manage_users TINYINT(1) NOT NULL DEFAULT 0,
  panes_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_username_unique (username)
);

CREATE TABLE IF NOT EXISTS followups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  server_uid VARCHAR(80) NOT NULL,
  legacy_id VARCHAR(80) NULL,
  fingerprint CHAR(40) NOT NULL,
  event_timestamp VARCHAR(40) NOT NULL,
  expert VARCHAR(255) NOT NULL,
  school_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255) NOT NULL DEFAULT '',
  contact_phone VARCHAR(80) NOT NULL DEFAULT '',
  followup_type VARCHAR(50) NOT NULL,
  notes TEXT NULL,
  outcome TEXT NULL,
  next_action TEXT NULL,
  next_date VARCHAR(40) NULL,
  cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(120) NOT NULL DEFAULT 'En cours',
  city VARCHAR(120) NOT NULL DEFAULT '',
  sector VARCHAR(255) NOT NULL DEFAULT '',
  school_type VARCHAR(120) NOT NULL DEFAULT '',
  category VARCHAR(120) NOT NULL DEFAULT '',
  effectif VARCHAR(80) NOT NULL DEFAULT '',
  location TEXT NULL,
  contact_role VARCHAR(120) NOT NULL DEFAULT '',
  source VARCHAR(120) NOT NULL DEFAULT 'nateiva-sale-analytic-api',
  created_by_username VARCHAR(120) NOT NULL DEFAULT '',
  device_id VARCHAR(120) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  deleted_by_username VARCHAR(120) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY followups_server_uid_unique (server_uid),
  UNIQUE KEY followups_fingerprint_unique (fingerprint),
  KEY followups_legacy_id_idx (legacy_id),
  KEY followups_expert_idx (expert),
  KEY followups_school_idx (school_name),
  KEY followups_deleted_at_idx (deleted_at)
);

CREATE TABLE IF NOT EXISTS sync_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(120) NOT NULL,
  device_id VARCHAR(120) NOT NULL DEFAULT '',
  sync_type VARCHAR(80) NOT NULL,
  payload_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY sync_events_username_idx (username)
);

CREATE TABLE IF NOT EXISTS school_claim_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_year INT NOT NULL DEFAULT 2027,
  school_name VARCHAR(255) NOT NULL,
  school_key VARCHAR(255) NOT NULL,
  requested_by_username VARCHAR(120) NOT NULL,
  requested_by_fullname VARCHAR(255) NOT NULL DEFAULT '',
  current_owner_fullname VARCHAR(255) NOT NULL DEFAULT '',
  message TEXT NULL,
  status ENUM('pending','approved','denied') NOT NULL DEFAULT 'pending',
  decided_by_username VARCHAR(120) NOT NULL DEFAULT '',
  decision_note TEXT NULL,
  decided_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY scr_school_key_idx (school_key),
  KEY scr_status_idx (status),
  KEY scr_campaign_idx (campaign_year),
  KEY scr_requested_by_idx (requested_by_username)
);

ALTER TABLE followups MODIFY COLUMN notes MEDIUMTEXT NULL;

CREATE TABLE IF NOT EXISTS work_schedules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_username VARCHAR(120) NOT NULL,
  member_fullname VARCHAR(255) NOT NULL DEFAULT '',
  work_date DATE NOT NULL,
  day_type ENUM('field','office') NOT NULL,
  set_by_username VARCHAR(120) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ws_member_date (member_username, work_date),
  KEY ws_date_idx (work_date)
);

CREATE TABLE IF NOT EXISTS school_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  school_key VARCHAR(255) NOT NULL,
  school_name VARCHAR(255) NOT NULL,
  kind ENUM('note','file') NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  note TEXT NULL,
  file_name VARCHAR(255) NOT NULL DEFAULT '',
  mime VARCHAR(120) NOT NULL DEFAULT '',
  size_bytes INT UNSIGNED NOT NULL DEFAULT 0,
  storage_path VARCHAR(500) NOT NULL DEFAULT '',
  client_ref VARCHAR(80) NOT NULL DEFAULT '',
  created_by_username VARCHAR(120) NOT NULL,
  created_by_fullname VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY sd_school_idx (school_key),
  KEY sd_creator_idx (created_by_username),
  UNIQUE KEY sd_client_ref (client_ref, created_by_username)
);

-- Villes & quartiers ajoutés / supprimés par l'équipe (partagés par tous).
-- Une ligne par lieu ; action 'add' (ajouté) ou 'hide' (supprimé par un
-- Sub Admin / Super Admin, y compris un lieu du référentiel livré).
CREATE TABLE IF NOT EXISTS geo_places (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind ENUM('city','quartier') NOT NULL,
  action ENUM('add','hide') NOT NULL DEFAULT 'add',
  region VARCHAR(120) NOT NULL DEFAULT '',
  city_key VARCHAR(120) NOT NULL DEFAULT '',
  name VARCHAR(160) NOT NULL,
  name_key VARCHAR(160) NOT NULL,
  lat DECIMAL(9,6) NULL DEFAULT NULL,
  lng DECIMAL(9,6) NULL DEFAULT NULL,
  created_by_username VARCHAR(120) NOT NULL DEFAULT '',
  created_by_fullname VARCHAR(255) NOT NULL DEFAULT '',
  updated_by_username VARCHAR(120) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY gp_place (kind, city_key, name_key)
);
