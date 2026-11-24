// TANKFILES on the PC: serves the game from www/ and opens it in its own app window (no tabs or address bar).
// Plain Node.js, no installs. Run `node server.js --open`.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

const PORT = +process.env.PORT || 8090;
const ROOT = path.join(__dirname, 'www');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/ping') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true,"game":"tankfiles"}'); }
  if (url.pathname === '/api/lan') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); return res.end(JSON.stringify({ urls: lanUrls() })); }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const head = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');   // music needs byte ranges so the browser can rewind and loop it
    if (m && (m[1] || m[2])) {
      let a = m[1] ? +m[1] : Math.max(0, data.length - +m[2]), b = m[1] && m[2] ? Math.min(+m[2], data.length - 1) : data.length - 1;
      if (a >= data.length || a > b) { res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }); return res.end(); }
      res.writeHead(206, Object.assign(head, { 'Content-Range': `bytes ${a}-${b}/${data.length}`, 'Content-Length': b - a + 1 }));
      return res.end(data.subarray(a, b + 1));
    }
    res.writeHead(200, Object.assign(head, { 'Content-Length': data.length }));
    res.end(data);
  });
});

// this PC's addresses on the home Wi-Fi: other phones and computers there open the game at one of these
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || [])
    if ((a.family === 'IPv4' || a.family === 4) && !a.internal && !/^169\.254\./.test(a.address)) out.push(`http://${a.address}:${PORT}`);
  return out.sort((a, b) => (/\/\/192\.168\./.test(b) ? 1 : 0) - (/\/\/192\.168\./.test(a) ? 1 : 0));
}

function openApp() {
  const url = `http://localhost:${PORT}`;
  const profile = path.join(process.env.LOCALAPPDATA || __dirname, 'TankFilesWindow');
  const browsers = [
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ];
  const b = browsers.find(f => f && fs.existsSync(f));
  if (b) exec(`"${b}" --app=${url} --user-data-dir="${profile}" --start-maximized --autoplay-policy=no-user-gesture-required`);
  else exec(`start "" ${url}`);
}

// listening on the whole home network (not just this PC) so phones on the same Wi-Fi can open the game for LOCAL multiplayer
server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log('');
  console.log('  TANKFILES is running. Keep this window open while you play; close it when you are done.');
  const lan = lanUrls();
  if (lan.length) { console.log(''); console.log('  LOCAL MULTIPLAYER: other phones / computers on this Wi-Fi can open the game at:'); for (const u of lan) console.log('    ' + u); }
  if (process.argv.includes('--open')) openApp();
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log('  The game is already running - opening another window.');
    if (process.argv.includes('--open')) openApp();
    setTimeout(() => process.exit(0), 1500);
  } else throw e;
});
