/* Winter Ops Command Center - Integrated backend (Samsara + NWS + Airtable)
 * Fill in .env values to enable real data; otherwise it will fall back to demo data.
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 5173;
const UPDATE_INTERVAL_MS = parseInt(process.env.UPDATE_INTERVAL_MS || '30000', 10);

// ENV for Samsara
const SAMSARA_API_TOKEN = process.env.SAMSARA_API_TOKEN || '';
const SAMSARA_VEHICLE_TAG = process.env.SAMSARA_VEHICLE_TAG || ''; // optional: filter by tag name
// ENV for NWS (weather)
const OPERATIONS_LAT = parseFloat(process.env.OPERATIONS_LAT || '42.3601'); // default Boston
const OPERATIONS_LON = parseFloat(process.env.OPERATIONS_LON || '-71.0589');
const NWS_CONTACT = process.env.NWS_CONTACT || 'example@example.com'; // used in User-Agent per NWS policy
// ENV for Airtable
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || '';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';
const AIRTABLE_TABLE_SEASON = process.env.AIRTABLE_TABLE_SEASON || 'SeasonMetrics';
const AIRTABLE_TABLE_CREW = process.env.AIRTABLE_TABLE_CREW || 'CrewStatus';

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

/* ------------------------ DEMO FALLBACKS ------------------------ */
function demoFleet() {
  const now = new Date().toLocaleTimeString();
  return [
    { id: 1, name: 'Plow #12', driver: 'Mike Johnson', location: { latitude: 41.8781, longitude: -87.6298 }, status: 'active', lastUpdate: now },
    { id: 2, name: 'Salt Truck #5', driver: 'Sarah Williams', location: { latitude: 41.90, longitude: -87.65 }, status: 'active', lastUpdate: now },
    { id: 3, name: 'Plow #8', driver: 'Robert Chen', location: { latitude: 41.92, longitude: -87.70 }, status: 'maintenance', lastUpdate: now },
    { id: 4, name: 'Utility #3', driver: 'James Wilson', location: { latitude: 41.85, longitude: -87.60 }, status: 'active', lastUpdate: now }
  ];
}
function demoCrew() {
  return [
    { name: 'Mike Johnson',  location: 'Downtown Commercial District', status: 'ontime',  avatar: 'MJ' },
    { name: 'Sarah Williams', location: 'North Suburbs Route',        status: 'delayed', avatar: 'SW' },
    { name: 'Robert Chen',    location: 'Maintenance Yard',           status: 'overdue', avatar: 'RC' },
    { name: 'James Wilson',   location: 'East Industrial Park',       status: 'ontime',  avatar: 'JW' },
    { name: 'Lisa Garcia',    location: 'Airport Perimeter',          status: 'ontime',  avatar: 'LG' }
  ];
}
function demoWeather() {
  return {
    temp: 28, condition: 'Light Snow', wind: 12, snowToday: 2.1,
    alerts: [
      { type: 'warning', title: 'Winter Weather Advisory', description: 'Snow accumulations of 3-5 inches expected through tonight' },
      { type: 'severe',  title: 'Wind Chill Warning',      description: 'Dangerously cold wind chills expected overnight' }
    ],
    forecast: [
      { day: 'Today', snow: '2-4"' },
      { day: 'Tomorrow', snow: '1-2"' },
      { day: 'Wed', snow: '3-5"' },
      { day: 'Thu', snow: '0-1"' }
    ]
  };
}
function demoSeason() {
  return { seasonTotal: 42.5, stormEvents: 18, serviceHours: 1248, saltUsed: 245, monthlyAccumulation: [8.2, 12.5, 10.8, 6.3, 4.7] };
}

/* ------------------------ SIMPLE MEMORY CACHE ------------------------ */
const cache = new Map();
function setCache(key, value, ttlMs = 60000) {
  cache.set(key, { value, expires: Date.now() + ttlMs });
}
function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { cache.delete(key); return null; }
  return entry.value;
}

/* ------------------------ HELPERS ------------------------ */
function asNumber(x, fallback = 0) {
  const n = Number(x); return Number.isFinite(n) ? n : fallback;
}

/* ------------------------ SAMSARA FLEET ------------------------
 * Docs: https://developers.samsara.com/docs
 * We use the "List Vehicles" and "List Vehicle Locations" style flow via /fleet/vehicles/locations
 */
