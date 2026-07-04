// CS2 (Counter-Strike 2) via OddsPapi (https://oddspapi.io) — ikke API-Sports.
// Bekræftet ved en rigtig kørsel (log delt af Magnus) og opslag i OddsPapis dokumentation:
//  - Base-URL: https://api.oddspapi.io, nøglen sendes som query-parameter "apiKey"
//  - Fixtures: GET /v4/fixtures?sportId=17&from=YYYY-MM-DD&to=YYYY-MM-DD&hasOdds=true (17 = CS2)
//    Fixture-objektet har IKKE holdnavne direkte — kun fixtureId, participant1Id, participant2Id,
//    tournamentId, startTime. Navne slås op separat:
//  - GET /v4/participants?sportId=17 → { "<id>": "Holdnavn", ... } (ét kald, hele sportens deltagere)
//  - GET /v4/tournaments?sportId=17 → array af { tournamentId, tournamentName, ... }
//  - Odds pr. kamp: GET /v4/odds?fixtureId=<id> — dybt indlejret struktur:
//    bookmakerOdds[bookmaker].markets[marketId].outcomes[outcomeId].players[playerId].price.
//    Hvilket marketId der er "kampvinder" fremgår ikke af dokumentationen, så vi gætter forsigtigt
//    (det første 2-udfalds marked) — rammer gættet forbi, vises kampen bare uden odds i appen.
//  - Rate-limits ifølge dokumentationen: participants/tournaments ~1000ms cooldown, odds ~500ms.
import { TZ } from './shared.mjs';
import { DateTime } from 'luxon';

const BASE = 'https://api.oddspapi.io';
const CS2_SPORT_ID = 17;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiGet(apiKey, path, params) {
  const url = new URL(BASE + path);
  url.searchParams.set('apiKey', apiKey);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${path} → HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

function asList(json) {
  if (Array.isArray(json)) return json;
  return json?.data || json?.fixtures || json?.response || json?.results || [];
}

// Leder efter et 2-udfalds "kampvinder"-marked i det indlejrede odds-svar. Se kommentaren øverst —
// det er et forsigtigt gæt, ikke en bekræftet markedstype. Returnerer null hvis intet matcher,
// hvorefter kampen vises i appen uden odds (spilleren taster selv), i stedet for at fejle.
function extractTwoWayOdds(oddsJson) {
  try {
    const bookmakerOdds = oddsJson?.bookmakerOdds || oddsJson?.odds || {};
    for (const bmName of Object.keys(bookmakerOdds)) {
      const markets = bookmakerOdds[bmName]?.markets || {};
      for (const marketId of Object.keys(markets)) {
        const outcomes = markets[marketId]?.outcomes || {};
        const outcomeIds = Object.keys(outcomes);
        if (outcomeIds.length !== 2) continue;
        const priceOf = oid => {
          const players = outcomes[oid]?.players || {};
          const first = Object.values(players)[0];
          return first?.price != null ? parseFloat(first.price) : null;
        };
        const home = priceOf(outcomeIds[0]), away = priceOf(outcomeIds[1]);
        if (home != null && away != null) return { home, draw: null, away };
      }
    }
  } catch (e) {
    console.warn('CS2: kunne ikke tolke odds-svaret:', e.message);
  }
  return null;
}

export async function fetchCS2(apiKey) {
  if (!apiKey) throw new Error('Mangler ODDSPAPI_KEY.');

  const today = DateTime.now().setZone(TZ).toFormat('yyyy-MM-dd');
  const weekAhead = DateTime.now().setZone(TZ).plus({ days: 7 }).toFormat('yyyy-MM-dd');

  const fixturesJson = await apiGet(apiKey, '/v4/fixtures', { sportId: CS2_SPORT_ID, from: today, to: weekAhead, hasOdds: true });
  const fixtures = asList(fixturesJson);
  console.log(`CS2: ${fixtures.length} kamp(e) fundet (${today} → ${weekAhead}).`);
  if (!fixtures.length) return [];

  await sleep(1100);
  const participantsMap = await apiGet(apiKey, '/v4/participants', { sportId: CS2_SPORT_ID });

  await sleep(1100);
  const tournamentsList = asList(await apiGet(apiKey, '/v4/tournaments', { sportId: CS2_SPORT_ID }));
  const tournamentName = id => tournamentsList.find(t => t.tournamentId === id)?.tournamentName;

  const out = [];
  for (const fx of fixtures) {
    const id = fx.fixtureId || fx.id;
    const home = participantsMap?.[fx.participant1Id] || fx.home?.name;
    const away = participantsMap?.[fx.participant2Id] || fx.away?.name;
    const date = fx.startTime || fx.date || fx.commenceTime;
    const league = tournamentName(fx.tournamentId) || fx.tournament?.name || 'CS2';
    if (!id || !home || !away || !date) {
      console.warn('CS2: sprang en kamp over (mangler felt):', JSON.stringify(fx).slice(0, 300));
      continue;
    }

    let odds = null;
    try {
      await sleep(600);
      const oddsJson = await apiGet(apiKey, '/v4/odds', { fixtureId: id });
      odds = extractTwoWayOdds(oddsJson);
      if (!odds) console.warn('CS2: intet genkendeligt odds-marked for', id, '— rå svar:', JSON.stringify(oddsJson).slice(0, 500));
    } catch (e) {
      console.warn('CS2: odds-opslag fejlede for', id, e.message);
    }

    out.push({ id: 'c' + id, date, league: { id: CS2_SPORT_ID, name: league }, home, away, odds });
  }
  return out;
}
