// Håndbold via API-Sports (v1.handball.api-sports.io).
// Bemærk forskelle fra fodbold-modulet: ressourcen hedder /games (ikke /fixtures), kamp-objektet
// er fladt (g.id, g.date, g.league, g.teams — ikke g.fixture.*), og odds-opslag pr. kamp bruger
// parameteren "game" (ikke "fixture").
// Fulgte ligaer — udvid frit (find liga-id'er via /leagues?country=... med samme nøgle).
import { makeApiSportsGet, pickMatchOdds, fixturesForNextDays, isWeekendSlot } from './shared.mjs';

const BASE = 'https://v1.handball.api-sports.io';
const LEAGUES = [
  { id: 23, name: 'Herre Handbold Ligaen' },   // Danmark
  { id: 39, name: 'Bundesliga' },              // Tyskland
  { id: 43, name: '2. Bundesliga' },           // Tyskland
  { id: 34, name: 'Starligue' },               // Frankrig
  { id: 103, name: 'Liga ASOBAL' },            // Spanien
  { id: 131, name: 'Champions League' },
  { id: 145, name: 'EHF European League' },
  { id: 177, name: 'European Championship' },
  { id: 153, name: 'World Championship' },
  { id: 75, name: 'REMA 1000-ligaen' },  // Norge — bekræftet via find-league-ids.mjs
  { id: 113, name: 'Handbollsligan' },   // Sverige — bekræftet via find-league-ids.mjs
];
const FETCH_DAYS = 3; // gratis-planen tillader kun i dag+2 dage — bekræftet, se football.mjs
const MAX_ODDS_LOOKUPS = 25; // API-Sports gratis-plan: ~100 opslag/dag pr. sport — se football.mjs

export async function fetchHandball(apiKey) {
  const apiGet = makeApiSportsGet(apiKey);
  const leagueIds = new Set(LEAGUES.map(l => l.id));
  const leagueName = id => LEAGUES.find(l => l.id === id)?.name || String(id);

  const res = await fixturesForNextDays(apiGet, BASE, '/games', FETCH_DAYS, 'Håndbold');
  if (!res.ok) throw new Error(`Håndbold: kunne ikke hente nogen af de næste ${FETCH_DAYS} dage.`);

  const relevant = res.data.filter(g => leagueIds.has(g.league.id) && isWeekendSlot(g.date));
  relevant.sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log(`Håndbold: ${relevant.length} kamp(e) i de fulgte ligaer, lør. 12-søn. de næste ${FETCH_DAYS} dage.`);

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
        console.warn('Håndbold: odds-opslag fejlede for', g.id, e.message);
      }
    }
    out.push({
      id: 'h' + g.id,
      date: g.date,
      league: { id: g.league.id, name: leagueName(g.league.id) },
      home: g.teams.home.name,
      away: g.teams.away.name,
      odds, // ofte null for mindre ligaer — appen viser kampen og lader dig taste odds selv
    });
  }
  console.log(`Håndbold: hentede odds for ${oddsLookups} af ${out.length} kamp(e) (loft: ${MAX_ODDS_LOOKUPS}).`);
  return out;
}
