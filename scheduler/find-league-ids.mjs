// ENGANGS-VÆRKTØJ: finder de rigtige API-Sports liga-id'er for en ønsket liste af ligaer,
// så vi undgår at gætte forkerte id'er ind i football.mjs. Køres manuelt via GitHub Actions
// (workflow_dispatch) — rører intet i Firestore, skriver kun til kørslens log.
// Når vi har de bekræftede id'er, kan denne fil og dens workflow slettes igen.
import { makeApiSportsGet } from './sources/shared.mjs';

const BASE = 'https://v3.football.api-sports.io';

// {søgeord, forventet land} — landet bruges kun til at vælge den rigtige træffer i loggen,
// hvis søgeordet giver flere resultater (fx "Premier League" findes i mange lande).
const WANTED = [
  { search: 'Eredivisie', country: 'Netherlands' },
  { search: 'Eerste Divisie', country: 'Netherlands' },
  { search: 'Primeira Liga', country: 'Portugal' },
  { search: 'Liga Portugal 2', country: 'Portugal' },
  { search: 'Pro League', country: 'Belgium' },
  { search: 'Super Lig', country: 'Turkey' },
  { search: 'Premier League', country: 'Russia' },
  { search: 'Premier League', country: 'Ukraine' },
  { search: 'Premiership', country: 'Scotland' },
  { search: 'Bundesliga', country: 'Austria' },
  { search: 'Super League', country: 'Switzerland' },
  { search: 'Super League', country: 'Greece' },
  { search: 'Eliteserien', country: 'Norway' },
  { search: 'Allsvenskan', country: 'Sweden' },
  { search: 'Serie A', country: 'Brazil' },
  { search: 'Liga Profesional', country: 'Argentina' },
  { search: 'MLS', country: 'USA' },
  { search: 'Liga MX', country: 'Mexico' },
  { search: 'J1 League', country: 'Japan' },
  { search: 'K League 1', country: 'South Korea' },
  { search: 'Pro League', country: 'Saudi Arabia' },
  { search: 'Super League', country: 'China' },
  { search: 'A-League', country: 'Australia' },
  { search: 'Ekstraklasa', country: 'Poland' },
  { search: 'Chance Liga', country: 'Czech Republic' },
  { search: 'HNL', country: 'Croatia' },
  { search: 'Super Liga', country: 'Serbia' },
  { search: 'Liga I', country: 'Romania' },
  { search: 'Segunda', country: 'Spain' },
];

async function main() {
  const apiKey = process.env.API_SPORTS_KEY;
  const apiGet = makeApiSportsGet(apiKey);
  console.log(`Slår ${WANTED.length} ligaer op...\n`);
  for (const w of WANTED) {
    try {
      const res = await apiGet(BASE, '/leagues', { search: w.search });
      const hits = res.map(r => `id=${r.league.id} · ${r.league.name} · ${r.country.name} (${r.league.type})`);
      console.log(`SØGNING "${w.search}" (forventet: ${w.country}):`);
      if (!hits.length) console.log('  (ingen træffere)');
      else hits.forEach(h => console.log('  ' + h));
      console.log('');
    } catch (e) {
      console.log(`SØGNING "${w.search}" fejlede: ${e.message}\n`);
    }
  }
}

main();
