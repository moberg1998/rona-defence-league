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
    // De fleste ligaer fra sidste kørsel er allerede bekræftet og lagt i football.mjs —
    // kun de uafklarede står tilbage her (MLS' rigtige navn og Tjekkiets liga).
    wanted: [
      { search: 'Major League Soccer', country: 'USA' },
      { search: 'Fortuna Liga', country: 'Czech Republic' },
      { countryOnly: 'Czech-Republic' },   // fallback: viser alle fodboldligaer i landet
    ],
  },
  {
    label: 'HÅNDBOLD',
    base: 'https://v1.handball.api-sports.io',
    wanted: [
      { search: 'Håndboldligaen', country: 'Norway' },   // OBS: API-Sports tillader ikke bindestreg i søgeord (fx "1000-ligaen")
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
        // Fodbold (v3) svarer nested ({league:{id,name,type}, country:{name}}), mens håndbold/
        // basketball (v1) svarer fladt ({id, name, type, country:{name}}) — håndter begge former.
        const hits = res.map(r => {
          const lg = r.league || r;
          const country = r.country?.name || r.country || lg.country || '?';
          return `id=${lg.id} · ${lg.name} · ${country} (${lg.type || '?'})`;
        });
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
