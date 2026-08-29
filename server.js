const http = require('http');
const { URL } = require('url');

const port = Number(process.env.PORT || 3000);
const defaultLeague = process.env.ESPN_LEAGUE || 'eng.1';
const source = process.env.SOURCE || 'espn';
const startedAt = new Date().toISOString();
const leagueNames = { 'eng.1': 'Premier League', 'esp.1': 'La Liga', 'ita.1': 'Serie A', 'ger.1': 'Bundesliga', 'fra.1': 'Ligue 1', 'usa.1': 'MLS' };
const requestLog = new Map();
const espnCache = new Map();
const aggregateCache = { time: 0, data: [] };
const competitions = `Champions League|ucl|uefa.champions|soccer
Europa League|uel|uefa.europa|soccer
Premier League|epl|eng.1|soccer
La Liga|laliga|esp.1|soccer
Serie A|seriea|ita.1|soccer
Bundesliga|bundesliga|ger.1|soccer
Ligue 1|ligue1|fra.1|soccer
MLS|mls|usa.1|soccer
FIFA World Cup|worldcup|fifa.world|soccer
UEFA Euro|euro|uefa.euro|soccer
Intl Friendlies|intlfriendly|fifa.friendly|soccer
NBA|nba|nba|basketball
NFL|nfl|nfl|football
NHL|nhl|nhl|hockey
Formula 1|f1|f1|racing
NASCAR|nascar|nascar-cup-series|racing
PGA Tour|pga|pga|golf
UFC / MMA|ufc|ufc|mma
ATP Tennis|atp|atp|tennis
WTA Tennis|wta|wta|tennis
Championship|efl|eng.2|soccer
Saudi Pro League|spl|ksa.1|soccer
Eredivisie|eredivisie|ned.1|soccer
Primeira Liga|primeira|por.1|soccer
FA Cup|facup|eng.fa|soccer
MotoGP|motogp|motogp|racing
Cycling|cycling|world|cycling
MLB|mlb|mlb|baseball
Conference League|uecl|uefa.europa.conf|soccer
Club World Cup|cwc|fifa.cwc|soccer
Club Friendlies|clubfriendly|club.friendly|soccer
Nations League|unl|uefa.nations|soccer
AFCON|afcon|caf.nations|soccer
Copa América|copaamrica|conmebol.america|soccer
CONCACAF Gold Cup|goldcup|concacaf.gold|soccer
CONCACAF Champions|concacafcc|concacaf.champions|soccer
Carabao Cup|eflcup|eng.league_cup|soccer
Scottish Prem|spfl|sco.1|soccer
Süper Lig|superlig|tur.1|soccer
Brasileirão|brasileirao|bra.1|soccer
Liga MX|ligamx|mex.1|soccer
Argentine Primera|argentina|arg.1|soccer
WNBA|wnba|wnba|basketball
IndyCar|indycar|indycar|racing
Women's Super League|wsl|eng.w.1|soccer
Liga F|ligaf|esp.w.1|soccer
Frauen-Bundesliga|frauenbl|ger.w.bundesliga|soccer
Première Ligue|d1feminine|fra.w.1|soccer
NWSL|nwsl|usa.nwsl|soccer
Women's Champions League|uwcl|uefa.wchampions|soccer
Women's Euro|weuro|uefa.weuro|soccer
Women's AFCON|wafcon|caf.w.nations|soccer
Women's World Cup|wwc|fifa.wwc|soccer`.split('\n').map((line, index) => { const [name, id, slug, sport] = line.split('|'); return { id: index + 1, name, internalId: id, espnSlug: slug, sport }; });

