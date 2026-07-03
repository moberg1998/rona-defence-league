// Kører hvert 15. minut via GitHub Actions (.github/workflows/notify.yml).
// Læser klubbens Firestore-data med Firebase Admin SDK (uden om sikkerhedsreglerne, som kun gælder klienter)
// og sender web-push til gemte enheds-tokens på de tidspunkter, der er beskrevet i appens "Notifikationer"-skærm.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { DateTime } from 'luxon';

const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!svcJson) {
  console.error('Mangler miljøvariablen FIREBASE_SERVICE_ACCOUNT (GitHub-secret).');
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(svcJson)) });
const db = getFirestore();
const messaging = getMessaging();

const CLUB = db.collection('clubs').doc('rona');
const TZ = 'Europe/Copenhagen';
const staleTokens = [];

function nthSat(year, month0, n) { // month0 er 0-11, matcher app-koden i index.html
  const d = new Date(Date.UTC(year, month0, 1));
  let c = 0;
  while (true) {
    if (d.getUTCDay() === 6) { c++; if (c === n) return d.toISOString().slice(0, 10); }
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

async function sendTo(tokens, title, body) {
  if (!tokens.length) return;
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    try {
      const res = await messaging.sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        webpush: { fcmOptions: { link: 'https://rona-defence-league.web.app/' } },
      });
      res.responses.forEach((r, idx) => {
        const code = r.error && r.error.code;
        if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')) {
          staleTokens.push(chunk[idx]);
        }
      });
      console.log(`Sendt "${title}" til ${chunk.length} enhed(er), ${res.successCount} lykkedes.`);
    } catch (e) {
      console.error('Fejl ved afsendelse:', e.message);
    }
  }
}

async function main() {
  const now = DateTime.now().setZone(TZ);

  const [metaSnap, roundsSnap, paySnap, tokensSnap, trackerSnap] = await Promise.all([
    CLUB.collection('state').doc('meta').get(),
    CLUB.collection('rounds').get(),
    CLUB.collection('state').doc('payments').get(),
    CLUB.collection('pushTokens').get(),
    CLUB.collection('state').doc('notifTracker').get(),
  ]);

  const players = (metaSnap.data() || {}).players || [];
  const payments = paySnap.data() || {};
  const tracker = trackerSnap.data() || {};
  const monthsClosedNotified = new Set(tracker.monthsClosedNotified || []);

  const tokensByPlayer = {};
  const allTokens = [];
  tokensSnap.forEach(d => {
    const t = d.data();
    allTokens.push(t.token);
    (tokensByPlayer[t.player] ||= []).push(t.token);
  });
  const tokensFor = names => names.flatMap(n => tokensByPlayer[n] || []);

  const rounds = roundsSnap.docs.map(d => d.data());
  const openRound = rounds.find(r => r.status === 'open');
  const trackerUpdate = {};

  // Admin har trykket en af "Send manuelt nu"-knapperne under Adminpanel — send og ryd køen.
  if (tracker.manualRequest) {
    const { type } = tracker.manualRequest;
    let title, recips;
    if (type === 'spil') {
      recips = (openRound && openRound.status === 'open')
        ? players.filter(n => !(openRound.picks || {})[n] && !(openRound.absent || []).includes(n))
        : [];
      title = 'Husk at sende dit spil — deadline om 24 timer ⏰';
    } else if (type === 'betal') {
      const mk = openRound ? openRound.date.slice(0, 7) : now.toFormat('yyyy-MM');
      const pm = payments[mk] || {};
      recips = players.filter(n => !pm['fee_' + n]);
      title = 'Husk indbetaling — frist om 24 timer 💰';
    } else if (type === 'lukket') {
      recips = players; title = 'Kuponen er lukket — held og lykke 🎟️';
    } else {
      recips = players; title = 'Månedsbesked til hele klubben';
    }
    if (recips.length) await sendTo(tokensFor(recips), title, 'Sendt manuelt af admin.');
    trackerUpdate.manualRequest = FieldValue.delete();
  }

  if (openRound) {
    const deadline = DateTime.fromISO(`${openRound.date}T10:00:00`, { zone: TZ });
    const reminderAt = deadline.minus({ hours: 24 });

    if (now >= reminderAt && now < deadline && tracker.roundReminderSent !== openRound.id) {
      const missing = players.filter(n => !(openRound.picks || {})[n] && !(openRound.absent || []).includes(n));
      if (missing.length) await sendTo(tokensFor(missing), 'Husk at sende dit spil ⏰', 'Deadline er lørdag kl. 10 — du mangler stadig at melde dit spil ind.');
      trackerUpdate.roundReminderSent = openRound.id;
    }
    if (now >= deadline && now < deadline.plus({ minutes: 20 }) && tracker.roundLockedSent !== openRound.id) {
      await sendTo(allTokens, 'Kuponen er lukket 🎟️', 'Runden er låst — held og lykke!');
      trackerUpdate.roundLockedSent = openRound.id;
    }

    const monthKey = openRound.date.slice(0, 7);
    const pm = payments[monthKey] || {};
    if (!pm.closed) {
      const [y, m] = monthKey.split('-').map(Number);
      const firstSat = nthSat(y, m - 1, 1);
      const payDeadline = DateTime.fromISO(`${firstSat}T10:00:00`, { zone: TZ });
      const payReminderAt = payDeadline.minus({ hours: 24 });
      if (now >= payReminderAt && now < payDeadline && tracker.payReminderSent !== monthKey) {
        const unpaid = players.filter(n => !pm['fee_' + n]);
        if (unpaid.length) await sendTo(tokensFor(unpaid), 'Husk indbetaling 💰', 'Husk at overføre til Magnus på MobilePay (42174259) inden i dag kl. 10.');
        trackerUpdate.payReminderSent = monthKey;
      }
    }
  }

  const newlyClosed = Object.keys(payments).filter(k => payments[k].closed && !monthsClosedNotified.has(k));
  if (newlyClosed.length) {
    await sendTo(allTokens, 'Måneden er gjort op 🔔', 'Se Penge-fanen for månedens taber og den nye betaling.');
    trackerUpdate.monthsClosedNotified = [...monthsClosedNotified, ...newlyClosed].slice(-24);
  }

  if (staleTokens.length) {
    const batch = db.batch();
    staleTokens.forEach(t => batch.delete(CLUB.collection('pushTokens').doc(t)));
    await batch.commit();
    console.log('Ryddede', staleTokens.length, 'udløbne token(s).');
  }

  if (Object.keys(trackerUpdate).length) {
    await CLUB.collection('state').doc('notifTracker').set(trackerUpdate, { merge: true });
  }

  console.log('Tjekket', now.toISO());
}

main().catch(e => { console.error(e); process.exit(1); });