async function fetchFleetFromSamsara() {
  if (!SAMSARA_API_TOKEN) return demoFleet();
  const headers = { 'Authorization': `Bearer ${SAMSARA_API_TOKEN}`, 'Content-Type': 'application/json' };
  // vehicles/locations endpoint returns latest positions; filter by tag if provided.
  // Using v1 path for simplicity; many orgs still support it. If needed, swap to v2 with pagination.
  const base = 'https://api.samsara.com/v1';
  const url = new URL(base + '/fleet/vehicles/locations');
  if (SAMSARA_VEHICLE_TAG) url.searchParams.set('tag', SAMSARA_VEHICLE_TAG);
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    console.warn('Samsara error', resp.status);
    return demoFleet();
  }
  const data = await resp.json();
  // Normalize to dashboard format
  const vehicles = (data.vehicles || []).map(v => ({
    id: v.id || v.vehicleId || v.name,
    name: v.name || `Vehicle ${v.id}`,
    driver: (v.driver && (v.driver.name || v.driver.id)) || '—',
    location: {
      latitude: asNumber(v.latitude || (v.location && v.location.latitude)),
      longitude: asNumber(v.longitude || (v.location && v.location.longitude)),
    },
    status: v.engineOn === true ? 'active' : 'inactive',
    lastUpdate: new Date(v.time || Date.now()).toLocaleTimeString()
  })).filter(v => Number.isFinite(v.location.latitude) && Number.isFinite(v.location.longitude));
  return vehicles.length ? vehicles : demoFleet();
}

/* ------------------------ NWS WEATHER ------------------------
 * Policy: Must send a descriptive User-Agent with contact info.
 * Flow: /points/{lat},{lon} -> properties.forecast + gridId/gridX/gridY + alerts
 */
async function fetchNWSWeather() {
  const ua = `WinterOpsDashboard/1.0 (${NWS_CONTACT})`;
  try {
    // points
    const pt = await fetch(`https://api.weather.gov/points/${OPERATIONS_LAT},${OPERATIONS_LON}`, { headers: { 'User-Agent': ua, 'Accept': 'application/geo+json' } });
    if (!pt.ok) throw new Error('points failed');
    const pjson = await pt.json();
    const forecastUrl = pjson.properties && pjson.properties.forecast;
    const forecastHourly = pjson.properties && pjson.properties.forecastHourly;
    const gridId = pjson.properties && pjson.properties.gridId;
    const gridX = pjson.properties && pjson.properties.gridX;
    const gridY = pjson.properties && pjson.properties.gridY;
    // current from hourly first period
    let temp = null, wind = null, condition = null;
    if (forecastHourly) {
      const h = await fetch(forecastHourly, { headers: { 'User-Agent': ua } });
      if (h.ok) {
        const hj = await h.json();
        const first = hj.properties?.periods?.[0];
        if (first) {
          temp = first.temperature;
          wind = parseInt((first.windSpeed || '0').split(' ')[0], 10);
          condition = first.shortForecast;
        }
      }
    }
    // forecast next 3-4 periods (we'll collapse to 4 items)
    let fc = [];
    if (forecastUrl) {
      const f = await fetch(forecastUrl, { headers: { 'User-Agent': ua } });
      if (f.ok) {
        const fj = await f.json();
        const periods = fj.properties?.periods || [];
        for (let i = 0; i < Math.min(periods.length, 4); i++) {
          const p = periods[i];
          // crude snow text extraction if present
          const txt = p.detailedForecast || p.shortForecast || '';
          const snowMatch = txt.match(/(\d+)(?:\s?to\s?(\d+))?\s?inches/i);
          let snow = '—';
          if (snowMatch) {
            if (snowMatch[2]) snow = `${snowMatch[1]}-${snowMatch[2]}"`;
            else snow = `${snowMatch[1]}"`;
          }
          fc.push({ day: p.name || `P${i+1}`, snow });
        }
      }
    }
    // alerts (active)
    const alertsUrl = `https://api.weather.gov/alerts/active?point=${OPERATIONS_LAT},${OPERATIONS_LON}`;
    const a = await fetch(alertsUrl, { headers: { 'User-Agent': ua } });
    let alerts = [];
    if (a.ok) {
      const aj = await a.json();
      alerts = (aj.features || []).map(ft => ({
        type: (ft.properties.severity || '').toLowerCase().includes('severe') ? 'severe' : 'warning',
        title: ft.properties.event || 'Alert',
        description: ft.properties.headline || ft.properties.description || ''
      }));
    }
    return {
      temp: Number.isFinite(temp) ? temp : demoWeather().temp,
      condition: condition || demoWeather().condition,
      wind: Number.isFinite(wind) ? wind : demoWeather().wind,
      snowToday: demoWeather().snowToday, // NWS doesn't give "snow today" directly without more parsing; keep demo here.
      alerts, forecast: fc.length ? fc : demoWeather().forecast
    };
  } catch (e) {
    console.warn('NWS error', e.message);
    return demoWeather();
  }
}

