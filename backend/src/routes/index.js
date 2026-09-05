// API router — mounts every route group under /api.
// All routes except /health and /auth/register|login require a JWT.
const express = require("express");
const requireAuth = require("../middleware/auth");

const healthRoutes = require("./health");
const authRoutes = require("./auth");
const accountRoutes = require("./accounts");
const campaignRoutes = require("./campaigns");
const metricRoutes = require("./metrics");
const insightRoutes = require("./insights");
const syncRoutes = require("./sync");
const agentRoutes = require("./agent");

const router = express.Router();

router.use("/health", healthRoutes);
router.use("/auth", authRoutes); // /me applies requireAuth internally
router.use("/accounts", requireAuth, accountRoutes);
router.use("/campaigns", requireAuth, campaignRoutes);
router.use("/metrics", requireAuth, metricRoutes);
router.use("/insights", requireAuth, insightRoutes);
router.use("/sync", requireAuth, syncRoutes);
router.use("/agent", requireAuth, agentRoutes);

module.exports = router;
