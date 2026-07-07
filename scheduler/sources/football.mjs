// Fodbold via API-Sports (v3.football.api-sports.io).
// Fulgte ligaer — udvid frit med flere API-Sports liga-id'er efter behov (find dem via
// GET /leagues?country=... eller /leagues?id=... med samme API-nøgle).
import { makeApiSportsGet, pickMatchOdds, fixturesForNextDays } from './shared.mjs';

const BASE = 'https://v3.football.api-sports.io';
const LEAGUES = [
  { id: 119, name: 'Superliga' },
  { id: 39, name: 'Premier League' },
  { id: 40, name: 'Championship' },
  { id: 41, name: 'League One' },
  { id: 42, name: 'League Two' },
  { id: 140, name: 'La Liga' },
  { id: 141, name: 'Segunda División' },
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
  // Bekræftede via find-league-ids.mjs (id'er slået op mod det rigtige API-Sports-endpoint, ikke gættet):
  { id: 88, name: 'Eredivisie' },           // Holland
  { id: 89, name: 'Eerste Divisie' },       // Holland, 2. niveau
  { id: 94, name: 'Primeira Liga' },        // Portugal
  { id: 95, name: 'Segunda Liga' },         // Portugal, 2. niveau
  { id: 144, name: 'Jupiler Pro League' },  // Belgien
  { id: 203, name: 'Süper Lig' },           // Tyrkiet
  { id: 235, name: 'Premier League (Rusland)' },
  { id: 333, name: 'Premier League (Ukraine)' },
  { id: 179, name: 'Premiership' },         // Skotland
  { id: 218, name: 'Bundesliga (Østrig)' },
  { id: 207, name: 'Super League' },        // Schweiz
  { id: 197, name: 'Super League 1' },      // Grækenland
  { id: 103, name: 'Eliteserien' },         // Norge
  { id: 113, name: 'Allsvenskan' },         // Sverige
  { id: 71, name: 'Série A' },              // Brasilien
  { id: 128, name: 'Liga Profesional' },    // Argentina
  { id: 262, name: 'Liga MX' },             // Mexico
  { id: 98, name: 'J1 League' },            // Japan
  { id: 292, name: 'K League 1' },          // Sydkorea
  { id: 307, name: 'Pro League' },          // Saudi-Arabien
  { id: 169, name: 'Super League' },        // Kina
  { id: 188, name: 'A-League' },            // Australien
  { id: 106, name: 'Ekstraklasa' },         // Polen
  { id: 210, name: 'HNL' },                 // Kroatien
  { id: 286, name: 'Super Liga' },          // Serbien
  { id: 283, name: 'Liga I' },              // Rumænien
  { id: 253, name: 'Major League Soccer' }, // USA/Canada
  { id: 345, name: 'Czech Liga' },          // Tjekkiet
];
// Runderne spilles i weekenden — hent 5 dage frem (i dag + 4), så BÅDE lørdags- og søndagskampe
// er synlige nogle dage i forvejen, ikke kun "i dag/i morgen". Rammer gratis-planens datovindue et
// loft midt i ugen, falder de yderste dage bare væk uden at vælte kørslen (se fixturesForNextDays).
const FETCH_DAYS = 5;
// API-Sports' gratis plan har et dagligt loft pr. sport (~100 opslag/dag). Fixtures-opslag er
// billige (5/dag uanset antal fulgte ligaer — det er ÉT globalt opslag pr. dato, filtreret her i
// koden). Det eneste, der vokser med flere ligaer, er odds-opslag (ét pr. relevant kamp), derfor et
// loft her, prioriteret efter hvilke kampe der starter først. 5+40=45 opslag/dag, stadig under
// halvdelen af kvoten.
const MAX_ODDS_LOOKUPS = 40;
// Når flere ligaer følges end odds-loftet rækker til, får disse top-ligaer FØRSTE ret til
// auto-odds (uanset kickoff-tid) — resten af loftet går til de øvrige ligaers tidligste kampe.
// Udvid listen, når flere store ligaer (Brasilien, Eredivisie osv.) får bekræftede id'er.
const ODDS_PRIORITY_IDS = new Set([39, 140, 78, 135, 61, 2, 119]); // PL, La Liga, Bundesliga, Serie A, Ligue 1, CL, Superliga

export async function fetchFootball(apiKey) {
  const apiGet = makeApiSportsGet(apiKey);
  const leagueIds = new Set(LEAGUES.map(l => l.id));
  const leagueName = id => LEAGUES.find(l => l.id === id)?.name || String(id);

  const res = await fixturesForNextDays(apiGet, BASE, '/fixtures', FETCH_DAYS, 'Fodbold');
  if (!res.ok) throw new Error(`Fodbold: kunne ikke hente nogen af de næste ${FETCH_DAYS} dage.`);

  const relevant = res.data.filter(f => leagueIds.has(f.league.id));
  // Sortér listen der VISES efter kickoff (uændret) — men lav en separat prioriteret rækkefølge
  // til odds-opslagene, så top-ligaerne altid får odds først, selvom en lavere liga spiller tidligere.
  relevant.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));
  const byOddsPriority = [...relevant].sort((a, b) => {
    const pa = ODDS_PRIORITY_IDS.has(a.league.id) ? 0 : 1;
    const pb = ODDS_PRIORITY_IDS.has(b.league.id) ? 0 : 1;
    return pa !== pb ? pa - pb : new Date(a.fixture.date) - new Date(b.fixture.date);
  });
  const oddsFixtureIds = new Set(byOddsPriority.slice(0, MAX_ODDS_LOOKUPS).map(f => f.fixture.id));
  console.log(`Fodbold: ${relevant.length} kamp(e) i de fulgte ligaer de næste ${FETCH_DAYS} dage.`);

  const out = [];
  let oddsLookups = 0;
  for (const f of relevant) {
    let odds = null;
    if (oddsFixtureIds.has(f.fixture.id)) {
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
