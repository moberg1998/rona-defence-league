// Fodbold via API-Sports (v3.football.api-sports.io).
// Fulgte ligaer — udvid frit med flere API-Sports liga-id'er efter behov (find dem via
// GET /leagues?country=... eller /leagues?id=... med samme API-nøgle).
import { TZ, makeApiSportsGet, pickMatchOdds, fixturesForDate } from './shared.mjs';
import { DateTime } from 'luxon';

const BASE = 'https://v3.football.api-sports.io';
const LEAGUES = [
  { id: 119, name: 'Superliga' },
  { id: 39, name: 'Premier League' },
  { id: 40, name: 'Championship' },
  { id: 41, name: 'League One' },
  { id: 42, name: 'League Two' },
  { id: 140, name: 'La Liga' },
  { id: 78, name: 'Bundesliga' },
  { id: 79, name: '2. Bundesliga' },
  { id: 135, name: 'Serie A' },
  { id: 136, name: 'Serie B' },
  { id: 61, name: 'Ligue 1' },
  { id: 62, name: 'Ligue 2' },
  { id: 2, name: 'Champions League' },      // inkl. kvalifikation — API-Sports bruger samme liga-id, kun "round" skifter
  { id: 3, name: 'Europa League' },         // inkl. kvalifikation
  { id: 848, name: 'Conference League' },   // inkl. kvalifikation
  { id: 1, name: 'VM' },
];
// API-Sports' gratis plan har et dagligt loft pr. sport (~100 opslag/dag). Fixtures-opslag er
// billige (2/dag uanset antal fulgte ligaer — det er ÉT globalt opslag pr. dato, filtreret her i
// koden). Det eneste, der vokser med flere ligaer, er odds-opslag (ét pr. relevant kamp), derfor et
// loft her, prioriteret efter hvilke kampe der starter først. Løftet lidt (25→40) efter udvidelsen
// til alle de store europæiske ligaer — 2+40=42 opslag/dag, stadig under halvdelen af kvoten.
const MAX_ODDS_LOOKUPS = 40;

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
  relevant.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));
  console.log(`Fodbold: ${relevant.length} kamp(e) i de fulgte ligaer for ${today}/${tomorrow}.`);

  const out = [];
  let oddsLookups = 0;
  for (const f of relevant) {
    let odds = null;
    if (oddsLookups < MAX_ODDS_LOOKUPS) {
      try {
        const oddsResp = await apiGet(BASE, '/odds', { fixture: f.fixture.id });
        odds = pickMatchOdds(oddsResp, ['Match Winner']);
        oddsLookups++;
      } catch (e) {
        console.warn('Fodbold: odds-opslag fejlede for', f.fixture.id, e.message);
      }
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
  console.log(`Fodbold: hentede odds for ${oddsLookups} af ${out.length} kamp(e) (loft: ${MAX_ODDS_LOOKUPS}).`);
  return out;
}