/* ------------------------ AIRTABLE (Season + Crew) ------------------------ */
async function fetchAirtable(table) {
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) return null;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
  const resp = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
  if (!resp.ok) {
    console.warn('Airtable error', resp.status);
    return null;
  }
  return await resp.json();
}

async function fetchSeasonFromAirtable() {
  const cached = getCache('season'); if (cached) return cached;
  const data = await fetchAirtable(AIRTABLE_TABLE_SEASON);
  if (!data) return demoSeason();
  // Expect first record with fields: seasonTotal (number), stormEvents (number), serviceHours (number), saltUsed (number), monthlyAccumulation (JSON or text "[..]")
  const rec = (data.records || [])[0];
  if (!rec) return demoSeason();
  const f = rec.fields || {};
  let monthly = f.monthlyAccumulation;
  if (typeof monthly === 'string') {
    try { monthly = JSON.parse(monthly); } catch (e) { monthly = demoSeason().monthlyAccumulation; }
  }
  const out = {
    seasonTotal: asNumber(f.seasonTotal, demoSeason().seasonTotal),
    stormEvents: asNumber(f.stormEvents, demoSeason().stormEvents),
    serviceHours: asNumber(f.serviceHours, demoSeason().serviceHours),
    saltUsed: asNumber(f.saltUsed, demoSeason().saltUsed),
    monthlyAccumulation: Array.isArray(monthly) ? monthly.map(x => asNumber(x, 0)) : demoSeason().monthlyAccumulation
  };
  setCache('season', out, 60000);
  return out;
}

async function fetchCrewFromAirtable() {
  const cached = getCache('crew'); if (cached) return cached;
  const data = await fetchAirtable(AIRTABLE_TABLE_CREW);
  if (!data) return demoCrew();
  // Expect fields per record: name (text), location (text), status (ontime|delayed|overdue), avatar (text)
  const items = (data.records || []).map(r => {
    const f = r.fields || {};
    return {
      name: f.name || '—',
      location: f.location || '—',
      status: (f.status || 'ontime').toLowerCase(),
      avatar: f.avatar || (f.name ? f.name.split(' ').map(x => x[0]).join('').slice(0,2).toUpperCase() : '—')
    };
  });
  const out = items.length ? items : demoCrew();
  setCache('crew', out, 30000);
  return out;
}

/* ------------------------ TICK + ROUTES ------------------------ */
io.on('connection', (socket) => {
  socket.emit('tick', { at: new Date().toISOString() });
});

async function getFleet() {
  const cached = getCache('fleet');
  if (cached) return cached;
  const data = await fetchFleetFromSamsara();
  setCache('fleet', data, 15000);
  return data;
}

async function getWeather() {
  const cached = getCache('weather');
  if (cached) return cached;
  const data = await fetchNWSWeather();
  setCache('weather', data, 300000); // 5 minutes
  return data;
}

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/fleet', async (req, res) => res.json({ data: await getFleet(), updatedAt: new Date().toISOString() }));
app.get('/api/crew', async (req, res) => res.json({ data: await fetchCrewFromAirtable(), updatedAt: new Date().toISOString() }));
app.get('/api/weather', async (req, res) => res.json({ data: await getWeather(), updatedAt: new Date().toISOString() }));
app.get('/api/season', async (req, res) => res.json({ data: await fetchSeasonFromAirtable(), updatedAt: new Date().toISOString() }));

setInterval(() => { io.emit('tick', { at: new Date().toISOString() }); }, UPDATE_INTERVAL_MS);

// Fallback to index.html
app.get('*', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

server.listen(PORT, () => console.log(`Winter Ops backend (integrated) on http://localhost:${PORT}`));
