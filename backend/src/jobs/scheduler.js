// Cron scheduler:
// - SYNC_CRON: sync google then meta (with an in-memory overlap guard)
// - INSIGHT_EMAIL_CRON: generate a 7-day insight per user + email it
// Disabled entirely when DISABLE_CRON=true.
const cron = require("node-cron");
const config = require("../config");
const logger = require("../utils/logger");
const pool = require("../db/pool");
const syncService = require("../services/syncService");
const insightEngine = require("../services/insightEngine");
const mailer = require("../services/mailer");
const { todayStr, addDaysStr } = require("../utils/dates");

const tasks = [];

// In-memory guards so a slow run never overlaps with the next tick.
let syncRunning = false;
let insightRunning = false;

async function runScheduledSync() {
  if (syncRunning) {
    logger.info("[cron] sync sebelumnya masih berjalan — lewati tick ini.");
    return;
  }
  syncRunning = true;
  try {
    for (const platform of ["google", "meta"]) {
      // v1.1: runSync di-scope per user — jalankan untuk setiap user yang
      // punya ad_account aktif di platform ini (log-nya pun milik user tsb).
      const { rows: owners } = await pool.query(
        `SELECT DISTINCT user_id FROM ad_accounts
         WHERE platform = $1 AND status = 'active'`,
        [platform]
      );
      if (owners.length === 0) {
        logger.info(`[cron] sync ${platform}: tidak ada ad_account aktif — lewati.`);
        continue;
      }
      for (const owner of owners) {
        const log = await syncService.runSync(platform, owner.user_id);
        logger.info(
          `[cron] sync ${platform} (user ${owner.user_id}): ${log.status} (${log.records_synced} records)`
        );
      }
    }
  } catch (err) {
    logger.error({ err }, `[cron] sync gagal: ${err.message}`);
  } finally {
    syncRunning = false;
  }
}

async function runScheduledInsightEmails() {
  if (insightRunning) {
    logger.info("[cron] job insight email masih berjalan — lewati tick ini.");
    return;
  }
  insightRunning = true;
  try {
    const to = todayStr();
    const from = addDaysStr(to, -6); // last 7 days inclusive
    const { rows: users } = await pool.query(
      `SELECT id, name, email, role FROM users ORDER BY id ASC`
    );
    for (const user of users) {
      try {
        const insight = await insightEngine.generateInsight(user.id, from, to);
        await mailer.sendInsightEmail(user, insight);
      } catch (err) {
        // One failing user (e.g. no data yet) must not stop the others.
        logger.error(
          { err },
          `[cron] insight email untuk ${user.email} gagal: ${err.message}`
        );
      }
    }
  } catch (err) {
    logger.error({ err }, `[cron] job insight email gagal: ${err.message}`);
  } finally {
    insightRunning = false;
  }
}

function scheduleIfValid(expr, label, fn) {
  if (!cron.validate(expr)) {
    logger.warn(`[cron] ekspresi ${label} tidak valid: "${expr}" — job dilewati.`);
    return;
  }
  tasks.push(cron.schedule(expr, fn));
  logger.info(`[cron] ${label} terjadwal: "${expr}"`);
}

function startScheduler() {
  if (config.disableCron) {
    logger.info("[cron] DISABLE_CRON=true — scheduler tidak dijalankan.");
    return;
  }
  scheduleIfValid(config.syncCron, "sync ads", runScheduledSync);
  scheduleIfValid(config.insightEmailCron, "insight email", runScheduledInsightEmails);
}

function stopScheduler() {
  for (const task of tasks) {
    task.stop();
  }
  tasks.length = 0;
}

module.exports = { startScheduler, stopScheduler };
