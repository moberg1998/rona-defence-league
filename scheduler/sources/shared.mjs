// Delte hjælpefunktioner for alle kamp-kilder (API-Sports pr. sportsgren, senere evt. OddsPapi for CS2).
// Hver kilde-fil under scheduler/sources/ er et selvstændigt modul, der eksporterer én
// async funktion (fx fetchFootball(apiKey)) — tilføj/fjern en sportsgren ved kun at
// røre ved dens egen fil + de to steder i fetch-fixtures.mjs, der lister kilderne.
export const TZ = 'Europe/Copenhagen';
export const PREFERRED_BOOKMAKERS = ['Bet365', '10Bet', 'Unibet'];

// Laver en apiGet-funktion bundet til én bestemt API-nøgle/header — genbruges af hver API-Sports-kilde.
export function makeApiSportsGet(apiKey) {
  return async function apiGet(base, path, params) {
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
