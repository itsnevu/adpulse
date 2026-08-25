// ==========================================================================
// AdPulse — PM2 ecosystem (produksi, VPS Ubuntu 22.04)
//
// Jalankan dari VPS:
//   pm2 start /home/app/adpulse/deploy/ecosystem.config.js
//   pm2 save && pm2 startup   (agar auto-start setelah reboot)
//
// CATATAN PENTING: cron sync ads dan cron email insight harian berjalan
// DI DALAM proses backend (via node-cron, dikontrol env SYNC_CRON dan
// INSIGHT_EMAIL_CRON). TIDAK perlu app / worker PM2 terpisah untuk cron.
// ==========================================================================

module.exports = {
  apps: [
    {
      name: 'adpulse-backend',
      cwd: '/home/app/adpulse/backend',
      script: 'src/server.js',
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      // Restart otomatis kalau memory bocor / membengkak
      max_memory_restart: '300M',
      // Log PM2 default ada di ~/.pm2/logs/
      time: true,
    },
    {
      name: 'adpulse-frontend',
      cwd: '/home/app/adpulse/frontend',
      script: 'npm',
      args: 'start', // menjalankan `next start` (port 3000) — build dulu: npm run build
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      time: true,
    },
  ],
};
