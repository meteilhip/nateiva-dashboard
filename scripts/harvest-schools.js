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

(async () => {
  let manual = [];
  const previous = {};
  try {
    const cur = fs.readFileSync(OUT, 'utf-8');
    const m = cur.match(/window\.NATEIVA_DIRECTORY\s*=\s*(\[[\s\S]*\]);/);
    if (m) {
      const arr = JSON.parse(m[1]);
      manual = arr.filter(e => e && e.source && e.source !== 'OSM');
      arr.filter(e => e && e.source === 'OSM').forEach(e => { (previous[e.city] = previous[e.city] || []).push(e); });
    }
  } catch (e) { /* premier passage */ }

  const all = [...manual];
  let ok = 0;
  const failed = [];
  for (const [city, cc] of Object.entries(CITIES)) {
    const items = await harvestCity(city, cc);
    if (items === null) {
      failed.push(city);
      if (previous[city]) all.push(...previous[city]); // échec → on garde l'ancienne récolte
    } else {
      all.push(...items);
      ok++;
      console.log(city, items.length, 'écoles');
    }
    await new Promise(r => setTimeout(r, 3000)); // politesse envers les serveurs Overpass
  }
  const header = fs.readFileSync(OUT, 'utf-8').split('window.NATEIVA_DIRECTORY')[0];
  fs.writeFileSync(OUT, header + 'window.NATEIVA_DIRECTORY = ' + JSON.stringify(all) + ';\n');
  console.log('TOTAL', all.length, 'écoles ·', ok, 'villes récoltées ·', manual.length, 'entrées manuelles conservées', failed.length ? '· échecs: ' + failed.join(',') : '');
  if (ok === 0) process.exit(1); // rien récolté → ne pas committer un fichier appauvri
})();
