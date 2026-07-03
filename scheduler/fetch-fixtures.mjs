// Kører én gang dagligt (tidlig morgen, dansk tid) via .github/workflows/fetch-fixtures.yml.
// Henter rigtige, kommende kampe + 1X2-odds fra API-Sports (kun fodbold i denne omgang) og
// gemmer dem i Firestore, så appens klient aldrig selv skal kende API-nøglen eller kalde API-Sports.
//
// Gratis-planens begrænsninger (bekræftet ved research):
//  - "next"-parameteren findes ikke på gratis planen.
//  - league+season er låst til gamle sæsoner (2022-2024) på gratis planen.
//  - MEN: /fixtures?date=YYYY-MM-DD uden liga/sæson virker fint med aktuelle data,
//    begrænset til et rullende 3-dages vindue (i går/i dag/i morgen).
//  - /odds?fixture=<id> (pr. kamp) virker upåvirket og giver bl.a. "Match Winner" (=1X2).
// Klubbens runder kører kun i weekenden, så "i dag + i morgen" er præcis det, der er brug for,
// når robotten kører lørdag morgen.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { DateTime } from 'luxon';

const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT;
const apiKey = process.env.API_SPORTS_KEY;
if (!svcJson) { console.error('Mangler FIREBASE_SERVICE_ACCOUNT secret.'); process.exit(1); }
if (!apiKey) { console.error('Mangler API_SPORTS_KEY secret.'); process.exit(1); }

initializeApp({ credential: cert(JSON.parse(svcJson)) });
const db = getFirestore();
const CLUB = db.collection('clubs').doc('rona');
const TZ = 'Europe/Copenhagen';

// Fulgte fodboldligaer — udvid frit med flere API-Sports liga-id'er efter behov.
const FOOTBALL_LEAGUES = [
  { id: 119, name: 'Superliga' },
  { id: 39, name: 'Premier League' },
  { id: 140, name: 'La Liga' },
  { id: 2, name: 'Champions League' },
  { id: 1, name: 'VM' },
];
const PREFERRED_BOOKMAKERS = ['Bet365', '10Bet', 'Unibet'];

async function apiGet(base, path, params) {
  const url = new URL(base + path);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) {
    throw new Error(`${path} ${JSON.stringify(params)} → ${JSON.stringify(json.errors)}`);
  }
  return json.response || [];
}

function pickMatchWinnerOdds(oddsResponse) {
  if (!oddsResponse.length) return null;
  const bookmakers = oddsResponse[0].bookmakers || [];
  const byName = name => bookmakers.find(b => b.name === name);
  const bm = PREFERRED_BOOKMAKERS.map(byName).find(Boolean) || bookmakers[0];
  if (!bm) return null;
  const bet = bm.bets.find(b => b.name === 'Match Winner');
  if (!bet) return null;
  const val = v => { const f = bet.values.find(x => x.value === v); return f ? parseFloat(f.odd) : null; };
  const odds = { home: val('Home'), draw: val('Draw'), away: val('Away') };
  if (odds.home == null || odds.draw == null || odds.away == null) return null;
  return odds;
}

async function fetchFootball() {
  const FOOTBALL_BASE = 'https://v3.football.api-sports.io';
  const leagueIds = new Set(FOOTBALL_LEAGUES.map(l => l.id));
  const leagueName = id => FOOTBALL_LEAGUES.find(l => l.id === id)?.name || String(id);

  const today = DateTime.now().setZone(TZ).toFormat('yyyy-MM-dd');
  const tomorrow = DateTime.now().setZone(TZ).plus({ days: 1 }).toFormat('yyyy-MM-dd');

  const [fixturesToday, fixturesTomorrow] = await Promise.all([
    apiGet(FOOTBALL_BASE, '/fixtures', { date: today }),
    apiGet(FOOTBALL_BASE, '/fixtures', { date: tomorrow }),
  ]);

  const relevant = [...fixturesToday, ...fixturesTomorrow].filter(f => leagueIds.has(f.league.id));
  console.log(`Fodbold: ${relevant.length} kamp(e) fundet i de fulgte ligaer for ${today}/${tomorrow}.`);

  const out = [];
  for (const f of relevant) {
    let odds = null;
    try {
      const oddsResp = await apiGet(FOOTBALL_BASE, '/odds', { fixture: f.fixture.id });
      odds = pickMatchWinnerOdds(oddsResp);
    } catch (e) {
      console.error('Odds-opslag fejlede for', f.fixture.id, e.message);
    }
    if (!odds) continue; // ingen odds endnu (fx for langt ude, eller ingen bookmaker-data) — springes over
    out.push({
      id: 'f' + f.fixture.id,
      date: f.fixture.date,
      league: { id: f.league.id, name: leagueName(f.league.id) },
      home: f.teams.home.name,
      away: f.teams.away.name,
      odds,
    });
  }
  return out;
}

async function main() {
  const football = await fetchFootball();
  await CLUB.collection('state').doc('fixturesLive').set({
    updatedAt: Date.now(),
    football,
  });
  console.log(`Gemt ${football.length} fodboldkamp(e) med odds i Firestore.`);
}

main().catch(e => {
  // Fejler kaldet, rører vi IKKE ved Firestore — gårsdagens cache bliver stående (intet datatab).
  console.error('Kunne ikke opdatere fixturesLive:', e.message);
  process.exit(1);
});
