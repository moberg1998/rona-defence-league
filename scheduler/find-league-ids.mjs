// ENGANGS-VÆRKTØJ: finder de rigtige API-Sports liga-id'er for en ønsket liste af ligaer,
// så vi undgår at gætte forkerte id'er ind i football.mjs. Køres manuelt via GitHub Actions
// (workflow_dispatch) — rører intet i Firestore, skriver kun til kørslens log.
// Når vi har de bekræftede id'er, kan denne fil og dens workflow slettes igen.
import { makeApiSportsGet } from './sources/shared.mjs';

// {søgeord, forventet land} — landet bruges kun til at vælge den rigtige træffer i loggen,
// hvis søgeordet giver flere resultater (fx "Premier League" findes i mange lande).
const SPORTS = [
  {
    label: 'FODBOLD',
    base: 'https://v3.football.api-sports.io',
    wanted: [
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
    ],
  },
  {
    label: 'HÅNDBOLD',
    base: 'https://v1.handball.api-sports.io',
    wanted: [
      { search: 'REMA 1000-ligaen', country: 'Norway' },
      { search: 'Handbollsligan', country: 'Sweden' },
      { countryOnly: 'Norway' },   // fallback: viser ALLE håndboldligaer i landet, hvis søgeordet ovenfor ikke rammer
      { countryOnly: 'Sweden' },
    ],
  },
  {
    label: 'BASKETBALL',
    base: 'https://v1.basketball.api-sports.io',
    wanted: [
      { search: 'EuroCup', country: '(europæisk, 2. niveau efter Euroleague)' },
    ],
  },
];

async function main() {
  const apiKey = process.env.API_SPORTS_KEY;
  const apiGet = makeApiSportsGet(apiKey);
  for (const sport of SPORTS) {
    console.log(`\n=== ${sport.label} (${sport.base}) — ${sport.wanted.length} søgninger ===\n`);
    for (const w of sport.wanted) {
      const params = w.countryOnly ? { country: w.countryOnly } : { search: w.search };
      const label = w.countryOnly ? `country=${w.countryOnly}` : `søgning "${w.search}" (forventet: ${w.country})`;
      try {
        const res = await apiGet(sport.base, '/leagues', params);
        const hits = res.map(r => `id=${r.league.id} · ${r.league.name} · ${r.country?.name || '?'} (${r.league.type || '?'})`);
        console.log(`${label}:`);
        if (!hits.length) console.log('  (ingen træffere)');
        else hits.forEach(h => console.log('  ' + h));
        console.log('');
      } catch (e) {
        console.log(`${label} fejlede: ${e.message}\n`);
      }
    }
  }
}

main();
