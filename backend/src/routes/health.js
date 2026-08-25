// GET /api/health — liveness check (works even when the DB is down).
const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ data: { status: "ok" } });
});

module.exports = router;
