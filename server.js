require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('./apps/police-suna/src/config/db');
const police = require('./apps/police-suna');
const dojo = require('./apps/dojo-fuinjutsu');
const senso = require('./apps/dojo-sensoriel');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// Santé + cible du ping keep-alive (GitHub Actions) — avant tout le reste, sans session
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---------- Réglages admin (en mémoire, persistés en base) ----------
const SITES = ['police-suna', 'dojo-fuinjutsu', 'dojo-sensoriel']; // sites hébergés ici, verrouillables séparément
const reglages = { locks: {}, annonce: { actif: false, texte: '' } };
async function chargerReglages() {
  await pool.query('CREATE TABLE IF NOT EXISTS hub_settings (cle TEXT PRIMARY KEY, valeur JSONB NOT NULL)');
  const { rows } = await pool.query('SELECT cle, valeur FROM hub_settings');
  for (const r of rows) {
    if (r.cle === 'annonce') reglages.annonce = { ...reglages.annonce, ...r.valeur };
    else if (r.cle.startsWith('lock:')) reglages.locks[r.cle.slice(5)] = r.valeur;
    else if (r.cle === 'maintenance' && !reglages.locks['police-suna']) reglages.locks['police-suna'] = r.valeur; // ancien réglage
  }
}
async function sauver(cle, valeur) {
  await pool.query(
    'INSERT INTO hub_settings (cle, valeur) VALUES ($1,$2) ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur',
    [cle, JSON.stringify(valeur)]
  );
  if (cle.startsWith('lock:')) reglages.locks[cle.slice(5)] = valeur; else reglages[cle] = valeur;
}

