'use strict';
// LOCAL multiplayer: up to 10 devices on the same Wi-Fi, talking straight to each other (WebRTC through PeerJS) - the
// same way FNAF Siege does it. Devices on one network share a public IP, so a hosted lobby is named after a hash of that
// IP plus a slot number (6 lobbies per network at once); a device looking for games knocks on those few names.
// The HOST is the middle of a star: every guest talks to the host only, and the host passes chat and the game along.
const Net = (() => {
  const PREFIX = 'tankfiles-v1-', SLOTS = 6, MAX_PLAYERS = 10;
  let peer = null, group = null, myName = '';
  let hosting = false, watchdog = null, rehosting = false, infoFn = () => ({});
  const guests = new Map();          // host: guest id -> { conn, name }
  let hostConn = null;               // guest: our line to the host

  const fnv = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  async function netGroup() {
    if (group) return group;
    const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
    const { ip } = await r.json();
    return (group = fnv('tankfiles:' + ip));
  }
  const slotId = (g, i) => `${PREFIX}${g}-${i}`;
  // routes between the devices: STUN servers to find each one's address, and PeerJS's relay for networks that won't let them talk directly
  const RTC = { iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ], sdpSemantics: 'unified-plan' };
  function openPeer(id) {
    return new Promise((ok, bad) => {
      const p = id ? new Peer(id, { debug: 0, config: RTC }) : new Peer({ debug: 0, config: RTC });
      // this error handler is ONLY for starting up (a lesson from FNAF Siege: left attached, the harmless "nobody here"
      // from an empty slot during a search destroyed the whole peer)
      const t = setTimeout(() => { p.off('error', startErr); p.destroy(); bad(new Error('timeout')); }, 10000);
      const startErr = e => { clearTimeout(t); p.off('error', startErr); p.destroy(); bad(e); };
      p.on('open', () => { clearTimeout(t); p.off('error', startErr); ok(p); });
      p.on('error', startErr);
    });
  }
  // a brand-new throwaway peer for every search and every join (reusing one to knock on the same host again silently fails)
  async function freshPeer() { const p = await openPeer(null); p.on('error', () => {}); return p; }

  // ---------- hosting ----------
  function dropGuest(id, why) {
    const g = guests.get(id); if (!g) return;
    guests.delete(id);
    try { g.conn.close(); } catch (e) {}
    N.emit(id, { t: 'left', why: why || 'left' });
  }
  async function claimSlot() {
    const g = await netGroup();
    let p = null;
    for (let i = 0; i < SLOTS && !p; i++) {
      try { p = await openPeer(slotId(g, i)); }
      catch (e) { if (e.type !== 'unavailable-id') throw e; }
    }
    if (!p) throw new Error('There are already 6 games on this Wi-Fi.');
    peer = p;
    p.on('error', () => {});
    p.on('disconnected', () => {                     // dropped off the matchmaking server (screen dimmed, Wi-Fi blip): get straight back on
      if (hosting && p === peer && !p.destroyed) setTimeout(() => { try { if (p.disconnected && !p.destroyed) p.reconnect(); } catch (e) {} }, 500);
    });
    p.on('connection', c => {
      c.on('open', () => {
        const meta = c.metadata || {};
        if (meta.probe) {                             // someone searching: tell them who's hosting and how many are in
          const i = infoFn() || {};
          c.send({ t: 'hello', name: myName, count: guests.size + 1, max: MAX_PLAYERS, playing: !!i.playing, map: i.map || '' });
          setTimeout(() => c.close(), 1500); return;
        }
        if (guests.size + 1 >= MAX_PLAYERS) { c.send({ t: 'full' }); setTimeout(() => c.close(), 500); return; }
        // two-way handshake: a guest only counts once it answers our welcome
        const id = c.peer;
        c.send({ t: 'welcome', id, name: myName });
        const t = setTimeout(() => { if (!guests.has(id)) try { c.close(); } catch (e) {} }, 12000);
        c.on('data', m => {
          if (!m) return;
          if (!guests.has(id)) {
            if (m.t !== 'hi' || !hosting) return;
            clearTimeout(t);
            guests.set(id, { conn: c, name: String(meta.name || 'PLAYER').slice(0, 14) });
            N.emit(id, { t: 'joined', name: String(meta.name || 'PLAYER').slice(0, 14), spec: meta.spec || null });
            return;
          }
          if (m.t === 'bye') { dropGuest(id, 'left'); return; }
          N.emit(id, m);
        });
        c.on('close', () => { if (guests.has(id) && guests.get(id).conn === c) dropGuest(id, 'lost'); });
      });
    });
  }
  async function rehost() {
    if (rehosting || !hosting) return;
    rehosting = true;
    try { try { peer && peer.destroy(); } catch (e) {} peer = null; await claimSlot(); } catch (e) {}
    rehosting = false;
  }

  // ---------- joining ----------
  function tryJoin(id, name, spec) {
    return (async () => {
      const p = await freshPeer();
      return new Promise((ok, bad) => {
        const c = p.connect(id, { metadata: { name, spec }, reliable: true });
        let done = false;
        const fail = (msg, final) => { if (done) return; done = true; clearTimeout(t); p.off('error', gone); try { c.close(); } catch (e) {} setTimeout(() => p.destroy(), 500); const e = new Error(msg); e.final = final; bad(e); };
        const t = setTimeout(() => fail('That game did not answer.'), 10000);
        const gone = e => { if (e && e.type === 'peer-unavailable' && String(e.message).includes(id)) fail('That game is gone - ask them to host again.', true); };
        p.on('error', gone);
        c.on('data', function first(m) {
          if (!m) return;
          if (m.t === 'full') { fail('That lobby is full (10 players).', true); return; }
          if (m.t !== 'welcome' || done) return;
          done = true; clearTimeout(t); p.off('error', gone); c.off('data', first);
          c.send({ t: 'hi' });
          hostConn = c; peer = p;
          c.on('data', d => { if (d) N.emit('host', d); });
          c.on('close', () => { if (hostConn === c) { hostConn = null; N.emit('host', { t: 'gone' }); } });
          ok({ id: m.id, host: m.name });
        });
        c.on('error', () => fail('Could not connect to that game.'));
      });
    })();
  }

  const N = {
    onMessage: null,                                    // (fromId, msg): fromId is a guest's id on the host, 'host' on a guest
    emit(from, m) { if (N.onMessage) N.onMessage(from, m); },
    available: () => typeof Peer !== 'undefined' && navigator.onLine !== false,
    get hosting() { return hosting; },
    get connected() { return hosting || !!(hostConn && hostConn.open); },
    get guestIds() { return [...guests.keys()]; },
    MAX_PLAYERS,
    // a short code for this internet connection: two devices only see each other's games when their codes match
    async networkCode() { try { return (await netGroup()).slice(0, 4).toUpperCase(); } catch (e) { return '----'; } },

    // info() tells searchers about the lobby: { playing, map }
    async host(name, info) {
      myName = name; infoFn = info || (() => ({}));
      hosting = true;
      try { await claimSlot(); } catch (e) { hosting = false; throw e; }
      clearInterval(watchdog);
      watchdog = setInterval(() => {                    // keep the lobby findable
        if (!hosting) return;
        if (!peer || peer.destroyed) rehost();
        else if (peer.disconnected) { try { peer.reconnect(); } catch (e) { rehost(); } }
      }, 2500);
    },
    // lobbies on this Wi-Fi: [{ id, name, count, max, playing, map }]
    async list() {
      const g = await netGroup(), p = await freshPeer();
      const empty = {};
      p.on('error', e => { if (e && e.type === 'peer-unavailable') for (const id in empty) if (String(e.message).includes(id)) empty[id](); });
      const found = await Promise.all(Array.from({ length: SLOTS }, (_, i) => new Promise(done => {
        const id = slotId(g, i);
        if (hosting && peer && peer.id === id) return done(null);
        const c = p.connect(id, { metadata: { probe: true }, reliable: true });
        const t = setTimeout(() => { try { c.close(); } catch (e) {} done(null); }, 6000);
        empty[id] = () => { clearTimeout(t); try { c.close(); } catch (e) {} done(null); };
        c.on('data', m => { if (m && m.t === 'hello') { clearTimeout(t); try { c.close(); } catch (e) {} done({ id, name: m.name, count: m.count, max: m.max, playing: m.playing, map: m.map }); } });
        c.on('error', () => { clearTimeout(t); done(null); });
      })));
      setTimeout(() => p.destroy(), 1000);
      return found.filter(Boolean);
    },
    async join(id, name, spec, onTry) {
      let last = null;
      for (let n = 1; n <= 3; n++) {
        if (onTry) onTry(n);
        try { return await tryJoin(id, name, spec); }
        catch (e) { last = e; if (e.final) break; }
      }
      throw last || new Error('Could not join');
    },
    // host: to one guest / to every guest (except one); guest: to the host
    send(id, m) { const g = guests.get(id); if (g && g.conn.open) try { g.conn.send(m); } catch (e) {} },
    broadcast(m, except) { for (const [id, g] of guests) if (id !== except && g.conn.open) try { g.conn.send(m); } catch (e) {} },
    toHost(m) { if (hostConn && hostConn.open) try { hostConn.send(m); } catch (e) {} },
    kick(id) {
      const g = guests.get(id); if (!g) return;
      try { g.conn.send({ t: 'kick' }); } catch (e) {}
      guests.delete(id);
      setTimeout(() => { try { g.conn.close(); } catch (e) {} }, 400);
    },
    close() {
      const wasHost = hosting;
      hosting = false; clearInterval(watchdog);
      if (wasHost) for (const g of guests.values()) try { g.conn.send({ t: 'closed' }); } catch (e) {}
      if (hostConn && hostConn.open) try { hostConn.send({ t: 'bye' }); } catch (e) {}
      const conns = [...guests.values()].map(g => g.conn).concat(hostConn ? [hostConn] : []), p = peer;
      guests.clear(); hostConn = null; peer = null;
      setTimeout(() => { for (const c of conns) try { c.close(); } catch (e) {} try { p && p.destroy(); } catch (e) {} }, 300);
    },
    _drop() { if (peer) peer.disconnect(); },
    get _peer() { return peer; },
  };
  return N;
})();
