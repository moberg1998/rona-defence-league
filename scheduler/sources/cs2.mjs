// CS2 (Counter-Strike 2) via OddsPapi (https://oddspapi.io) — ikke API-Sports.
// VIGTIGT: denne kilde er mindre efterprøvet end de andre (fodbold/håndbold/basket/ishockey),
// fordi ODDSPAPI_KEY kun findes som GitHub-secret og ikke er testet direkte af Claude undervejs
// (i modsætning til API-Sports, hvor nøglen blev delt midlertidigt til research). Baseret på
// OddsPapis offentlige dokumentation (oddspapi.io/en/docs):
//  - Base-URL: https://api.oddspapi.io
//  - Nøglen sendes som query-parameter "apiKey" (ikke en header)
//  - Fixtures: GET /v4/fixtures?sportId=17&from=YYYY-MM-DD&to=YYYY-MM-DD&hasOdds=true (17 = CS2)
//  - Odds pr. kamp: GET /v4/odds?fixtureId=<id>
// Den præcise form af odds-svaret er ikke bekræftet — parseren herunder er bevidst defensiv:
// findes der intet genkendeligt 2-vejs kampvinder-marked, logges det rå svar (til fejlsøgning),
// og kampen vises i appen UDEN odds i stedet for at fejle (samme fallback som de andre sportsgrene).
import { TZ } from './shared.mjs';
import { DateTime } from 'luxon';

const BASE = 'https://api.oddspapi.io';
const CS2_SPORT_ID = 17;

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

// Leder efter et 2-vejs (evt. 3-vejs) kampvinder-marked i et ukendt odds-svar, uden at
// kende den præcise struktur på forhånd. Returnerer null i stedet for at fejle, hvis intet findes.
function extractTwoWayOdds(oddsJson) {
  try {
    const markets = asList(oddsJson.markets || oddsJson.odds || oddsJson);
    for (const m of markets) {
      const name = (m.name || m.market || '').toLowerCase();
      const outcomes = m.outcomes || m.selections || m.prices || [];
      if (!outcomes.length) continue;
      const looksLikeWinner = /winner|moneyline|match.?winner|1x2|home.?away/.test(name) || outcomes.length === 2;
      if (!looksLikeWinner) continue;
      const priceOf = idx => {
        const o = outcomes[idx];
        const p = o?.price ?? o?.odds ?? o?.decimal ?? o?.value;
        return p != null ? parseFloat(p) : null;
      };
      if (outcomes.length === 2) {
        const home = priceOf(0), away = priceOf(1);
        if (home != null && away != null) return { home, draw: null, away };
      } else if (outcomes.length === 3) {
        const home = priceOf(0), draw = priceOf(1), away = priceOf(2);
        if (home != null && away != null) return { home, draw, away };
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

  const out = [];
  for (const fx of fixtures) {
    const id = fx.id || fx.fixtureId;
    const home = fx.home?.name || fx.homeTeam?.name || fx.participants?.[0]?.name;
    const away = fx.away?.name || fx.awayTeam?.name || fx.participants?.[1]?.name;
    const date = fx.startDate || fx.date || fx.commenceTime;
    const league = fx.tournament?.name || fx.league?.name || 'CS2';
    if (!id || !home || !away || !date) {
      console.warn('CS2: sprang en kamp over (ukendt felt-struktur):', JSON.stringify(fx).slice(0, 300));
      continue;
    }

    let odds = null;
    try {
      const oddsJson = await apiGet(apiKey, '/v4/odds', { fixtureId: id });
      odds = extractTwoWayOdds(oddsJson);
      if (!odds) console.warn('CS2: intet genkendeligt odds-marked for', id, '— rå svar:', JSON.stringify(oddsJson).slice(0, 400));
    } catch (e) {
      console.warn('CS2: odds-opslag fejlede for', id, e.message);
    }

    out.push({ id: 'c' + id, date, league: { id: CS2_SPORT_ID, name: league }, home, away, odds });
  }
  return out;
}