// ---------- Session admin : cookie signé (HMAC), sans base ----------
// Changer HUB_SESSION_SECRET déconnecte immédiatement l'admin de tous les appareils.
const SECRET = process.env.HUB_SESSION_SECRET || process.env.SESSION_SECRET || 'dev-secret-a-changer';
const DUREE = 7 * 24 * 60 * 60 * 1000;
const sign = (exp) => crypto.createHmac('sha256', SECRET).update('hub.' + exp).digest('hex');
function isHub(req) {
  const m = /(?:^|;\s*)hub\.sid=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
const requireHub = (req, res, next) => (isHub(req) ? next() : res.status(401).json({ error: 'Non connecté.' }));

// ---------- Verrous : chaque site peut être fermé séparément (l'admin connecté garde l'accès) ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MSG_DEFAUT = 'Le site est temporairement fermé. Revenez plus tard.';
function pageMaintenance(msg) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Maintenance</title><script defer src="/assets/annonce.js"></script>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 0,#3a2f1f,#17150F 70%);color:#F6EFDC;font-family:system-ui,sans-serif;text-align:center;padding:20px}
h1{font-family:Oswald,'Arial Narrow',sans-serif;color:#CBA84C;letter-spacing:.05em}p{max-width:480px;line-height:1.6;white-space:pre-wrap}</style></head>
<body><div><h1>Accès fermé</h1><p>${esc(msg || MSG_DEFAUT)}</p></div></body></html>`;
}
const verrou = (site) => (req, res, next) => {
  const l = reglages.locks[site];
  if (!l || !l.actif || isHub(req)) return next();
  const msg = l.message || MSG_DEFAUT;
  if (req.path.startsWith('/api/')) return res.status(503).json({ error: msg, maintenance: true });
  res.status(503).set('Retry-After', '300').type('html').send(pageMaintenance(msg));
};
app.use('/police-suna', verrou('police-suna'));

// police-suna complet, avec ses propres comptes (inchangés)
app.get(/^\/police-suna$/, (req, res) => res.redirect('/police-suna/')); // le slash final garde les liens relatifs valides
app.use('/police-suna', police.app);

// Dojo de fuinjutsu : l'admin du hub y agit comme Maître
app.get(/^\/dojo-fuinjutsu$/, (req, res) => res.redirect('/dojo-fuinjutsu/'));
app.use('/dojo-fuinjutsu', verrou('dojo-fuinjutsu'), (req, res, next) => { req.hubAdmin = isHub(req); next(); }, dojo.app);

// Dojo des ninja sensoriels (détection de chakra)
app.get(/^\/dojo-sensoriel$/, (req, res) => res.redirect('/dojo-sensoriel/'));
app.use('/dojo-sensoriel', verrou('dojo-sensoriel'), (req, res, next) => { req.hubAdmin = isHub(req); next(); }, senso.app);

// ---------- Assistant IA de l'admin (proxy en streaming vers l'API Anthropic ; la clé reste sur le serveur) ----------
const IA_MODELE_DEFAUT = 'claude-opus-5-5';
const IA_SYSTEME = `Tu es l'assistant IA personnel de Lexoui, l'administrateur d'un ensemble de sites de roleplay Naruto hébergés dans un même dépôt : un portfolio public, le site de la police de Sunagakure (police-suna), le dojo de fuinjutsu et le dojo des ninja sensoriels (détection de chakra).
Réponds en français, de façon directe, complète et approfondie, sans te limiter artificiellement en longueur. Tu aides sur tout ce que demande l'administrateur : gestion et modération des sites, lore et écriture RP (personnages, règlements, annonces, scénarios), code (Node.js/Express, PostgreSQL, HTML/CSS/JS), idées de fonctionnalités, analyse, rédaction, réflexion générale.
Tu ne peux pas agir toi-même sur les sites : quand une action est utile (fermer un site, publier une annonce, valider un compte), explique précisément ce que l'administrateur doit faire dans le panneau d'administration.`;
async function contexteAdmin() {
  const q = async (sql) => { try { return (await pool.query(sql)).rows; } catch (e) { return []; } };
  const cnt = (rows) => rows.map((r) => `${r.statut}: ${r.n}`).join(', ') || 'aucun';
  const [pol, doj, sen] = await Promise.all([
    q('SELECT statut, COUNT(*)::int AS n FROM users GROUP BY statut'),
    q('SELECT statut, COUNT(*)::int AS n FROM dojo_membres GROUP BY statut'),
    q('SELECT statut, COUNT(*)::int AS n FROM senso_membres GROUP BY statut'),
  ]);
  const sites = SITES.map((id) => `${id}: ${reglages.locks[id] && reglages.locks[id].actif ? 'FERMÉ' : 'ouvert'}`).join(' ; ');
  return `État actuel (lecture seule)\nSites — ${sites}\nBandeau d'annonce — ${reglages.annonce.actif ? 'actif : « ' + reglages.annonce.texte + ' »' : 'inactif'}\nComptes police-suna — ${cnt(pol)}\nComptes dojo de fuinjutsu — ${cnt(doj)}\nComptes dojo des sensoriels — ${cnt(sen)}`;
}
// Fournisseur d'IA : Claude si une clé Anthropic existe ; sinon un service compatible OpenAI (Groq, OpenRouter, Gemini…) ;
// sinon le service gratuit sans clé (Pollinations), moins puissant et limité en débit.
function fournisseurIA() {
  if (process.env.ANTHROPIC_API_KEY) return { type: 'anthropic', modele: process.env.ADMIN_AI_MODEL || IA_MODELE_DEFAUT };
  if (process.env.AI_API_KEY && process.env.AI_BASE_URL) return { type: 'compatible', modele: process.env.AI_MODEL || '', base: process.env.AI_BASE_URL, key: process.env.AI_API_KEY };
  return { type: 'gratuit', modele: process.env.AI_MODEL || 'openai', base: process.env.AI_FREE_BASE_URL || 'https://gen.pollinations.ai/v1' };
}
app.post('/hub/admin/ia', requireHub, express.json({ limit: '2mb' }), async (req, res) => {
  const f = fournisseurIA();
  if (f.type === 'compatible' && !f.modele) return res.status(503).json({ error: 'Modèle non configuré : ajoute la variable AI_MODEL sur Render.' });
  let msgs = Array.isArray(req.body && req.body.messages) ? req.body.messages : null;
  if (!msgs || !msgs.length || msgs.length > 400) return res.status(400).json({ error: 'Conversation invalide.' });
  msgs = msgs.filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 200000) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.status(400).json({ error: 'Le dernier message doit venir de toi.' });
  const systeme = IA_SYSTEME + '\n\n' + (await contexteAdmin());
  const max = Number(process.env.ADMIN_AI_MAX_TOKENS) || 16000;
  let url, headers, body;
  if (f.type === 'anthropic') {
    url = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages';
    headers = { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    body = { model: f.modele, max_tokens: max, stream: true, system: systeme, messages: msgs };
  } else {
    url = f.base.replace(/\/$/, '') + '/chat/completions';
    headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
    if (f.key) headers.authorization = 'Bearer ' + f.key;
    body = { model: f.modele, stream: true, messages: [{ role: 'system', content: systeme }, ...msgs] };
    if (f.type === 'compatible') body.max_tokens = max;
  }
  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());
  try {
    const r = await fetch(url, { method: 'POST', signal: ctrl.signal, headers, body: JSON.stringify(body) });
    if (!r.ok) {
      let msg = 'Erreur ' + r.status;
      try { const d = await r.json(); msg += ' : ' + ((d.error && (d.error.message || d.error)) || d.message || ''); } catch (e) { /* corps non JSON */ }
      send({ erreur: msg }); return res.end();
    }
    if (f.type !== 'anthropic' && !(r.headers.get('content-type') || '').includes('text/event-stream')) { // réponse non streamée
      const d = await r.json().catch(() => null);
      const t = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      send(t ? { texte: t } : { erreur: 'Réponse vide du service IA.' }); return res.end();
    }
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const bloc = buf.slice(0, i); buf = buf.slice(i + 2);
        const l = bloc.split('\n').find((x) => x.startsWith('data:'));
        if (!l) continue;
        const brut = l.slice(5).trim();
        if (!brut || brut === '[DONE]') continue;
        let d; try { d = JSON.parse(brut); } catch (e) { continue; }
        if (f.type === 'anthropic') {
          if (d.type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') send({ texte: d.delta.text });
          else if (d.type === 'message_delta' && d.delta && d.delta.stop_reason === 'max_tokens') send({ erreur: 'Réponse coupée : limite de longueur atteinte. Écris « continue » pour la suite.' });
          else if (d.type === 'error') send({ erreur: (d.error && d.error.message) || 'Erreur du service IA.' });
        } else {
          const c = d.choices && d.choices[0], t = c && c.delta && c.delta.content;
          if (t) send({ texte: t });
          if (c && c.finish_reason === 'length') send({ erreur: 'Réponse coupée : limite de longueur atteinte. Écris « continue » pour la suite.' });
          if (d.error) send({ erreur: d.error.message || 'Erreur du service IA.' });
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') send({ erreur: 'Impossible de joindre le service IA : ' + e.message });
  }
  res.end();
});

// ---------- Hub ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '16kb' }));

// Mot de passe admin : hash bcrypt (jamais en clair dans le code).
// HUB_PASSWORD_HASH (variable d'environnement) prend le dessus si définie : à utiliser pour changer le mot de passe.
const DEFAULT_HUB_HASH = '$2a$12$MBOSPUcfRXxwGx5L3ZiacOg9FJkiiKAh0UDPafHiJYRA2WULDzhkq';
const checkPassword = (pwd) => bcrypt.compare(pwd, process.env.HUB_PASSWORD_HASH || DEFAULT_HUB_HASH);

// Anti force brute : 5 échecs / 15 min par IP
const essais = new Map();
const limite = (ip) => { const e = essais.get(ip); return !!e && e.fin > Date.now() && e.n >= 5; };
function echec(ip) {
  const e = essais.get(ip);
  if (!e || e.fin < Date.now()) essais.set(ip, { n: 1, fin: Date.now() + 15 * 60 * 1000 });
  else e.n += 1;
}

app.post('/hub/login', async (req, res) => {
  if (limite(req.ip)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
  const ok = await checkPassword(String((req.body && req.body.password) || ''));
  if (!ok) { echec(req.ip); return res.status(401).json({ error: 'Mot de passe incorrect.' }); }
  const exp = Date.now() + DUREE;
  res.cookie('hub.sid', `${exp}.${sign(exp)}`, { ...cookieOpts, maxAge: DUREE });
  res.json({ ok: true });
});
app.post('/hub/logout', (req, res) => { res.clearCookie('hub.sid', cookieOpts); res.json({ ok: true }); });

// Public : projets visibles (public !== false) et bandeau d'annonce
const lireProjets = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'hub', 'projets.json'), 'utf8'));
app.get('/hub/projets', (req, res) => res.json(lireProjets().filter((p) => p.public !== false).map((p) => ({ ...p, ferme: !!(reglages.locks[p.id] && reglages.locks[p.id].actif) }))));
app.get('/hub/annonce', (req, res) => {
  const a = reglages.annonce;
  res.json(a.actif && a.texte ? { texte: a.texte } : {});
});

