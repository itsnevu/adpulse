// Route agent AI — satu UI chat yang bisa membaca Meta Ads, Google Ads,
// scraping web, dan tool MCP eksternal (slot WhatsApp).
//
// Semua endpoint butuh JWT (dipasang di routes/index.js) dan di-scope per user:
// percakapan milik orang lain tidak pernah bisa dibaca, dan setiap query
// menyertakan user_id di WHERE — bukan hanya di pengecekan awal.
const express = require("express");
const { z } = require("zod");
const pool = require("../db/pool");
const runner = require("../services/agent/runner");
const firstParty = require("../services/agent/tools");
const mcpFleet = require("../services/agent/mcpFleet");
const { validateBody, validateParams, validateQuery } = require("../middleware/validate");
const { httpError, asyncHandler } = require("../utils/errors");
const { emptyToUndef } = require("../utils/zfields");
const logger = require("../utils/logger");

const router = express.Router();

// Batas panjang pesan. Bukan soal estetika: setiap karakter di sini dikirim ke
// model dan ditagih, lalu dikirim ULANG di setiap giliran berikutnya sebagai
// riwayat. Satu paste 200 ribu karakter membayar dirinya berkali-kali.
const MAX_MESSAGE_CHARS = 8000;

const chatSchema = z.object({
  message: z
    .string({ message: "message wajib diisi" })
    .trim()
    .min(1, { message: "message tidak boleh kosong" })
    .max(MAX_MESSAGE_CHARS, {
      message: `message maksimal ${MAX_MESSAGE_CHARS} karakter`,
    }),
  conversation_id: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
    .optional(),
});

const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/, { message: "id percakapan harus angka" }),
});

const listQuerySchema = z.object({
  limit: emptyToUndef(z.coerce.number().int().min(1).max(100).optional()),
});

// Judul percakapan diambil dari pesan pertama — cukup untuk dikenali di daftar
// tanpa memanggil model lagi hanya demi membuat judul.
function titleFrom(message) {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean || "Percakapan baru";
}

// Ambil percakapan milik user ini, atau 404. Kepemilikan dicek di SQL, bukan
// di JavaScript setelahnya.
async function ownedConversation(userId, conversationId) {
  const { rows } = await pool.query(
    `SELECT id, title, created_at, updated_at
     FROM agent_conversations
     WHERE id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  if (!rows.length) throw httpError(404, "Percakapan tidak ditemukan.");
  return rows[0];
}

// GET /api/agent/health — engine apa yang aktif + keadaan armada MCP.
// ?probe=1 memaksa armada boot supaya jawabannya "benar-benar hidup?" bukan
// sekadar "env-nya terisi?".
router.get(
  "/health",
  asyncHandler(async (req, res) => {
    const probe = req.query.probe === "1" || req.query.probe === "true";
    res.json({ data: await runner.health({ probe }) });
  })
);

// GET /api/agent/tools — daftar tool yang tersedia, untuk ditampilkan di UI.
router.get(
  "/tools",
  asyncHandler(async (req, res) => {
    const tools = firstParty.schemas().map((tool) => ({
      name: tool.name,
      description: tool.description,
      source: "adpulse",
      mutating: firstParty.MUTATING.has(tool.name),
    }));

    // Tool MCP hanya dilaporkan kalau armadanya memang sudah hidup — daftar
    // tool yang menjanjikan sesuatu yang belum tersambung lebih buruk daripada
    // daftar yang pendek.
    const snapshot = mcpFleet.snapshot();
    if (snapshot.state === "up") {
      try {
        const fleet = await mcpFleet.getFleet();
        for (const tool of fleet.tools) {
          tools.push({
            name: tool.name,
            description: tool.description,
            source: "mcp",
            server: fleet.registry.get(tool.name)?.server || null,
            mutating: false,
          });
        }
      } catch {
        // snapshot sudah mencatat kegagalannya; daftar first-party tetap valid.
      }
    }

    res.json({ data: { tools, mcp: snapshot } });
  })
);

// GET /api/agent/conversations — daftar percakapan user, terbaru dulu.
router.get(
  "/conversations",
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    const limit = req.query.limit || 30;
    const { rows } = await pool.query(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              COUNT(m.id)::int AS message_count
       FROM agent_conversations c
       LEFT JOIN agent_messages m ON m.conversation_id = c.id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY c.updated_at DESC
       LIMIT $2`,
      [req.user.id, limit]
    );
    res.json({ data: rows });
  })
);

