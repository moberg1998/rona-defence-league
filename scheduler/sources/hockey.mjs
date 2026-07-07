// Ishockey via API-Sports (v1.hockey.api-sports.io).
// Samme flade kamp-struktur og "game"-parameter til odds som håndbold-/basketball-modulerne.
// Fulgte ligaer — udvid frit (find liga-id'er via /leagues?search=... med samme nøgle).
import { makeApiSportsGet, pickMatchOdds, fixturesForNextDays, isWeekendSlot } from './shared.mjs';

const BASE = 'https://v1.hockey.api-sports.io';
const LEAGUES = [
  { id: 57, name: 'NHL' },
  { id: 12, name: 'Metal Ligaen' },
  { id: 111, name: 'World Championship' },
];
const FETCH_DAYS = 3; // gratis-planen tillader kun i dag+2 dage — bekræftet, se football.mjs
const MAX_ODDS_LOOKUPS = 25; // API-Sports gratis-plan: ~100 opslag/dag pr. sport — se football.mjs

export async function fetchHockey(apiKey) {
  const apiGet = makeApiSportsGet(apiKey);
  const leagueIds = new Set(LEAGUES.map(l => l.id));
  const leagueName = id => LEAGUES.find(l => l.id === id)?.name || String(id);

  const res = await fixturesForNextDays(apiGet, BASE, '/games', FETCH_DAYS, 'Ishockey');
  if (!res.ok) throw new Error(`Ishockey: kunne ikke hente nogen af de næste ${FETCH_DAYS} dage.`);

  const relevant = res.data.filter(g => leagueIds.has(g.league.id) && isWeekendSlot(g.date));
  relevant.sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log(`Ishockey: ${relevant.length} kamp(e) i de fulgte ligaer, lør. 12-søn. de næste ${FETCH_DAYS} dage.`);

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
