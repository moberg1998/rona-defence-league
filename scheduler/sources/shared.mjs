// Delte hjælpefunktioner for alle kamp-kilder (API-Sports pr. sportsgren, senere evt. OddsPapi for CS2).
// Hver kilde-fil under scheduler/sources/ er et selvstændigt modul, der eksporterer én
// async funktion (fx fetchFootball(apiKey)) — tilføj/fjern en sportsgren ved kun at
// røre ved dens egen fil + de to steder i fetch-fixtures.mjs, der lister kilderne.
import { DateTime } from 'luxon';

export const TZ = 'Europe/Copenhagen';
export const PREFERRED_BOOKMAKERS = ['Bet365', '10Bet', 'Unibet'];

// API-Sports' gratis plan tillader kun ca. 10 opslag i minuttet (opdaget ved en rigtig kørsel,
// hvor Basketballs mange odds-opslag ramte "Too many requests"). Vi holder mindst 6,5 sek. mellem
// hvert kald til samme bas-URL (sport), med god margin, i stedet for at gætte på et helt konkret tal.
const lastCallAt = new Map();
const MIN_INTERVAL_MS = 6500;
async function throttle(base) {
  const last = lastCallAt.get(base) || 0;
  const wait = last + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCallAt.set(base, Date.now());
}

// Laver en apiGet-funktion bundet til én bestemt API-nøgle/header — genbruges af hver API-Sports-kilde.
export function makeApiSportsGet(apiKey) {
  return async function apiGet(base, path, params) {
    await throttle(base);
    const url = new URL(base + path);
    Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
    const json = await res.json();
    if (json.errors && Object.keys(json.errors).length) {
      throw new Error(`${path} ${JSON.stringify(params)} → ${JSON.stringify(json.errors)}`);
    }
    return json.response || [];
  };
}

// Henter kampe for én dato ad gangen. Fejler datoen (fx afvist datovindue på gratis-planen),
// vælter det ikke resten af kørslen — den dato springes bare over.
export async function fixturesForDate(apiGet, base, resource, date, label) {
  try {
    return { ok: true, data: await apiGet(base, resource, { date }) };
  } catch (e) {
    console.warn(`${label} ${resource}?date=${date} fejlede (springer over): ${e.message}`);
    return { ok: false, data: [] };
  }
}

// Henter kampe for de næste `days` dage (i dag + days-1 frem), så en hel weekend er synlig
// nogle dage i forvejen — ikke kun "i dag/i morgen". Runderne spilles i weekenden, så folk skal
// kunne se BÅDE lørdags- og søndagskampe et par dage før. Hver dato fejler uafhængigt af de andre
// (se fixturesForDate) — rammer gratis-planens datovindue et loft et sted i midten af ugen, falder
// den bare tilbage til færre dage i stedet for at vælte hele kørslen.
export async function fixturesForNextDays(apiGet, base, resource, days, label) {
  const dates = Array.from({ length: days }, (_, i) => DateTime.now().setZone(TZ).plus({ days: i }).toFormat('yyyy-MM-dd'));
  const results = await Promise.all(dates.map(d => fixturesForDate(apiGet, base, resource, d, label)));
  return { ok: results.some(r => r.ok), data: results.flatMap(r => r.data) };
}

// Runderne spilles kun lørdag eftermiddag/aften til søndag aften — kampe midt i ugen er irrelevante
// for jeres kuponer, uanset hvor mange dage frem vi henter. Filtrerer til kun lørdag fra kl. 12
// og hele søndagen (dansk tid), så listen i appen ikke drukner i ligegyldige hverdagskampe.
export function isWeekendSlot(isoDate) {
  const d = DateTime.fromISO(isoDate, { zone: 'utc' }).setZone(TZ);
  if (!d.isValid) return false;
  if (d.weekday === 6) return d.hour >= 12; // lørdag
  if (d.weekday === 7) return true;         // hele søndagen
  return false;
}

// Finder et "hvem vinder"-marked (2- eller 3-vejs) blandt de foretrukne bookmakere.
// betNames prøves i rækkefølge, da forskellige sportsgrene navngiver markedet forskelligt.
// Returnerer null hvis der slet ikke er odds endnu — klienten viser så kampen UDEN odds,
// og lader spilleren taste odds selv (samme fallback som fuld manuel indtastning).
export function pickMatchOdds(oddsResponse, betNames) {
  if (!oddsResponse.length) return null;
  const bookmakers = oddsResponse[0].bookmakers || [];
  const byName = name => bookmakers.find(b => b.name === name);
  const bm = PREFERRED_BOOKMAKERS.map(byName).find(Boolean) || bookmakers[0];
  if (!bm) return null;
  const bet = betNames.map(n => bm.bets.find(b => b.name === n)).find(Boolean);
  if (!bet) return null;
  const val = v => { const f = bet.values.find(x => x.value === v); return f ? parseFloat(f.odd) : null; };
  const home = val('Home'), away = val('Away'), draw = val('Draw');
  if (home == null || away == null) return null; // skal mindst have hjemme + ude for at være brugbart
  return { home, draw, away };
}
