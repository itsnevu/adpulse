-- AdPulse — Ads Analytics Platform (PostgreSQL 15)

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',      -- admin | viewer
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ad_accounts (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL CHECK (platform IN ('google','meta','linkedin')),
  external_id      TEXT NOT NULL,
  name             TEXT NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  access_token     TEXT,
  refresh_token    TEXT,
  token_expires_at TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'active',  -- active | paused | error
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, external_id)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id            BIGSERIAL PRIMARY KEY,
  ad_account_id BIGINT NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  external_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',     -- active | paused | ended
  objective     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ad_account_id, external_id)
);

CREATE TABLE IF NOT EXISTS metrics_daily (
  id           BIGSERIAL PRIMARY KEY,
  campaign_id  BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  impressions  BIGINT NOT NULL DEFAULT 0,
  clicks       BIGINT NOT NULL DEFAULT 0,
  spend        NUMERIC(14,2) NOT NULL DEFAULT 0,
  conversions  NUMERIC(12,2) NOT NULL DEFAULT 0,
  raw          JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, date)
);
CREATE INDEX IF NOT EXISTS idx_metrics_daily_date ON metrics_daily (date);

CREATE TABLE IF NOT EXISTS insights (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  summary         TEXT NOT NULL,
  recommendations JSONB NOT NULL DEFAULT '[]',      -- [{title, detail, impact}]
  model           TEXT,
  tokens_used     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id             BIGSERIAL PRIMARY KEY,
  platform       TEXT NOT NULL,
  status         TEXT NOT NULL,                     -- running | success | error
  records_synced INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS email_logs (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  insight_id BIGINT REFERENCES insights(id) ON DELETE SET NULL,
  sent_to    TEXT NOT NULL,
  status     TEXT NOT NULL,                         -- sent | error
  error      TEXT,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