// Replace this in-memory store with a database or provider sync worker in production.
const matches = [
  { id: 'm-1001', sport: 'football', league: 'Premier League', country: 'England', home: { id: 'ars', name: 'Arsenal', score: 2 }, away: { id: 'che', name: 'Chelsea', score: 1 }, status: 'live', minute: 67, kickoff: '2026-08-19T17:30:00Z' },
  { id: 'm-1002', sport: 'football', league: 'La Liga', country: 'Spain', home: { id: 'rma', name: 'Real Madrid', score: 0 }, away: { id: 'bar', name: 'Barcelona', score: 0 }, status: 'scheduled', minute: null, kickoff: '2026-08-19T20:00:00Z' },
  { id: 'm-1003', sport: 'football', league: 'Serie A', country: 'Italy', home: { id: 'int', name: 'Inter Milan', score: 3 }, away: { id: 'acm', name: 'AC Milan', score: 2 }, status: 'finished', minute: 90, kickoff: '2026-08-19T14:00:00Z' },
  { id: 'm-1004', sport: 'basketball', league: 'NBA', country: 'USA', home: { id: 'lal', name: 'Los Angeles Lakers', score: 88 }, away: { id: 'bos', name: 'Boston Celtics', score: 91 }, status: 'live', minute: 'Q3 04:12', kickoff: '2026-08-19T18:00:00Z' }
];

function normalizeEspnEvent(event, competitionSlug = defaultLeague, competitionSport = 'soccer') {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
  const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
  const status = event.status?.type;
  const state = status?.state === 'in' ? 'live' : status?.completed ? 'finished' : 'scheduled';
  return {
    id: `espn-${event.id}`,
    provider: 'espn',
    sport: 'football',
    league: leagueNames[competitionSlug] || event.league?.name || event.season?.displayName || competitionSlug,
    leagueCode: competitionSlug,
    country: null,
    home: { id: String(home.team?.id || ''), name: home.team?.displayName || 'Home', score: Number(home.score || 0) },
    away: { id: String(away.team?.id || ''), name: away.team?.displayName || 'Away', score: Number(away.score || 0) },
    status: state,
    minute: state === 'live' ? (status?.detail || null) : null,
    kickoff: event.date,
    rawStatus: status?.description || null
  };
}

function providerSport(sport) { return ({ soccer: 'soccer', basketball: 'basketball', football: 'football', hockey: 'hockey', racing: 'racing', golf: 'golf', mma: 'mma', tennis: 'tennis', baseball: 'baseball', cycling: 'cycling' })[sport] || sport; }

async function getEspnMatches(league = defaultLeague, sport = 'soccer') {
  const cached = espnCache.get(league);
  if (cached && Date.now() - cached.time < 25000) return cached.data;
  const endpoint = `https://site.api.espn.com/apis/site/v2/sports/${providerSport(sport)}/${encodeURIComponent(league)}/scoreboard`;
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`ESPN returned HTTP ${response.status}`);
  const payload = await response.json();
  const data = (payload.events || []).map(event => ({ ...normalizeEspnEvent(event, league, sport), sport }));
  espnCache.set(league, { time: Date.now(), data });
  return data;
}

async function getAllEspnMatches() {
  if (Date.now() - aggregateCache.time < 60000) return aggregateCache.data;
  const results = await Promise.allSettled(competitions.map(c => getEspnMatches(c.espnSlug, c.sport)));
  aggregateCache.data = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  aggregateCache.time = Date.now();
  return aggregateCache.data;
}

function dateKey(offset) { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10).replaceAll('-', ''); }

