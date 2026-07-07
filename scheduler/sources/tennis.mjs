// Tennis (ATP/WTA + Grand Slams) via OddsPapi — IKKE API-Sports (tennis er ikke inkluderet der).
// Samme sparsommelige strategi som cs2.mjs, da de deler den samme kontobrede månedlige grænse:
//  - Så langt frem som muligt (9 dage — OddsPapis eget loft, se FETCH_DAYS), filtreret til KUN
//    lør. 12-søn. (isWeekendSlot) — ét /v4/fixtures-kald uanset vinduets størrelse, ingen ekstra
//    kvote. Filtreres FØR turneringsfilteret, da tennis kan have 100+ kampe/dag globalt —
//    weekend-filteret skærer det kraftigt ned først.
//  - sportId for tennis er ikke dokumenteret et fast sted, så den slås op via /v4/sports og caches.
//  - Deltager-/turneringsnavne caches i Firestore, genhentes kun hver ~6. dag.
//  - Kun de først-startende MAX_ODDS_LOOKUPS kampe får et rigtigt odds-opslag.
//  - Begrænset til ATP/WTA hovedturen + Grand Slams — IKKE ITF/Challenger/juniorer/qualifiers,
//    som ellers ville oversvømme både listen og kvoten (tennis har MANGE kampe dagligt).
import { TZ, isWeekendSlot } from './shared.mjs';
import { oddsPapiGet, asList, getCached, extractTwoWayOdds, slimTournaments } from './oddspapi-shared.mjs';
import { DateTime } from 'luxon';

// BEKRÆFTET ved en rigtig kørsel: OddsPapi tillader højst 9 dage mellem from/to, når kun sportId
// er angivet ("must be under 10 days apart") — 10+ giver en "Invalid date range"-fejl.
const FETCH_DAYS = 9;
const MAX_ODDS_LOOKUPS = 8;
const INCLUDE_KEYWORDS = /\batp\b|\bwta\b|grand slam|australian open|roland garros|french open|wimbledon|us open/i;
const EXCLUDE_KEYWORDS = /itf|challenger|qualif|juniors?|boys|girls|exhibition|legends|seniors|wheelchair|doubles/i;

async function resolveTennisSportId(apiKey, cacheRef) {
  const sports = await getCached(cacheRef, 'sports_list', 30, async () => asList(await oddsPapiGet(apiKey, '/v4/sports', {})));
  const found = sports.find(s => /tennis/i.test(s.sportName || s.slug || ''));
  if (!found) throw new Error('Kunne ikke finde "tennis" i /v4/sports-listen.');
  return found.sportId;
}

export async function fetchTennis(apiKey, cacheRef) {
  if (!apiKey) throw new Error('Mangler ODDSPAPI_KEY.');

  const sportId = await resolveTennisSportId(apiKey, cacheRef);
  const today = DateTime.now().setZone(TZ).toFormat('yyyy-MM-dd');
  const lastDay = DateTime.now().setZone(TZ).plus({ days: FETCH_DAYS - 1 }).toFormat('yyyy-MM-dd');

  const fixturesJson = await oddsPapiGet(apiKey, '/v4/fixtures', { sportId, from: today, to: lastDay, hasOdds: true });
  let fixtures = asList(fixturesJson).filter(fx => isWeekendSlot(fx.startTime || fx.date));
  console.log(`Tennis: ${fixtures.length} kamp(e) fundet (lør. 12-søn., ${today} → ${lastDay}), før turneringsfilter.`);
  if (!fixtures.length) return [];

  const participantsMap = await getCached(cacheRef, 'tennis_participants', 6, async () => oddsPapiGet(apiKey, '/v4/participants', { sportId }));
  // Filtrerer til ATP/WTA/Grand Slam FØR caching — ikke bagefter. Tennis har tusindvis af
  // turneringer (ITF/Challenger/juniorer verden over), og selv efter slimTournaments() var den
  // fulde, ufiltrerede liste for stor til ét Firestore-dokument (ramte 1.5 MB, loft er 1 MB).
  // Ved kun at gemme den lille, allerede-filtrerede delmængde er den slags nu udelukket.
  const tournamentsList = await getCached(cacheRef, 'tennis_tournaments', 6, async () => {
    const all = slimTournaments(asList(await oddsPapiGet(apiKey, '/v4/tournaments', { sportId })));
    return all.filter(t => INCLUDE_KEYWORDS.test(t.tournamentName || '') && !EXCLUDE_KEYWORDS.test(t.tournamentName || ''));
  });
  const allowedTournamentIds = new Set(tournamentsList.map(t => t.tournamentId));
  const tournamentName = id => tournamentsList.find(t => t.tournamentId === id)?.tournamentName;

  fixtures = fixtures.filter(fx => allowedTournamentIds.has(fx.tournamentId));
  fixtures.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  console.log(`Tennis: ${fixtures.length} kamp(e) efter ATP/WTA/Grand Slam-filter.`);

  const out = [];
  let oddsLookups = 0;
  for (const fx of fixtures) {
    const id = fx.fixtureId || fx.id;
    const home = participantsMap?.[fx.participant1Id] || fx.home?.name;
    const away = participantsMap?.[fx.participant2Id] || fx.away?.name;
    const date = fx.startTime || fx.date;
    const league = tournamentName(fx.tournamentId) || 'Tennis';
    if (!id || !home || !away || !date) {
      console.warn('Tennis: sprang en kamp over (mangler felt):', JSON.stringify(fx).slice(0, 300));
      continue;
    }

    let odds = null;
    if (oddsLookups < MAX_ODDS_LOOKUPS) {
      try {
        const oddsJson = await oddsPapiGet(apiKey, '/v4/odds', { fixtureId: id });
        odds = extractTwoWayOdds(oddsJson);
        oddsLookups++;
      } catch (e) {
        console.warn('Tennis: odds-opslag fejlede for', id, e.message);
      }
    }

    out.push({ id: 't' + id, date, league: { id: sportId, name: league }, home, away, odds });
  }
  console.log(`Tennis: hentede odds for ${oddsLookups} af ${out.length} kamp(e) (loft: ${MAX_ODDS_LOOKUPS}).`);
  return out;
}
