// Håndbold via API-Sports (v1.handball.api-sports.io).
// Bemærk forskelle fra fodbold-modulet: ressourcen hedder /games (ikke /fixtures), kamp-objektet
// er fladt (g.id, g.date, g.league, g.teams — ikke g.fixture.*), og odds-opslag pr. kamp bruger
// parameteren "game" (ikke "fixture").
// Fulgte ligaer — udvid frit (find liga-id'er via /leagues?country=... med samme nøgle).
import { TZ, makeApiSportsGet, pickMatchOdds, fixturesForDate } from './shared.mjs';
import { DateTime } from 'luxon';

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
];

export async function fetchHandball(apiKey) {
  const apiGet = makeApiSportsGet(apiKey);
  const leagueIds = new Set(LEAGUES.map(l => l.id));
  const leagueName = id => LEAGUES.find(l => l.id === id)?.name || String(id);

  const today = DateTime.now().setZone(TZ).toFormat('yyyy-MM-dd');
  const tomorrow = DateTime.now().setZone(TZ).plus({ days: 1 }).toFormat('yyyy-MM-dd');

  const [resToday, resTomorrow] = await Promise.all([
    fixturesForDate(apiGet, BASE, '/games', today, 'Håndbold'),
    fixturesForDate(apiGet, BASE, '/games', tomorrow, 'Håndbold'),
  ]);
  if (!resToday.ok && !resTomorrow.ok) throw new Error(`Håndbold: kunne hverken hente ${today} eller ${tomorrow}.`);

  const relevant = [...resToday.data, ...resTomorrow.data].filter(g => leagueIds.has(g.league.id));
  console.log(`Håndbold: ${relevant.length} kamp(e) i de fulgte ligaer for ${today}/${tomorrow}.`);

  const out = [];
  for (const g of relevant) {
    let odds = null;
    try {
      const oddsResp = await apiGet(BASE, '/odds', { game: g.id });
      odds = pickMatchOdds(oddsResp, ['Match Winner', 'Home/Away']);
    } catch (e) {
      console.warn('Håndbold: odds-opslag fejlede for', g.id, e.message);
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
  return out;
}
