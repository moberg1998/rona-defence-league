// Delt hjælpekode for alle OddsPapi-kilder (CS2, Tennis, …). OddsPapis gratis plan har et
// stramt MÅNEDLIGT loft (~250 opslag/md i alt for hele kontoen — delt mellem ALLE sportsgrene,
// ikke pr. sport som hos API-Sports). Derfor:
//  - Navne (deltagere/turneringer) caches i Firestore og genhentes kun sjældent (se getCachedMap).
//  - Odds hentes KUN for et begrænset antal kampe pr. køre (se capOddsLookups i hver kilde-fil),
//    prioriteret efter hvilke kampe der starter først. Resten af kampene vises stadig i appen,
//    bare uden auto-udfyldte odds — spilleren taster selv, ligesom den almindelige fallback.
const BASE = 'https://api.oddspapi.io';

export async function oddsPapiGet(apiKey, path, params) {
  const url = new URL(BASE + path);
  url.searchParams.set('apiKey', apiKey);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

export function asList(json) {
  if (Array.isArray(json)) return json;
  return json?.data || json?.fixtures || json?.response || json?.results || [];
}

// Turneringslisten fra OddsPapi indeholder mange felter (slug, kategori, kampantal osv.) for
// ALLE turneringer i sporten (fx tusindvis for tennis: ATP/WTA/Challenger/ITF/juniorer verden
// over). Vi bruger kun id+navn, så vi beskærer til det før caching — ellers kan den samlede
// JSON blive for stor til ét Firestore-dokument.
export function slimTournaments(list) {
  return (list || []).map(t => ({ tournamentId: t.tournamentId, tournamentName: t.tournamentName }));
}

// Cacher et vilkårligt opslag (fx deltagere eller turneringer for én sport) i Firestore,
// og genbruger cachen i op til maxAgeDays i stedet for at spørge OddsPapi hver dag.
// Værdien gemmes som en JSON-STRENG (ikke et Firestore-map/array) — Tennis alene har tusindvis
// af spillere, og Firestore indekserer hver nøgle i et map automatisk, hvilket ramte fejlen
// "too many index entries". En streng tæller kun som ét indeks-felt, uanset indhold.
export async function getCached(cacheRef, key, maxAgeDays, fetcher) {
  const snap = await cacheRef.get();
  const data = snap.exists ? snap.data() : {};
  const entry = data[key];
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  if (entry && Date.now() - entry.updatedAt < maxAgeMs) {
    try { return JSON.parse(entry.json); }
    catch (e) { /* ældre cache-format fra før denne rettelse — falder igennem og henter frisk */ }
  }
  const value = await fetcher();
  try {
    await cacheRef.set({ [key]: { json: JSON.stringify(value), updatedAt: Date.now() } }, { merge: true });
  } catch (e) {
    // Kunne ikke caches (fx for stort til ét Firestore-dokument) — fortsæt alligevel med den
    // friskt hentede værdi, bare uden at gemme den til næste gang. Ingen grund til at fejle
    // hele kørslen for en cache-optimering, der ikke lykkedes.
    console.warn(`OddsPapi: kunne ikke cache "${key}" (bruger værdien uden at gemme):`, e.message);
  }
  return value;
}

// Leder efter et 2-udfalds "vinder"-marked i OddsPapis indlejrede odds-struktur:
// bookmakerOdds[bookmaker].markets[marketId].outcomes[outcomeId].players[playerId].price.
// Se scheduler/sources/cs2.mjs for baggrunden — det er et forsigtigt gæt, ikke en bekræftet
// markedstype, så returnerer den null, viser appen bare kampen uden odds.
export function extractTwoWayOdds(oddsJson) {
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
    console.warn('OddsPapi: kunne ikke tolke odds-svaret:', e.message);
  }
  return null;
}
