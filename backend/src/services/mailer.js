// Email service — sends the weekly AI insight digest + password reset link
// over SMTP. When SMTP_HOST is empty the send is skipped (logged, no
// email_logs row) so local/dev environments work without a mail server.
const nodemailer = require("nodemailer");
const config = require("../config");
const logger = require("../utils/logger");
const pool = require("../db/pool");

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465, // SMTPS on 465, STARTTLS otherwise
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined,
    });
  }
  return transporter;
}

const IMPACT_LABEL = { high: "Tinggi", medium: "Sedang", low: "Rendah" };
const IMPACT_COLOR = { high: "#dc2626", medium: "#d97706", low: "#16a34a" };

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Simple, inline-styled HTML that renders well in most email clients.
function buildInsightHtml(user, insight) {
  const recs = Array.isArray(insight.recommendations)
    ? insight.recommendations
    : [];
  const recRows = recs
    .map((r) => {
      const impact = IMPACT_LABEL[r.impact] || "Sedang";
      const color = IMPACT_COLOR[r.impact] || "#d97706";
      return `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;">
            <div style="font-weight:600;color:#111827;margin-bottom:4px;">${escapeHtml(r.title)}</div>
            <div style="color:#4b5563;font-size:14px;line-height:1.5;">${escapeHtml(r.detail)}</div>
          </td>
          <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;vertical-align:top;white-space:nowrap;">
            <span style="color:${color};font-weight:600;font-size:13px;">Dampak: ${impact}</span>
          </td>
        </tr>`;
    })
    .join("");

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;color:#ffffff;padding:20px 24px;">
        <div style="font-size:18px;font-weight:700;">AdPulse — Insight Mingguan</div>
        <div style="font-size:13px;color:#9ca3af;margin-top:4px;">
          Periode ${escapeHtml(insight.period_start)} s/d ${escapeHtml(insight.period_end)}
        </div>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 8px;color:#111827;">Halo ${escapeHtml(user.name)},</p>
        <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">
          Berikut ringkasan performa iklan Anda beserta rekomendasi dari AI:
        </p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:16px;color:#374151;font-size:14px;line-height:1.6;">
          ${escapeHtml(insight.summary)}
        </div>
        <h3 style="margin:24px 0 8px;color:#111827;font-size:15px;">Rekomendasi</h3>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;">
          ${recRows || '<tr><td style="padding:12px 16px;color:#6b7280;">Tidak ada rekomendasi.</td></tr>'}
        </table>
        <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">
          Email ini dikirim otomatis oleh AdPulse. Buka dashboard untuk detail lengkap.
        </p>
      </div>
    </div>
  </div>`;
}

// Send the insight email to a user. Writes an email_logs row on real send
// attempts (sent/error); skips silently (log only) when SMTP is not set.
async function sendInsightEmail(user, insight) {
  if (!config.smtp.host) {
    logger.info(
      `[mailer] SMTP_HOST kosong — lewati pengiriman email insight ke ${user.email}.`
    );
    return { skipped: true };
  }

  try {
    await getTransporter().sendMail({
      from: `"AdPulse" <${config.smtp.from}>`,
      to: user.email,
      subject: `AdPulse — Insight Iklan ${insight.period_start} s/d ${insight.period_end}`,
      html: buildInsightHtml(user, insight),
    });
    await pool.query(
      `INSERT INTO email_logs (user_id, insight_id, sent_to, status)
       VALUES ($1, $2, $3, 'sent')`,
      [user.id, insight.id, user.email]
    );
    logger.info(`[mailer] insight terkirim ke ${user.email}`);
    return { sent: true };
  } catch (err) {
    logger.error({ err }, `[mailer] gagal kirim ke ${user.email}: ${err.message}`);
    await pool.query(
      `INSERT INTO email_logs (user_id, insight_id, sent_to, status, error)
       VALUES ($1, $2, $3, 'error', $4)`,
      [user.id, insight.id, user.email, err.message]
    );
    return { sent: false, error: err.message };
  }
}

// HTML sederhana untuk email reset password.
function buildPasswordResetHtml(user, resetUrl) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#111827;color:#ffffff;padding:20px 24px;">
        <div style="font-size:18px;font-weight:700;">AdPulse — Reset Password</div>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 8px;color:#111827;">Halo ${escapeHtml(user.name)},</p>
        <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">
          Kami menerima permintaan reset password untuk akun Anda.
          Klik tombol di bawah untuk membuat password baru.
          Link ini berlaku <strong>60 menit</strong> dan hanya bisa dipakai sekali.
        </p>
        <p style="margin:0 0 16px;">
          <a href="${escapeHtml(resetUrl)}"
             style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600;">
            Reset Password
          </a>
        </p>
        <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
          Jika tombol tidak berfungsi, salin link berikut ke browser:<br />
          ${escapeHtml(resetUrl)}<br /><br />
          Abaikan email ini jika Anda tidak meminta reset password.
        </p>
      </div>
    </div>
  </div>`;
}

// Kirim email reset password. SMTP kosong → link di-log (dev tetap bisa
// reset lewat link di log). Tidak pernah throw — respons /forgot harus
// selalu {ok:true} (anti user-enumeration).
async function sendPasswordResetEmail(user, resetUrl) {
  if (!config.smtp.host) {
    if (config.nodeEnv === "production") {
      // JANGAN tulis reset URL (memuat raw token single-use) ke log
      // production — siapa pun dengan akses log bisa mereset akun tsb.
      logger.error(
        `[mailer] SMTP_HOST kosong di production — email reset password untuk ${user.email} TIDAK terkirim. Konfigurasikan SMTP.`
      );
      return { skipped: true };
    }
    logger.warn(
      `[mailer] SMTP_HOST kosong — link reset password untuk ${user.email}: ${resetUrl}`
    );
    return { skipped: true };
  }
  try {
    await getTransporter().sendMail({
      from: `"AdPulse" <${config.smtp.from}>`,
      to: user.email,
      subject: "AdPulse — Reset Password",
      html: buildPasswordResetHtml(user, resetUrl),
    });
    logger.info(`[mailer] email reset password terkirim ke ${user.email}`);
    return { sent: true };
  } catch (err) {
    logger.error(
      { err },
      `[mailer] gagal kirim reset password ke ${user.email}: ${err.message}`
    );
    return { sent: false, error: err.message };
  }
}

module.exports = {
  sendInsightEmail,
  buildInsightHtml,
  sendPasswordResetEmail,
  buildPasswordResetHtml,
};