async function getEspnMatch(id, league = defaultLeague) {
  const endpoint = `https://site.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(league)}/summary?event=${encodeURIComponent(id)}`;
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`ESPN returned HTTP ${response.status}`);
  const payload = await response.json();
  const competition = payload.header?.competitions?.[0];
  if (!competition) return null;
  const normalized = normalizeEspnEvent({ id, date: competition.date, competitions: [competition], status: competition.status }, league, 'soccer');
  const events = (payload.keyEvents || []).map((event, index) => ({
    id: event.id || `${id}-event-${index + 1}`,
    type: event.type?.text || event.type?.name || 'event',
    text: event.shortText || event.text || event.description || null,
    minute: event.clock?.displayValue || event.clock?.value || null,
    team: event.team?.displayName || null,
    athlete: event.athletesInvolved?.map(a => a.displayName).join(', ') || null
  }));
  const lineups = (payload.rosters || []).map(roster => ({
    team: roster.team?.displayName || null,
    players: (roster.roster || []).map(player => ({
      id: player.athlete?.id || null,
      name: player.athlete?.displayName || null,
      position: player.position?.abbreviation || player.position?.displayName || null,
      starter: Boolean(player.starter),
      substituted: Boolean(player.subbedIn || player.subbedOut)
    }))
  }));
  return { ...normalized, events, lineups, summary: payload };
}

function send(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(payload);
}