// Admin
app.get('/hub/admin/projets', requireHub, (req, res) => res.json(lireProjets()));
app.get('/hub/admin/etat', requireHub, async (req, res) => {
  const stats = { comptes: {}, sessions: [] };
  try {
    const c = await pool.query('SELECT statut, COUNT(*)::int AS n FROM users GROUP BY statut');
    for (const r of c.rows) stats.comptes[r.statut] = r.n;
    // Dernière activité = fin de validité de la session - 7 jours (durée de session de police-suna)
    const s = await pool.query(`SELECT sess->'user'->>'username' AS username, MAX(expire) - interval '7 days' AS derniere_activite
      FROM session WHERE expire > now() AND sess->'user' IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
    stats.sessions = s.rows;
  } catch (err) { stats.erreur = 'Stats indisponibles.'; }
  const noms = Object.fromEntries(lireProjets().map((p) => [p.id, p.nom]));
  const sites = SITES.map((id) => ({ id, nom: noms[id] || id, actif: !!(reglages.locks[id] && reglages.locks[id].actif), message: (reglages.locks[id] && reglages.locks[id].message) || '' }));
  res.json({ sites, annonce: reglages.annonce, stats, ia: { fournisseur: fournisseurIA().type, modele: fournisseurIA().modele } });
});
const texte = (v, max) => String(v ?? '').trim().slice(0, max);
app.post('/hub/admin/lock/:site', requireHub, async (req, res) => {
  if (!SITES.includes(req.params.site)) return res.status(404).json({ error: 'Site inconnu.' });
  await sauver('lock:' + req.params.site, { actif: !!req.body.actif, message: texte(req.body.message, 500) });
  res.json(reglages.locks[req.params.site]);
});
app.post('/hub/admin/annonce', requireHub, async (req, res) => {
  await sauver('annonce', { actif: !!req.body.actif, texte: texte(req.body.texte, 300) });
  res.json(reglages.annonce);
});
app.post('/hub/admin/deconnecter-tous', requireHub, async (req, res) => {
  const r = await pool.query('DELETE FROM session');
  res.json({ deconnectes: r.rowCount });
});

// Pages
app.use('/assets', express.static(path.join(__dirname, 'hub', 'public', 'assets')));
const page = (f) => path.join(__dirname, 'hub', 'public', f);
app.get('/', (req, res) => res.sendFile(page('index.html')));
app.get('/admin', (req, res) => res.sendFile(page(isHub(req) ? 'admin.html' : 'login.html')));
app.use((req, res) => res.redirect('/'));

police.init()
  .then(chargerReglages)
  .then(dojo.init)
  .then(senso.init)
  .then(() => app.listen(PORT, () => console.log(`[server] Hub + police-suna en ligne sur le port ${PORT}`)))
  .catch((err) => { console.error('[server] Échec du démarrage :', err); process.exit(1); });
