// Ishockey via API-Sports (v1.hockey.api-sports.io).
// Samme flade kamp-struktur og "game"-parameter til odds som håndbold-/basketball-modulerne.
// Fulgte ligaer — udvid frit (find liga-id'er via /leagues?search=... med samme nøgle).
import { TZ, makeApiSportsGet, pickMatchOdds, fixturesForDate } from './shared.mjs';
import { DateTime } from 'luxon';

const BASE = 'https://v1.hockey.api-sports.io';
const LEAGUES = [
  { id: 57, name: 'NHL' },
  { id: 12, name: 'Metal Ligaen' },
  { id: 111, name: 'World Championship' },
];
const MAX_ODDS_LOOKUPS = 25; // API-Sports gratis-plan: ~100 opslag/dag pr. sport — se football.mjs

export async function fetchHockey(apiKey) {
  const apiGet = makeApiSportsGet(apiKey);
  const leagueIds = new Set(LEAGUES.map(l => l.id));
  const leagueName = id => LEAGUES.find(l => l.id === id)?.name || String(id);

  const today = DateTime.now().setZone(TZ).toFormat('yyyy-MM-dd');
  const tomorrow = DateTime.now().setZone(TZ).plus({ days: 1 }).toFormat('yyyy-MM-dd');

  const [resToday, resTomorrow] = await Promise.all([
    fixturesForDate(apiGet, BASE, '/games', today, 'Ishockey'),
    fixturesForDate(apiGet, BASE, '/games', tomorrow, 'Ishockey'),
  ]);
  if (!resToday.ok && !resTomorrow.ok) throw new Error(`Ishockey: kunne hverken hente ${today} eller ${tomorrow}.`);

  const relevant = [...resToday.data, ...resTomorrow.data].filter(g => leagueIds.has(g.league.id));
  relevant.sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log(`Ishockey: ${relevant.length} kamp(e) i de fulgte ligaer for ${today}/${tomorrow}.`);

  const out = [];
  let oddsLookups = 0;
  for (const g of relevant) {
    let odds = null;
    if (oddsLookups < MAX_ODDS_LOOKUPS) {
      try {
        const oddsResp = await apiGet(BASE, '/odds', { game: g.id });
        odds = pickMatchOdds(oddsResp, ['Match Winner', 'Home/Away']);
        oddsLookups++;
      } catch (e) {
        console.warn('Ishockey: odds-opslag fejlede for', g.id, e.message);
      }
    }
    out.push({
      id: 'i' + g.id,
      date: g.date,
      league: { id: g.league.id, name: leagueName(g.league.id) },
      home: g.teams.home.name,
      away: g.teams.away.name,
      odds, // Metal Ligaen har typisk ingen bookmaker-odds — vises så uden, og du taster selv
    });
  }
  console.log(`Ishockey: hentede odds for ${oddsLookups} af ${out.length} kamp(e) (loft: ${MAX_ODDS_LOOKUPS}).`);
  return out;
}
