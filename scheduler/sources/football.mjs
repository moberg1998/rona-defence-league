// Fodbold via API-Sports (v3.football.api-sports.io).
// Fulgte ligaer — udvid frit med flere API-Sports liga-id'er efter behov (find dem via
// GET /leagues?country=... eller /leagues?id=... med samme API-nøgle).
import { TZ, makeApiSportsGet, pickMatchOdds, fixturesForDate } from './shared.mjs';
import { DateTime } from 'luxon';

const BASE = 'https://v3.football.api-sports.io';
const LEAGUES = [
  { id: 119, name: 'Superliga' },
  { id: 39, name: 'Premier League' },
  { id: 140, name: 'La Liga' },
  { id: 2, name: 'Champions League' },
  { id: 1, name: 'VM' },
];

export async function fetchFootball(apiKey) {
  const apiGet = makeApiSportsGet(apiKey);
  const leagueIds = new Set(LEAGUES.map(l => l.id));
  const leagueName = id => LEAGUES.find(l => l.id === id)?.name || String(id);

  const today = DateTime.now().setZone(TZ).toFormat('yyyy-MM-dd');
  const tomorrow = DateTime.now().setZone(TZ).plus({ days: 1 }).toFormat('yyyy-MM-dd');

  const [resToday, resTomorrow] = await Promise.all([
    fixturesForDate(apiGet, BASE, '/fixtures', today, 'Fodbold'),
    fixturesForDate(apiGet, BASE, '/fixtures', tomorrow, 'Fodbold'),
  ]);
  if (!resToday.ok && !resTomorrow.ok) throw new Error(`Fodbold: kunne hverken hente ${today} eller ${tomorrow}.`);

  const relevant = [...resToday.data, ...resTomorrow.data].filter(f => leagueIds.has(f.league.id));
  console.log(`Fodbold: ${relevant.length} kamp(e) i de fulgte ligaer for ${today}/${tomorrow}.`);

  const out = [];
  for (const f of relevant) {
    let odds = null;
    try {
      const oddsResp = await apiGet(BASE, '/odds', { fixture: f.fixture.id });
      odds = pickMatchOdds(oddsResp, ['Match Winner']);
    } catch (e) {
      console.warn('Fodbold: odds-opslag fejlede for', f.fixture.id, e.message);
    }
    out.push({
      id: 'f' + f.fixture.id,
      date: f.fixture.date,
      league: { id: f.league.id, name: leagueName(f.league.id) },
      home: f.teams.home.name,
      away: f.teams.away.name,
      odds, // kan være null — appen viser så kampen uden auto-udfyldte odds
    });
  }
  return out;
}
