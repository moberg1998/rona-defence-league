// Kører én gang dagligt (tidlig morgen, dansk tid) via .github/workflows/fetch-fixtures.yml.
// Orkestrerer alle kamp-kilder (én fil pr. sportsgren under ./sources/) og samler resultatet
// i ét Firestore-dokument (clubs/rona/state/fixturesLive), som appens klient læser — API-nøglerne
// ligger kun her som GitHub-secrets, aldrig i klient-koden.
//
// Modulært: for at tilføje/fjerne en sportsgren, tilføj/fjern kun dens egen fil under ./sources/
// og dens ene linje i SOURCES-listen herunder. Fejler én sportsgren (fx en afvist API-kilde),
// beholder vi bare dens seneste kendte data i Firestore i stedet for at overskrive med tomt.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fetchFootball } from './sources/football.mjs';
import { fetchHandball } from './sources/handball.mjs';
import { fetchBasketball } from './sources/basketball.mjs';
import { fetchHockey } from './sources/hockey.mjs';
import { fetchCS2 } from './sources/cs2.mjs';

const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT;
const apiSportsKey = process.env.API_SPORTS_KEY;
const oddsPapiKey = process.env.ODDSPAPI_KEY;
if (!svcJson) { console.error('Mangler FIREBASE_SERVICE_ACCOUNT secret.'); process.exit(1); }
if (!apiSportsKey) { console.error('Mangler API_SPORTS_KEY secret.'); process.exit(1); }

initializeApp({ credential: cert(JSON.parse(svcJson)) });
const db = getFirestore();
const CLUB = db.collection('clubs').doc('rona');
const fixturesLiveRef = CLUB.collection('state').doc('fixturesLive');

const SOURCES = [
  { key: 'football', label: 'Fodbold', fetch: () => fetchFootball(apiSportsKey) },
  { key: 'handball', label: 'Håndbold', fetch: () => fetchHandball(apiSportsKey) },
  { key: 'basketball', label: 'Basketball', fetch: () => fetchBasketball(apiSportsKey) },
  { key: 'hockey', label: 'Ishockey', fetch: () => fetchHockey(apiSportsKey) },
  { key: 'cs2', label: 'CS2', fetch: () => fetchCS2(oddsPapiKey) },
];

async function main() {
  const existingSnap = await fixturesLiveRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : {};

  const result = { updatedAt: Date.now() };
  for (const src of SOURCES) {
    try {
      result[src.key] = await src.fetch();
      console.log(`${src.label}: gemmer ${result[src.key].length} kamp(e).`);
    } catch (e) {
      console.error(`${src.label} fejlede — beholder tidligere data i Firestore:`, e.message);
      result[src.key] = existing[src.key] || [];
    }
  }

  await fixturesLiveRef.set(result);
  console.log('fixturesLive opdateret.');
}

main().catch(e => {
  console.error('Uventet fejl i scheduler:', e.message);
  process.exit(1);
});
