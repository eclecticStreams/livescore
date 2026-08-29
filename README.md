# Standalone Livescore API

## Run

Requires Node.js 18+.

In this Codex desktop environment, run the included Windows launcher:

```bat
start.cmd
```

PowerShell users can alternatively bypass the local script policy:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

On a normal Node.js installation, `npm start` also works. ESPN is now the default data source; use `$env:SOURCE = "demo"` only when you want sample data.

Open `http://localhost:3000` for the dashboard.

## JSON API

- `GET /health`
- `GET /api/v1/sports`
- `GET /api/v1/competitions` — all configured competitions and ESPN slugs
- `GET /api/v1/leagues`
- `GET /api/v1/matches`
- `GET /api/v1/matches?status=live`
- `GET /api/v1/matches?sport=football&league=Premier%20League`
- `GET /api/v1/matches/:id`
- `GET /api/v1/stream` — Server-Sent Events stream, updates every 30 seconds
- `GET /openapi.json` — machine-readable API description

Match details include normalized `events` and `lineups` arrays when ESPN supplies them. Event records cover goals, cards, substitutions, and other key match events.

## Production foundations

The backend now caches ESPN scoreboard responses for 25 seconds and limits each client IP to 120 API requests per minute. Before public launch, put the service behind HTTPS and add persistent storage, a real job queue, authentication for customer API access, structured logging, and a licensed sports-data provider.

## Connect from another app

```js
const response = await fetch('http://localhost:3000/api/v1/matches');
const { data } = await response.json();
console.log(data);
```

For a deployed service, replace `http://localhost:3000` with your public HTTPS domain. Browsers can connect because CORS is enabled.

## ESPN source

Use ESPN live data for English Premier League matches:

```powershell
$env:SOURCE = "espn"
.\start.ps1
```

Or request it for one call:

```text
/api/v1/matches?source=espn&league=eng.1
```

Set `ESPN_LEAGUE` to another ESPN soccer league slug, such as `usa.1`, `esp.1`, or `ita.1`. Responses now include both a friendly `league` name and the original `leagueCode`.

Every API response is JSON. CORS is enabled for easy frontend integration. The sample data is in `server.js`; replace the in-memory array with a database and provider sync job when adding production data.
