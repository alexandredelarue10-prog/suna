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
const SITES = ['police-suna', 'dojo-fuinjutsu', 'dojo-sensoriel', 'album']; // sites hébergés ici, verrouillables séparément
const reglages = { locks: {}, annonce: { actif: false, texte: '' }, album: { titre: 'Album photo', description: '' } };
async function chargerReglages() {
  await pool.query('CREATE TABLE IF NOT EXISTS hub_settings (cle TEXT PRIMARY KEY, valeur JSONB NOT NULL)');
  await pool.query(`CREATE TABLE IF NOT EXISTS hub_album_photos (id SERIAL PRIMARY KEY, ordre INT NOT NULL DEFAULT 0, titre TEXT NOT NULL DEFAULT '', legende TEXT NOT NULL DEFAULT '',
    visible BOOLEAN NOT NULL DEFAULT TRUE, mime TEXT NOT NULL, donnees BYTEA NOT NULL, taille INT NOT NULL, cree_le TIMESTAMPTZ DEFAULT now(), maj TIMESTAMPTZ DEFAULT now())`);
  const { rows } = await pool.query('SELECT cle, valeur FROM hub_settings');
  for (const r of rows) {
    if (r.cle === 'annonce') reglages.annonce = { ...reglages.annonce, ...r.valeur };
    else if (r.cle === 'album') reglages.album = { ...reglages.album, ...r.valeur };
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

// Album photo : verrouillable séparément, comme les autres sites (page, images et données)
app.use('/album', verrou('album'));

// Dojo des ninja sensoriels (détection de chakra)
app.get(/^\/dojo-sensoriel$/, (req, res) => res.redirect('/dojo-sensoriel/'));
app.use('/dojo-sensoriel', verrou('dojo-sensoriel'), (req, res, next) => { req.hubAdmin = isHub(req); next(); }, senso.app);

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
  res.json({ sites, annonce: reglages.annonce, stats });
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

// ---------- Album photo (images stockées en base : le disque de l'hébergeur est éphémère) ----------
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const ALBUM_MAX = 400;
function detecterImage(b) { // on ne fait pas confiance au type annoncé : on lit les premiers octets (pas de SVG, pas de HTML déguisé)
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  const h6 = b.subarray(0, 6).toString('latin1');
  if (h6 === 'GIF87a' || h6 === 'GIF89a') return 'image/gif';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
const rawImg = express.raw({ type: () => true, limit: '8mb' });
const lireImage = (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) { res.status(400).json({ error: 'Image manquante.' }); return null; }
  const mime = detecterImage(buf);
  if (!mime) { res.status(400).json({ error: 'Format non pris en charge (JPEG, PNG, WebP ou GIF).' }); return null; }
  return { buf, mime };
};
const idParam = (req) => { const n = Number(req.params.id); return Number.isInteger(n) ? n : -1; };

app.get('/hub/album', ah(async (req, res) => {
  if (reglages.locks.album && reglages.locks.album.actif && !isHub(req)) return res.status(503).json({ error: reglages.locks.album.message || MSG_DEFAUT, maintenance: true });
  const r = await pool.query('SELECT id, titre, legende, EXTRACT(EPOCH FROM maj)::bigint AS v FROM hub_album_photos WHERE visible ORDER BY ordre, id');
  res.json({ ...reglages.album, photos: r.rows });
}));
app.get('/album/img/:id', ah(async (req, res) => {
  const r = await pool.query('SELECT mime, donnees, visible FROM hub_album_photos WHERE id=$1', [idParam(req)]);
  const p = r.rows[0];
  if (!p || (!p.visible && !isHub(req))) return res.sendStatus(404);
  res.set({ 'Content-Type': p.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': p.visible ? 'public, max-age=31536000, immutable' : 'private, no-store' }); // l'URL change (?v=) quand l'image est remplacée
  res.send(p.donnees);
}));
app.get('/hub/admin/album', requireHub, ah(async (req, res) => {
  const r = await pool.query('SELECT id, titre, legende, visible, mime, taille, EXTRACT(EPOCH FROM maj)::bigint AS v FROM hub_album_photos ORDER BY ordre, id');
  res.json({ ...reglages.album, photos: r.rows, total: r.rows.reduce((a, p) => a + p.taille, 0), max: ALBUM_MAX });
}));
app.put('/hub/admin/album', requireHub, ah(async (req, res) => {
  await sauver('album', { titre: texte(req.body.titre, 120) || 'Album photo', description: texte(req.body.description, 2000) });
  res.json(reglages.album);
}));
app.post('/hub/admin/album/photos', requireHub, rawImg, ah(async (req, res) => {
  const img = lireImage(req, res); if (!img) return;
  if ((await pool.query('SELECT COUNT(*)::int AS n FROM hub_album_photos')).rows[0].n >= ALBUM_MAX) return res.status(400).json({ error: `Limite de ${ALBUM_MAX} photos atteinte.` });
  const r = await pool.query('INSERT INTO hub_album_photos (ordre, mime, donnees, taille) VALUES ((SELECT COALESCE(MAX(ordre), 0) + 1 FROM hub_album_photos), $1, $2, $3) RETURNING id', [img.mime, img.buf, img.buf.length]);
  res.json({ id: r.rows[0].id });
}));
app.post('/hub/admin/album/photos/:id/image', requireHub, rawImg, ah(async (req, res) => {
  const img = lireImage(req, res); if (!img) return;
  const r = await pool.query('UPDATE hub_album_photos SET mime=$1, donnees=$2, taille=$3, maj=now() WHERE id=$4', [img.mime, img.buf, img.buf.length, idParam(req)]);
  r.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Photo introuvable.' });
}));
app.put('/hub/admin/album/ordre', requireHub, ah(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length || ids.length > ALBUM_MAX) return res.status(400).json({ error: 'Ordre invalide.' });
  await pool.query('WITH t AS (SELECT id, ord FROM unnest($1::int[]) WITH ORDINALITY AS u(id, ord)) UPDATE hub_album_photos p SET ordre = t.ord FROM t WHERE p.id = t.id', [ids]);
  res.json({ ok: true });
}));
app.put('/hub/admin/album/photos/:id', requireHub, ah(async (req, res) => {
  const r = await pool.query('UPDATE hub_album_photos SET titre=$1, legende=$2, visible=$3 WHERE id=$4', [texte(req.body.titre, 120), texte(req.body.legende, 3000), !!req.body.visible, idParam(req)]);
  r.rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Photo introuvable.' });
}));
app.delete('/hub/admin/album/photos/:id', requireHub, ah(async (req, res) => {
  await pool.query('DELETE FROM hub_album_photos WHERE id=$1', [idParam(req)]); res.json({ ok: true });
}));

// Pages
app.use('/assets', express.static(path.join(__dirname, 'hub', 'public', 'assets')));
const page = (f) => path.join(__dirname, 'hub', 'public', f);
app.get('/', (req, res) => res.sendFile(page('index.html')));
app.get('/album', (req, res) => res.sendFile(page('album.html')));
app.get('/admin/album', (req, res) => (isHub(req) ? res.sendFile(page('admin-album.html')) : res.redirect('/admin')));
app.get('/admin', (req, res) => res.sendFile(page(isHub(req) ? 'admin.html' : 'login.html')));
app.use((req, res) => res.redirect('/'));
app.use((err, req, res, next) => { // jamais de pile d'erreur ni de chemin serveur dans la réponse
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Fichier trop volumineux (8 Mo max).' });
  console.error('[server]', err.message);
  res.status(err.status || 500).json({ error: 'Erreur serveur.' });
});

police.init()
  .then(chargerReglages)
  .then(dojo.init)
  .then(senso.init)
  .then(() => app.listen(PORT, () => console.log(`[server] Hub + police-suna en ligne sur le port ${PORT}`)))
  .catch((err) => { console.error('[server] Échec du démarrage :', err); process.exit(1); });
