-- ============================================================
--  Meetingrooms H20 — MySQL schema
--  Alle datetimes in UTC. Engine InnoDB, utf8mb4.
--  De seed-admin (tom@h20.gg) wordt NIET hier aangemaakt omdat
--  het wachtwoord een bcrypt-hash vereist — dat doet scripts/migrate.js.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---- Ruimtes ----
CREATE TABLE IF NOT EXISTS rooms (
  id          VARCHAR(32)  NOT NULL,
  name        VARCHAR(128) NOT NULL,
  subtitle    VARCHAR(255) NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- Actieve (lopende) meeting: max 1 per ruimte ----
CREATE TABLE IF NOT EXISTS active_meetings (
  room_id              VARCHAR(32)  NOT NULL,
  session_id           VARCHAR(64)  NOT NULL,
  started_at           DATETIME     NOT NULL,
  busy_until           DATETIME     NOT NULL,
  title                VARCHAR(255) NULL,
  email                VARCHAR(255) NOT NULL,
  name                 VARCHAR(255) NULL,
  show_title_on_screen TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id),
  CONSTRAINT fk_active_room FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- Geplande meetings ----
CREATE TABLE IF NOT EXISTS scheduled_meetings (
  id                   VARCHAR(64)  NOT NULL,
  room_id              VARCHAR(32)  NOT NULL,
  start_at             DATETIME     NOT NULL,
  end_at               DATETIME     NOT NULL,
  title                VARCHAR(255) NULL,
  email                VARCHAR(255) NOT NULL,
  name                 VARCHAR(255) NULL,
  show_title_on_screen TINYINT(1)   NOT NULL DEFAULT 0,
  created_at           DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sched_room_start (room_id, start_at),
  CONSTRAINT fk_sched_room FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- Historie / audit-log van afgeronde sessies ----
CREATE TABLE IF NOT EXISTS meeting_history (
  session_id    VARCHAR(64)  NOT NULL,
  room_id       VARCHAR(32)  NOT NULL,
  room_name     VARCHAR(128) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NULL,
  title         VARCHAR(255) NULL,
  started_at    DATETIME     NOT NULL,
  ended_at      DATETIME     NOT NULL,
  duration_min  INT          NOT NULL DEFAULT 0,
  end_reason    VARCHAR(32)  NOT NULL DEFAULT 'ended',
  logged_at     DATETIME     NOT NULL,
  PRIMARY KEY (session_id),
  KEY idx_hist_room (room_id),
  KEY idx_hist_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- Gebruikers ----
CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(64)  NOT NULL,
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  role          ENUM('admin','user','h20') NOT NULL DEFAULT 'user',
  password_hash VARCHAR(255) NOT NULL,
  pin_hash      VARCHAR(255) NULL,
  created_at    DATETIME     NOT NULL,
  invited_by    VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- Sessies ----
CREATE TABLE IF NOT EXISTS sessions (
  token       VARCHAR(64) NOT NULL,
  user_id     VARCHAR(64) NOT NULL,
  expires_at  DATETIME    NOT NULL,
  created_at  DATETIME    NOT NULL,
  PRIMARY KEY (token),
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- Uitnodigingen ----
CREATE TABLE IF NOT EXISTS invites (
  token       VARCHAR(64)  NOT NULL,
  email       VARCHAR(255) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  role        ENUM('admin','user','h20') NOT NULL DEFAULT 'user',
  invited_by  VARCHAR(255) NULL,
  created_at  DATETIME     NOT NULL,
  expires_at  DATETIME     NOT NULL,
  PRIMARY KEY (token),
  KEY idx_invites_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- Wachtwoord-resets ----
CREATE TABLE IF NOT EXISTS password_resets (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  user_id     VARCHAR(64)  NOT NULL,
  email       VARCHAR(255) NOT NULL,
  token       VARCHAR(64)  NOT NULL,
  expires_at  DATETIME     NOT NULL,
  created_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_resets_user (user_id),
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- PIN-setup links ----
CREATE TABLE IF NOT EXISTS pin_setups (
  token       VARCHAR(64)  NOT NULL,
  user_id     VARCHAR(64)  NOT NULL,
  email       VARCHAR(255) NOT NULL,
  expires_at  DATETIME     NOT NULL,
  created_at  DATETIME     NOT NULL,
  PRIMARY KEY (token),
  KEY idx_pin_user (user_id),
  CONSTRAINT fk_pin_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---- Seed: 4 vaste ruimtes ----
INSERT INTO rooms (id, name, subtitle, sort_order) VALUES
  ('aquarium', 'Aquarium',    'Glazen ruimte · 1e verdieping',     1),
  ('bundled',  'Bundled',     'Brainstormruimte · 1e verdieping',  2),
  ('lounge',   'Lounge Café', 'Café-zone · 1e verdieping',         3),
  ('raboroom', 'Raboroom',    'Vergaderruimte · 1e verdieping',    4)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), subtitle = VALUES(subtitle), sort_order = VALUES(sort_order);