const openapi = {
  openapi: '3.0.3', info: { title: 'Livescore API', version: '1.0.0' }, servers: [{ url: 'http://localhost:3000' }],
  paths: {
    '/health': { get: { responses: { 200: { description: 'Service health' } } } },
    '/api/v1/matches': { get: { parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['live', 'scheduled', 'finished'] } }, { name: 'league', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Matches' } } } },
    '/api/v1/matches/{id}': { get: { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Match details' }, 404: { description: 'Not found' } } } },
    '/api/v1/stream': { get: { responses: { 200: { description: 'Server-Sent Events stream' } } } }
  }
};

function dashboard(res) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Livescore</title><style>body{font:16px system-ui;max-width:900px;margin:30px auto;padding:0 18px;background:#f5f7fb;color:#172033}header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.filters{display:flex;gap:8px;margin:18px 0}select{padding:10px;border:1px solid #d7dce5;border-radius:8px;background:white}.card{background:white;padding:18px;margin:12px 0;border-radius:12px;box-shadow:0 2px 8px #0001;cursor:pointer}.teams{display:grid;grid-template-columns:1fr auto 1fr;gap:15px;align-items:center;font-weight:700}.teams span:last-child{text-align:right}.score{font-size:20px}.muted{color:#697386}.live{color:#d93025}.empty{text-align:center;padding:30px}.pill{font-size:12px;color:#d93025;font-weight:700}</style></head><body><header><div><h1>Livescore</h1><p class="muted">Live data · <span id="updated">connecting…</span></p></div><strong id="count"></strong></header><div class="filters"><select id="status"><option value="all">All matches</option><option value="live">Live now</option><option value="scheduled">Upcoming</option><option value="finished">Finished</option></select><select id="league"><option value="all">All leagues</option></select></div><main id="app">Loading…</main><script>let all=[];function render(d){all=d.data||[];const leagues=[...new Set(all.map(m=>m.league))];const l=document.querySelector('#league');const current=l.value;l.innerHTML='<option value="all">All leagues</option>'+leagues.map(x=>'<option>'+x+'</option>').join('');l.value=leagues.includes(current)?current:'all';draw();document.querySelector('#updated').textContent='updated '+new Date().toLocaleTimeString()}function draw(){const s=document.querySelector('#status').value,l=document.querySelector('#league').value;const data=all.filter(m=>(s==='all'||m.status===s)&&(l==='all'||m.league===l));document.querySelector('#count').textContent=data.length+' matches';document.querySelector('#app').innerHTML=data.length?data.map(m=>'<article class="card" data-id="'+m.id+'"><small>'+m.league+' · '+(m.status==='live'?'<span class="pill">LIVE</span>':m.status.toUpperCase())+'</small><div class="teams"><span>'+m.home.name+'</span><span class="score">'+m.home.score+' – '+m.away.score+'</span><span>'+m.away.name+'</span></div><p class="muted">'+(m.minute||new Date(m.kickoff).toLocaleString())+'</p></article>').join(''):'<div class="empty">No matches found</div>'}document.querySelector('#status').onchange=draw;document.querySelector('#league').onchange=draw;document.querySelector('#app').onclick=e=>{const card=e.target.closest('[data-id]');if(card) location.href='/api/v1/matches/'+card.dataset.id};fetch('/api/v1/matches').then(r=>r.json()).then(render).catch(()=>document.querySelector('#app').textContent='Unable to load matches');const stream=new EventSource('/api/v1/stream');stream.onmessage=e=>render(JSON.parse(e.data));</script></body></html>`);
}

async function stream(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
  const publish = async () => {
    try { const data = source === 'espn' ? await getAllEspnMatches() : matches; res.write(`data: ${JSON.stringify({ data, meta: { updatedAt: new Date().toISOString() } })}\n\n`); }
    catch { res.write(`event: error\ndata: ${JSON.stringify({ error: 'provider_unavailable' })}\n\n`); }
  };
  await publish();
  const timer = setInterval(publish, 30000);
  req.on('close', () => clearInterval(timer));
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    const now = Date.now();
    const ip = req.socket.remoteAddress || 'unknown';
    const recent = (requestLog.get(ip) || []).filter(t => now - t < 60000);
    if (recent.length >= 120) return send(res, 429, { error: 'rate_limit_exceeded', retryAfterSeconds: 60 });
    recent.push(now); requestLog.set(ip, recent);
  }
  if (req.method === 'GET' && url.pathname === '/') return dashboard(res);
  if (req.method === 'GET' && url.pathname === '/openapi.json') return send(res, 200, openapi);
  if (req.method === 'GET' && url.pathname === '/api/v1/stream') return stream(req, res);
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  if (url.pathname === '/health') return send(res, 200, { ok: true, service: 'livescore-api', startedAt });
  if (url.pathname === '/api/v1/competitions') return send(res, 200, { data: competitions, meta: { count: competitions.length } });
  if (url.pathname === '/api/v1/sports') return send(res, 200, { data: [...new Set(matches.map(m => m.sport))] });
  if (url.pathname === '/api/v1/leagues') return send(res, 200, { data: [...new Set(matches.map(m => ({ name: m.league, country: m.country }))),].filter((x, i, a) => a.findIndex(y => y.name === x.name) === i) });
  if (url.pathname === '/api/v1/matches') {
    let data = matches;
    if (url.searchParams.get('source') === 'espn' || source === 'espn') {
      try { data = url.searchParams.get('all') === 'true' || !url.searchParams.has('league') ? await getAllEspnMatches() : await getEspnMatches(url.searchParams.get('league') || defaultLeague); }
      catch (error) { return send(res, 502, { error: 'provider_unavailable', message: error.message }); }
    }
    const date = url.searchParams.get('date');
    if (date) { const offset = date === 'yesterday' ? -1 : date === 'tomorrow' ? 1 : 0; const target = dateKey(offset); data = data.filter(m => String(m.kickoff || '').slice(0, 10).replaceAll('-', '') === target); }
    for (const key of ['sport', 'league', 'country', 'status']) if (url.searchParams.has(key)) data = data.filter(m => m[key] === url.searchParams.get(key));
    return send(res, 200, { data, meta: { count: data.length, updatedAt: new Date().toISOString() } });
  }
  const match = url.pathname.match(/^\/api\/v1\/matches\/([^/]+)$/);
  if (match) {
    const item = matches.find(m => m.id === match[1]);
    if (item) return send(res, 200, { data: item });
    if (match[1].startsWith('espn-')) {
      try { const espnItem = await getEspnMatch(match[1].replace('espn-', '')); return espnItem ? send(res, 200, { data: espnItem }) : send(res, 404, { error: 'match_not_found' }); }
      catch (error) { return send(res, 502, { error: 'provider_unavailable', message: error.message }); }
    }
    return send(res, 404, { error: 'match_not_found' });
  }
  return send(res, 404, { error: 'not_found' });
}

http.createServer(route).listen(port, () => console.log(`Livescore running at http://localhost:${port}`));
