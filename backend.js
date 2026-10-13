/* Glint backend adapter.
   The app talks to a small document API (db / user / room). In production that API is served by
   Supabase: Auth for accounts, one Postgres table (see supabase/schema.sql) for documents,
   Realtime for live updates and presence. */
(function () {
  'use strict';
  const C = window.GLINT_CONFIG || {};
  const configured = !!(C.supabaseUrl && C.supabaseAnonKey && window.supabase && window.supabase.createClient);
  let sb = null, session = null, resolveReady;
  const ready = new Promise(r => (resolveReady = r));
  const onDom = fn => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());

  /* ---------- screens shown before the app (setup / sign in) ---------- */
  const CSS = `#gl-auth{position:fixed;inset:0;z-index:500;display:grid;place-items:center;padding:24px 16px;background:radial-gradient(90% 60% at 50% 0%,rgba(139,92,255,.22),transparent 60%),var(--bg,#08090c);color:var(--fg,#f1f2f5);font-family:var(--font-body,system-ui,sans-serif)}
#gl-auth .card{width:100%;max-width:400px;display:flex;flex-direction:column;gap:14px;align-items:center;text-align:center;padding:28px 22px;border-radius:28px;background:rgba(255,255,255,.06);backdrop-filter:blur(20px) saturate(1.8);-webkit-backdrop-filter:blur(20px) saturate(1.8);box-shadow:inset 0 1px 0 rgba(255,255,255,.2),inset 0 0 0 1px rgba(255,255,255,.08),0 30px 80px -20px rgba(0,0,0,.6)}
#gl-auth img{width:84px;height:84px;border-radius:22px}
#gl-auth h1{font-family:var(--font-display,system-ui);font-size:26px;margin:4px 0 0;letter-spacing:-.03em}
#gl-auth p{margin:0;color:var(--muted,#949aa8);font-size:15px;line-height:1.45}
#gl-auth form{display:flex;flex-direction:column;gap:10px;width:100%}
#gl-auth input{width:100%;font-size:16px;padding:14px 16px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.25);color:inherit;text-align:center}
#gl-auth button{font:inherit;font-weight:700;font-size:15px;padding:14px;border-radius:999px;border:0;cursor:pointer;background:var(--accent,#8f7aff);color:var(--accent-fg,#0b0a12)}
#gl-auth button.link{background:none;color:var(--muted,#949aa8);font-weight:600;padding:6px}
#gl-auth .err{color:#ff4d6d;font-size:14px;min-height:1em}
#gl-auth .fine{font-size:12px}`;
  function screen(html) {
    let d = document.getElementById('gl-auth');
    if (!d) {
      const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
      d = document.createElement('div'); d.id = 'gl-auth'; document.body.appendChild(d);
    }
    d.innerHTML = '<div class="card">' + html + '</div>';
    return d;
  }
  function closeScreen() { const d = document.getElementById('gl-auth'); if (d) d.remove(); }

  function setupScreen() {
    screen(`<img src="icons/icon-192.png" alt=""><h1>Glint is almost here</h1><p>We're putting the finishing touches on it. Check back soon.</p>`);
  }
  function signInScreen() {
    const d = screen(`<img src="icons/icon-192.png" alt=""><h1>Welcome to Glint</h1>
      <p>Enter your email. We'll send you a sign-in link, no password needed.</p>
      <form id="gl-email"><input id="gl-email-in" type="email" inputmode="email" autocomplete="email" enterkeyhint="send" placeholder="you@example.com" required>
      <button type="submit">Send sign-in link</button><div class="err" role="alert"></div></form>
      <p class="fine">Glint is for adults 18 and over.</p>`);
    const f = d.querySelector('#gl-email');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const email = d.querySelector('#gl-email-in').value.trim(); const errEl = f.querySelector('.err'); errEl.textContent = '';
      const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Sending…';
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
      btn.disabled = false; btn.textContent = 'Send sign-in link';
      if (error) { errEl.textContent = /rate/i.test(error.message) ? 'Too many tries. Wait a minute and try again.' : "That didn't send. Check the address and try again."; return; }
      codeScreen(email);
    });
  }
  function codeScreen(email) {
    const d = screen(`<img src="icons/icon-192.png" alt=""><h1>Check your email</h1>
      <p>We sent a sign-in link to <b class="em"></b>. Open it on this device. If the email has a 6-digit code, you can enter it here instead.</p>
      <form id="gl-code"><input id="gl-code-in" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" enterkeyhint="done">
      <button type="submit">Sign in</button><div class="err" role="alert"></div></form>
      <button class="link" type="button" id="gl-back">Use a different email</button>`);
    d.querySelector('.em').textContent = email;
    d.querySelector('#gl-back').onclick = signInScreen;
    const f = d.querySelector('#gl-code');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const token = d.querySelector('#gl-code-in').value.replace(/\D/g, ''); const errEl = f.querySelector('.err');
      if (token.length !== 6) { errEl.textContent = 'Enter the 6-digit code from the email.'; return; }
      const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
      if (error) errEl.textContent = 'That code is wrong or expired. Request a new link.';
    });
  }

  /* ---------- errors in the shape the app expects ---------- */
  function norm(e) {
    const m = (e && (e.message || '')) + '';
    if (e && (e.code === '42501' || /row-level security|permission/i.test(m))) return { code: 'invalid_argument', message: m };
    if (e && (e.code === '23514' || /docs_size/.test(m))) return { code: 'invalid_argument', message: 'too large' };
    if (/fetch|network|Failed/i.test(m)) return { code: 'unavailable', message: m };
    return { code: 'unavailable', message: m };
  }
  const parentOf = p => p.split('/').slice(0, -1).join('/');
  const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const snapDoc = (path, data) => ({ id: path.split('/').pop(), exists: data != null, data: () => (data == null ? undefined : clone(data)), metadata: { fromCache: false, hasPendingWrites: false } });

  /* ---------- live document store ---------- */
  const cols = new Map();  // parent -> { docs: Map, cbs: Set, loaded, pending }
  const docs = new Map();  // path -> { data, cbs: Set, loaded }
  function emitCol(parent) {
    const s = cols.get(parent); if (!s || !s.loaded || s.pending) return; s.pending = true;
    queueMicrotask(() => {
      s.pending = false;
      const list = [...s.docs.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, d]) => snapDoc(p, d));
      const snap = { docs: list, size: list.length, empty: !list.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
      s.cbs.forEach(cb => { try { cb(snap); } catch (e) { console.error(e); } });
    });
  }
  function emitDoc(path) { const s = docs.get(path); if (!s || !s.loaded) return; const snap = snapDoc(path, s.data); s.cbs.forEach(cb => { try { cb(snap); } catch (e) { console.error(e); } }); }
  function localSet(path, data) {
    const par = parentOf(path); const c = cols.get(par);
    if (c) { if (data == null) c.docs.delete(path); else c.docs.set(path, data); emitCol(par); }
    const d = docs.get(path); if (d) { d.data = data; emitDoc(path); }
  }
  let liveStarted = false;
  function startLive() {
    if (liveStarted) return; liveStarted = true;
    // deletes can't be filtered server-side, but they only carry the path, so one shared listener is cheap
    sb.channel('glint-deletes')
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'docs' }, pl => { const p = pl.old && pl.old.path; if (p && (cols.has(parentOf(p)) || docs.has(p))) localSet(p, null); })
      .subscribe();
    // catch up after the tab sleeps or the connection drops
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });
    addEventListener('online', refreshAll);
  }
  // inserts/updates are filtered to what this page watches, so big media rows never stream to everyone
  function watch(filter, key) {
    sb.channel('w:' + key)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'docs', filter }, pl => localSet(pl.new.path, pl.new.data))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'docs', filter }, pl => localSet(pl.new.path, pl.new.data))
      .subscribe(st => { if (st === 'SUBSCRIBED') refreshAll(); });
  }
  async function fetchCol(parent) {
    let out = [], from = 0;
    for (;;) {
      const { data, error } = await sb.from('docs').select('path,data').eq('parent', parent).range(from, from + 999);
      if (error) throw norm(error);
      out = out.concat(data); if (data.length < 1000) break; from += 1000;
    }
    return out;
  }
  let rTimer = null;
  function refreshAll() { clearTimeout(rTimer); rTimer = setTimeout(doRefresh, 400); }
  async function doRefresh() {
    for (const [parent, s] of cols) { try { const rows = await fetchCol(parent); s.docs = new Map(rows.map(r => [r.path, r.data])); s.loaded = true; emitCol(parent); } catch (e) {} }
    for (const [path, s] of docs) { try { const { data } = await sb.from('docs').select('data').eq('path', path).maybeSingle(); s.data = data ? data.data : null; s.loaded = true; emitDoc(path); } catch (e) {} }
  }

  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      async get() { const { data, error } = await sb.from('docs').select('data').eq('path', path).maybeSingle(); if (error) throw norm(error); return snapDoc(path, data ? data.data : null); },
      async set(body) {
        const { error } = await sb.from('docs').upsert({ path, parent: parentOf(path), data: body, updated_at: new Date().toISOString() });
        if (error) throw norm(error); localSet(path, clone(body));
      },
      async update(body) { const cur = await this.get(); if (!cur.exists) throw { code: 'invalid_argument', message: 'missing' }; await this.set(Object.assign(cur.data(), body)); },
      async delete() { const { error } = await sb.from('docs').delete().eq('path', path); if (error) throw norm(error); localSet(path, null); },
      onSnapshot(cb, err) {
        startLive();
        let s = docs.get(path);
        if (!s) {
          s = { data: null, cbs: new Set(), loaded: false }; docs.set(path, s); watch('path=eq.' + path, 'd:' + path);
          sb.from('docs').select('data').eq('path', path).maybeSingle().then(({ data, error }) => { if (error) { err && err(norm(error)); return; } s.data = data ? data.data : null; s.loaded = true; emitDoc(path); });
        }
        s.cbs.add(cb); if (s.loaded) queueMicrotask(() => cb(snapDoc(path, s.data)));
        return () => s.cbs.delete(cb);
      },
      collection(p) { return colRef(path + '/' + p); }
    };
  }
  function colRef(path) {
    return {
      path,
      doc(id) { return docRef(path + '/' + (id || crypto.randomUUID().replace(/-/g, ''))); },
      async get() { const rows = await fetchCol(path); const list = rows.map(r => snapDoc(r.path, r.data)); return { docs: list, size: list.length, empty: !list.length, docChanges: () => [], metadata: {} }; },
      onSnapshot(cb, err) {
        startLive();
        let s = cols.get(path);
        if (!s) {
          s = { docs: new Map(), cbs: new Set(), loaded: false, pending: false }; cols.set(path, s); watch('parent=eq.' + path, 'c:' + path);
          fetchCol(path).then(rows => { rows.forEach(r => s.docs.set(r.path, r.data)); s.loaded = true; emitCol(path); }).catch(e => err && err(e));
        }
        s.cbs.add(cb); if (s.loaded) emitCol(path);
        return () => s.cbs.delete(cb);
      }
    };
  }
  const db = { doc: docRef, collection: colRef };

  /* ---------- people ---------- */
  const user = {
    id: async () => (session ? session.user.id : null),
    can: async () => true, isOwner: async () => false, canEdit: async () => false,
    me: async () => ({ id: session ? session.user.id : null, name: '', avatarUrl: '', color: '#8b5cff', email: null, isOwner: false, canEdit: false }),
    profiles: async ids => { const o = {}; for (const i of [].concat(ids)) o[i] = { id: i, name: '', avatarUrl: '', color: '#8b5cff', email: null, isMe: !!session && i === session.user.id, guest: false }; return o; },
    search: async () => []
  };

  /* ---------- presence (online + typing) ---------- */
  let roomCh = null; const mine = {}; let peersCb = null;
  function room() {
    const me = session.user.id;
    roomCh = sb.channel('glint-room', { config: { presence: { key: me } } });
    roomCh.on('presence', { event: 'sync' }, () => {
      const st = roomCh.presenceState();
      const peers = Object.entries(st).map(([key, metas]) => ({ peer: key, by: key, isMe: key === me, sameTab: key === me, kind: 'viewer', guest: false, presence: Object.freeze(Object.assign({}, metas[metas.length - 1] || {})), updatedAt: Date.now() }));
      peersCb && peersCb({ peers, joined: [], left: [], updated: [] });
    }).subscribe(status => { if (status === 'SUBSCRIBED') roomCh.track(Object.assign({}, mine)); });
    let t = null;
    return {
      presence: async patch => { for (const [k, v] of Object.entries(patch)) { if (v === null) delete mine[k]; else mine[k] = v; } clearTimeout(t); t = setTimeout(() => roomCh.track(Object.assign({}, mine)), 120); },
      onPeers: cb => { peersCb = cb; return () => { peersCb = null; }; },
      connected: () => true
    };
  }

  /* ---------- boot ---------- */
  let ns = null;
  window.claude = { use: async name => { await ready; return ns ? ns[name] || null : null; } };
  window.glintSignOut = async () => { if (sb) await sb.auth.signOut(); try { localStorage.removeItem('glint-age'); } catch (e) {} location.replace(location.pathname); };

  onDom(async () => {
    if (!configured) { setupScreen(); return; }
    sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } });
    const { data } = await sb.auth.getSession(); session = data.session;
    const go = () => { closeScreen(); ns = { db, user, room: room() }; resolveReady(); if (location.hash && /access_token|error_description/.test(location.hash)) history.replaceState(null, '', location.pathname); };
    if (session) { go(); return; }
    signInScreen();
    sb.auth.onAuthStateChange((ev, s) => { if (s && !session) { session = s; go(); } });
  });
})();