// GET /api/agent/conversations/:id — isi satu percakapan.
router.get(
  "/conversations/:id",
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const conversation = await ownedConversation(req.user.id, req.params.id);
    const { rows } = await pool.query(
      `SELECT id, role, content, tool_calls, model, degraded, created_at
       FROM agent_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC, id ASC`,
      [conversation.id]
    );
    res.json({ data: { conversation, messages: rows } });
  })
);

// DELETE /api/agent/conversations/:id — hapus percakapan + pesannya (CASCADE).
router.delete(
  "/conversations/:id",
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(
      `DELETE FROM agent_conversations WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) throw httpError(404, "Percakapan tidak ditemukan.");
    res.json({ data: { ok: true } });
  })
);

// POST /api/agent/chat { message, conversation_id? } — satu giliran percakapan.
router.post(
  "/chat",
  validateBody(chatSchema),
  asyncHandler(async (req, res) => {
    const { message } = req.body;
    let conversationId = req.body.conversation_id
      ? String(req.body.conversation_id)
      : null;

    // Percakapan baru dibuat di sini supaya UI langsung dapat id-nya, bahkan
    // kalau giliran ini akhirnya gagal — user tidak kehilangan pertanyaannya.
    if (conversationId) {
      await ownedConversation(req.user.id, conversationId);
    } else {
      const { rows } = await pool.query(
        `INSERT INTO agent_conversations (user_id, title)
         VALUES ($1, $2)
         RETURNING id`,
        [req.user.id, titleFrom(message)]
      );
      conversationId = String(rows[0].id);
    }

    // Riwayat dibaca SEBELUM pesan baru disimpan, supaya pesan yang sedang
    // ditanyakan tidak muncul dua kali di transkrip yang dikirim ke model.
    const { rows: historyRows } = await pool.query(
      `SELECT role, content
       FROM agent_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC, id ASC`,
      [conversationId]
    );

    const { rows: userRows } = await pool.query(
      `INSERT INTO agent_messages (conversation_id, role, content)
       VALUES ($1, 'user', $2)
       RETURNING id, role, content, tool_calls, model, degraded, created_at`,
      [conversationId, message]
    );

    let result;
    try {
      result = await runner.reply({
        userId: req.user.id,
        message,
        history: historyRows,
        // Klien menutup koneksi (tab ditutup, user membatalkan) harus ikut
        // menghentikan giliran — kalau tidak, tool tetap jalan dan tetap ditagih.
        signal: req.signal || undefined,
      });
    } catch (err) {
      logger.error({ err, conversationId }, "[agent] giliran chat gagal");
      throw err;
    }

    const { rows: replyRows } = await pool.query(
      `INSERT INTO agent_messages
         (conversation_id, role, content, tool_calls, model, degraded)
       VALUES ($1, 'assistant', $2, $3, $4, $5)
       RETURNING id, role, content, tool_calls, model, degraded, created_at`,
      [
        conversationId,
        result.text,
        JSON.stringify(result.toolCalls || []),
        result.model || null,
        Boolean(result.degraded),
      ]
    );

    await pool.query(
      `UPDATE agent_conversations SET updated_at = now() WHERE id = $1`,
      [conversationId]
    );

    res.status(201).json({
      data: {
        conversation_id: Number(conversationId),
        user_message: userRows[0],
        message: replyRows[0],
        degraded: Boolean(result.degraded),
        usage: result.usage,
        provider: result.provider,
      },
    });
  })
);

module.exports = router;
