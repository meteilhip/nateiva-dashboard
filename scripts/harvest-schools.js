/* Récolte OpenStreetMap (API Overpass) des écoles/universités du Cameroun
   pour les 25 villes couvertes par la carte NATEIVA, et régénère
   nateiva-schools-directory.generated.js. Les entrées manuelles dont la
   source n'est pas "OSM" (annuaires MINEDUB/MINESEC/ANIPES, relevés
   Facebook/Google Maps) sont conservées telles quelles.
   Exécuté par GitHub Actions (hebdomadaire + à la demande). */
'use strict';
const https = require('https');
const fs = require('fs');

const CITIES = {
  DOUALA: [4.0511, 9.7679], YAOUNDE: [3.848, 11.5021], BAFOUSSAM: [5.4781, 10.4179],
  BAMENDA: [5.9631, 10.1591], GAROUA: [9.3265, 13.3958], MAROUA: [10.5956, 14.3247],
  NGAOUNDERE: [7.3167, 13.5833], BERTOUA: [4.5776, 13.6846], EBOLOWA: [2.9, 11.15],
  BUEA: [4.1527, 9.292], LIMBE: [4.0215, 9.2125], KUMBA: [4.6363, 9.4469],
  KRIBI: [2.9404, 9.9098], EDEA: [3.8, 10.1333], NKONGSAMBA: [4.9547, 9.9404],
  DSCHANG: [5.4437, 10.0533], FOUMBAN: [5.7287, 10.8984], MBALMAYO: [3.5167, 11.5],
  SANGMELIMA: [2.9333, 11.9833], BAFIA: [4.75, 11.2333], KUMBO: [6.2, 10.6667],
  MBOUDA: [5.6264, 10.2542], LOUM: [4.7182, 9.7351], YAGOUA: [10.3428, 15.2406], MEIGANGA: [6.5167, 14.3]
};
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const OUT = 'nateiva-schools-directory.generated.js';

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NATEIVA-dashboard-harvest/1.0' },
      timeout: 90000
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => res.statusCode === 200 ? resolve(d) : reject(new Error('HTTP ' + res.statusCode)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function kindOf(tags, name) {
  const a = (tags.amenity || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (a === 'university') return 'Université';
  if (a === 'college') return 'Supérieur / Grande école';
  if (a === 'kindergarten') return 'Maternelle';
  if (/universit|institut sup|polytech/.test(n)) return 'Université';
  if (/lyc[ée]e|coll[èe]ge|secondary|high school/.test(n)) return 'Secondaire';
  if (/maternelle|nursery|kindergarten|cr[èe]che/.test(n)) return 'Maternelle';
  return 'Primaire / École';
}

async function harvestCity(city, cc) {
  const q = `[out:json][timeout:80];(nwr["amenity"~"^(school|college|university|kindergarten)$"](around:28000,${cc[0]},${cc[1]}););out center tags;`;
  for (const ep of ENDPOINTS) {
    try {
      const json = JSON.parse(await post(ep, 'data=' + encodeURIComponent(q)));
      const items = (json.elements || []).map(el => {
        const lat = el.lat != null ? el.lat : (el.center ? el.center.lat : null);
        const lng = el.lon != null ? el.lon : (el.center ? el.center.lon : null);
        const t = el.tags || {};
        if (lat == null || lng == null || !t.name) return null;
        return {
          city, name: t.name,
          lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5,
          kind: kindOf(t, t.name),
          quartier: t['addr:suburb'] || t['addr:quarter'] || t['addr:street'] || '',
          phone: t.phone || t['contact:phone'] || '',
          capacity: t.capacity || t['capacity:pupils'] || '',
          operator: t.operator || '', source: 'OSM'
        };
      }).filter(Boolean);
      const seen = new Set();
      return items.filter(i => {
        const k = i.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    } catch (e) { console.error(city, ep, e.message); }
  }
  return null; // tous les serveurs ont échoué pour cette ville
}

const normKey = (city, name) => city + '|' + String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Phase GEO : villes (place=city|town) et quartiers (suburb|quarter|
// neighbourhood) de chaque région, avec coordonnées, fusionnés dans
// nateiva-geo.generated.js (le référentiel de départ est conservé).
// ---------------------------------------------------------------------------
const GEO_OUT = 'nateiva-geo.generated.js';
const REGION_ISO = { AD: 'CM-AD', CE: 'CM-CE', ES: 'CM-ES', EN: 'CM-EN', LT: 'CM-LT', NO: 'CM-NO', NW: 'CM-NW', OU: 'CM-OU', SU: 'CM-SU', SW: 'CM-SW' };
const nk = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const kmB = (a, b) => { const R = 6371, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lng - a.lng) * Math.PI / 180; const s = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
async function overpass(q) {
  for (const ep of ENDPOINTS) {
    try { return JSON.parse(await post(ep, 'data=' + encodeURIComponent(q))); } catch (e) { console.error('geo', ep, e.message); }
  }
  return null;
}
async function harvestGeo() {
  const cur = fs.readFileSync(GEO_OUT, 'utf-8');
  const m = cur.match(/window\.NATEIVA_GEO\s*=\s*(\{[\s\S]*\});/);
  const geo = JSON.parse(m[1]);
  let towns = 0, quarters = 0;
  for (const region of geo.regions) {
    const iso = REGION_ISO[region.code];
    const jt = await overpass(`[out:json][timeout:120];area["ISO3166-2"="${iso}"]->.a;(node(area.a)["place"~"^(city|town)$"];);out tags;`);
    await new Promise(r => setTimeout(r, 3000));
    const jq = await overpass(`[out:json][timeout:150];area["ISO3166-2"="${iso}"]->.a;(node(area.a)["place"~"^(suburb|quarter|neighbourhood)$"];);out tags;`);
    await new Promise(r => setTimeout(r, 3000));
    if (jt) {
      (jt.elements || []).forEach(el => {
        const name = el.tags && (el.tags['name:fr'] || el.tags.name);
        if (!name || el.lat == null) return;
        const key = nk(name);
        let city = region.cities.find(c => c.key === key || nk(c.name) === key);
        if (!city) { city = { key, name, quartiers: [] }; region.cities.push(city); }
        if (city.lat == null) { city.lat = Math.round(el.lat * 1e4) / 1e4; city.lng = Math.round(el.lon * 1e4) / 1e4; }
        towns++;
      });
    }
    if (jq) {
      const withCoords = region.cities.filter(c => c.lat != null);
      (jq.elements || []).forEach(el => {
        const name = el.tags && (el.tags['name:fr'] || el.tags.name);
        if (!name || el.lat == null || !withCoords.length) return;
        const p = { lat: el.lat, lng: el.lon };
        let best = null, bd = Infinity;
        withCoords.forEach(c => { const d = kmB(p, c); if (d < bd) { bd = d; best = c; } });
        if (!best || bd > 25) return; // quartier rural isolé : ignoré
        const qn = nk(name);
        const existing = best.quartiers.find(q => nk(q.n) === qn);
        if (existing) { if (existing.lat == null) { existing.lat = Math.round(el.lat * 1e5) / 1e5; existing.lng = Math.round(el.lon * 1e5) / 1e5; } }
        else best.quartiers.push({ n: qn, lat: Math.round(el.lat * 1e5) / 1e5, lng: Math.round(el.lon * 1e5) / 1e5 });
        quarters++;
      });
    }
    region.cities.sort((a, b) => (b.quartiers.length - a.quartiers.length) || a.name.localeCompare(b.name));
    region.cities.forEach(c => c.quartiers.sort((a, b) => a.n.localeCompare(b.n)));
    console.log('GEO', region.name, region.cities.length, 'villes');
  }
  geo.generatedAt = new Date().toISOString().slice(0, 10);
  geo.source = 'seed+osm';
  const header = cur.split('window.NATEIVA_GEO')[0];
  fs.writeFileSync(GEO_OUT, header + 'window.NATEIVA_GEO = ' + JSON.stringify(geo) + ';\n');
  console.log('GEO TOTAL', towns, 'villes OSM,', quarters, 'quartiers géolocalisés');
}

const TARGET = (process.env.TARGET || 'schools').toLowerCase();

(async () => {
  if (TARGET === 'geo' || TARGET === 'all') {
    try { await harvestGeo(); } catch (e) { console.error('GEO échec', e.message); }
    if (TARGET === 'geo') return;
  }
  let manual = [];
  const previous = {};
  const knownKeys = {}; // clé → addedAt éventuel, pour marquer les VRAIES nouveautés
  try {
    const cur = fs.readFileSync(OUT, 'utf-8');
    const m = cur.match(/window\.NATEIVA_DIRECTORY\s*=\s*(\[[\s\S]*\]);/);
    if (m) {
      const arr = JSON.parse(m[1]);
      manual = arr.filter(e => e && e.source && e.source !== 'OSM');
      arr.filter(e => e && e.source === 'OSM').forEach(e => { (previous[e.city] = previous[e.city] || []).push(e); });
      arr.forEach(e => { if (e && e.name) knownKeys[normKey(e.city, e.name)] = e.addedAt || ''; });
    }
  } catch (e) { /* premier passage */ }

  const today = new Date().toISOString().slice(0, 10);
  const all = [...manual];
  let ok = 0, fresh = 0;
  const failed = [];
  for (const [city, cc] of Object.entries(CITIES)) {
    const items = await harvestCity(city, cc);
    if (items === null) {
      failed.push(city);
      if (previous[city]) all.push(...previous[city]); // échec → on garde l'ancienne récolte
    } else {
      // Marquage des nouveautés : une école absente de la récolte précédente
      // reçoit addedAt = date du jour (mise en avant ✨ sur la carte) ; une
      // école déjà connue garde son addedAt d'origine (ou aucun).
      items.forEach(i => {
        const k = normKey(i.city, i.name);
        if (k in knownKeys) { if (knownKeys[k]) i.addedAt = knownKeys[k]; }
        else { i.addedAt = today; fresh++; }
      });
      all.push(...items);
      ok++;
      console.log(city, items.length, 'écoles');
    }
    await new Promise(r => setTimeout(r, 3000)); // politesse envers les serveurs Overpass
  }
  console.log('Nouveautés de cette récolte:', fresh);
  const header = fs.readFileSync(OUT, 'utf-8').split('window.NATEIVA_DIRECTORY')[0];
  fs.writeFileSync(OUT, header + 'window.NATEIVA_DIRECTORY = ' + JSON.stringify(all) + ';\n');
  console.log('TOTAL', all.length, 'écoles ·', ok, 'villes récoltées ·', manual.length, 'entrées manuelles conservées', failed.length ? '· échecs: ' + failed.join(',') : '');
  if (ok === 0) process.exit(1); // rien récolté → ne pas committer un fichier appauvri
})();
