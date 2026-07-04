// CS2 (Counter-Strike 2) via OddsPapi. Se oddspapi-shared.mjs for baggrund om det stramme,
// KONTO-BREDE månedlige loft (~250 opslag/md, delt med Tennis) og hvordan vi holder os under det:
//  - Kun i dag + i morgen (samme weekend-fokus som API-Sports-kilderne), ikke en hel uge.
//  - Deltager-/turneringsnavne caches i Firestore og genhentes kun hver ~6. dag.
//  - Kun de først-startende MAX_ODDS_LOOKUPS kampe får et rigtigt odds-opslag — resten vises
//    stadig i appen, bare uden auto-udfyldte odds (spilleren taster selv).
//  - Begrænset til større turneringer (BLAST/IEM/ESL Pro League/PGL/Major/EPL), så listen er
//    relevant og ikke drukner i alle verdens småturneringer.
import { TZ } from './shared.mjs';
import { oddsPapiGet, asList, getCached, extractTwoWayOdds } from './oddspapi-shared.mjs';
import { DateTime } from 'luxon';

const CS2_SPORT_ID = 17;
const MAX_ODDS_LOOKUPS = 8;
const MAJOR_KEYWORDS = /blast|iem|esl pro league|pgl|major|epl/i;

export async function fetchCS2(apiKey, cacheRef) {
  if (!apiKey) throw new Error('Mangler ODDSPAPI_KEY.');

  const today = DateTime.now().setZone(TZ).toFormat('yyyy-MM-dd');
  const tomorrow = DateTime.now().setZone(TZ).plus({ days: 1 }).toFormat('yyyy-MM-dd');

  const fixturesJson = await oddsPapiGet(apiKey, '/v4/fixtures', { sportId: CS2_SPORT_ID, from: today, to: tomorrow, hasOdds: true });
  let fixtures = asList(fixturesJson);
  console.log(`CS2: ${fixtures.length} kamp(e) fundet (${today} → ${tomorrow}), før turneringsfilter.`);
  if (!fixtures.length) return [];

  const participantsMap = await getCached(cacheRef, 'cs2_participants', 6, () => oddsPapiGet(apiKey, '/v4/participants', { sportId: CS2_SPORT_ID }));
  const tournamentsList = await getCached(cacheRef, 'cs2_tournaments', 6, async () => asList(await oddsPapiGet(apiKey, '/v4/tournaments', { sportId: CS2_SPORT_ID })));
  const majorTournamentIds = new Set(tournamentsList.filter(t => MAJOR_KEYWORDS.test(t.tournamentName || '')).map(t => t.tournamentId));
  const tournamentName = id => tournamentsList.find(t => t.tournamentId === id)?.tournamentName;

  if (majorTournamentIds.size) fixtures = fixtures.filter(fx => majorTournamentIds.has(fx.tournamentId));
  fixtures.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  console.log(`CS2: ${fixtures.length} kamp(e) efter turneringsfilter (store turneringer).`);

  const out = [];
  let oddsLookups = 0;
  for (const fx of fixtures) {
    const id = fx.fixtureId || fx.id;
    const home = participantsMap?.[fx.participant1Id] || fx.home?.name;
    const away = participantsMap?.[fx.participant2Id] || fx.away?.name;
    const date = fx.startTime || fx.date;
    const league = tournamentName(fx.tournamentId) || 'CS2';
    if (!id || !home || !away || !date) {
      console.warn('CS2: sprang en kamp over (mangler felt):', JSON.stringify(fx).slice(0, 300));
      continue;
    }

    let odds = null;
    if (oddsLookups < MAX_ODDS_LOOKUPS) {
      try {
        const oddsJson = await oddsPapiGet(apiKey, '/v4/odds', { fixtureId: id });
        odds = extractTwoWayOdds(oddsJson);
        oddsLookups++;
      } catch (e) {
        console.warn('CS2: odds-opslag fejlede for', id, e.message);
      }
    }

    out.push({ id: 'c' + id, date, league: { id: CS2_SPORT_ID, name: league }, home, away, odds });
  }
  console.log(`CS2: hentede odds for ${oddsLookups} af ${out.length} kamp(e) (loft: ${MAX_ODDS_LOOKUPS}).`);
  return out;
}
