# Winter Operations Command Center (Local)

A ready-to-run package that serves your dashboard with a local backend API and live updates via Socket.IO.

## Quick Start (no Docker)

1. Install Node.js 18+ (or 20+ recommended).
2. Open a terminal in this folder and run:
   ```bash
   npm install
   cp .env.example .env
   npm start
   ```
3. Visit: http://localhost:5173

## Quick Start (Docker)

```bash
docker compose up --build
```

## What’s inside

- **server.js** — Express backend with `/api/fleet`, `/api/crew`, `/api/weather`, `/api/season` and Socket.IO updates every 30s (configurable).
- **public/index.html** — Your provided UI, wired to the backend (replaces in-page demo data with API calls).
- **Dockerfile**, **docker-compose.yml** — optional containerization.
- **.env.example** — copy to `.env` to override `PORT` or `UPDATE_INTERVAL_MS`.

## Integrations (later)

Swap demo endpoints for real systems:
- Fleet: Samsara/Verizon Connect → update `/api/fleet` in `server.js`.
- Weather: NWS/NOAA/Open-Meteo → update `/api/weather`.
- Season metrics: your DB/Airtable → update `/api/season`.
- Cameras: stream proxy or snapshots → host or embed in `public/assets/`.


---

## Zero-Click Start (recommended)

- **Windows (double-click):** open `scripts\start.bat`
- **Windows PowerShell (right-click → Run with PowerShell):** `scripts\start.ps1`
- **macOS/Linux (Terminal):**
  ```bash
  chmod +x scripts/start.sh
  ./scripts/start.sh
  ```

These scripts will:
1) check for Node.js,  
2) install dependencies if needed,  
3) create `.env` from the example if it doesn’t exist,  
4) open your browser, and  
5) start the server.


## Plugging in real data (what you provide)

### 1) Fleet via Samsara
- **SAMSARA_API_TOKEN**: Create a **read-only** token with permission to read vehicle locations.
- Optional: **SAMSARA_VEHICLE_TAG** to limit to a specific tag (exact name).

Paste it into your `.env`.

### 2) Weather & alerts via NWS (free, no key)
- **OPERATIONS_LAT**, **OPERATIONS_LON**: Coordinates of your hub or service area center.
- **NWS_CONTACT**: Your email for the required User-Agent contact.

### 3) Season totals & crew via Airtable
- **AIRTABLE_TOKEN**: Personal Access Token with read access to your base.
- **AIRTABLE_BASE_ID**: ID of your Airtable base.
- **AIRTABLE_TABLE_SEASON** (default `SeasonMetrics`) — create a table with **one row** and these fields:
  - `seasonTotal` (number)
  - `stormEvents` (number)
  - `serviceHours` (number)
  - `saltUsed` (number)
  - `monthlyAccumulation` (long text or JSON) — e.g. `[8.2, 12.5, 10.8, 6.3, 4.7]`
- **AIRTABLE_TABLE_CREW** (default `CrewStatus`) — fields per row:
  - `name` (text)
  - `location` (text)
  - `status` (single select: ontime | delayed | overdue)
  - `avatar` (formula or text) — e.g. initials

After you fill `.env`, just run the start script again.

## Notes
- If a service is not configured, the backend auto-falls-back to demo data so the UI still works.
- NWS does not provide “snow today” directly via a simple field. The dashboard shows alerts + forecast and keeps a demo value for "Snow Today" unless you connect another source.
