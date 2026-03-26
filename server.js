// Local development server - imports the same Express app used by Vercel
const app = require('./api/index');
const PORT = process.env.PORT || 3000;
const path = require('path');
const express = require('express');

// Serve static files locally (Vercel handles this via vercel.json)
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback for local dev
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`HealthTrack running at http://localhost:${PORT}`);
});
