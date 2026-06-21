// Einmaliges Setup: öffnet den Login-Proxy, speichert den Cookie nach
// data/alexa_cookie.json und cached die Temperatur-Sensor-Entity nach
// data/alexa_temp_entity.txt – also genau das, was der Service braucht.
//
//   node alexa-login.js
//
// Danach im Browser http://127.0.0.1:3001 öffnen und bei Amazon einloggen.
// Aus dem rtjscomp-Projekt-Root starten, damit data/ übereinstimmt.

const fs = require('fs');
const path = require('path');
const Alexa = require('alexa-remote2');

const DATA_DIR    = path.join(__dirname, '../../../data');
const COOKIE_FILE = path.join(DATA_DIR, 'alexa_cookie.json');
const ENTITY_FILE = path.join(DATA_DIR, 'alexa_temp_entity.txt');

const OPTS = {
	proxyOnly: true,
	proxyOwnIp: '192.168.178.48',
	proxyPort: 3001,
	amazonPage: 'amazon.de',
	alexaServiceHost: 'alexa.amazon.de',
	acceptLanguage: 'de-DE',
	useWsMqtt: false,
	bluetooth: false,
	logger: console.log,
};

// data/ sicherstellen + evtl. vorhandenen Cookie wiederverwenden
fs.mkdirSync(DATA_DIR, { recursive: true });
let cookie;
try { cookie = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8')); } catch (e) { cookie = undefined; }

const alexa = new Alexa();
alexa.init(Object.assign({}, OPTS, { cookie: cookie }), function(err) {
	if (err) {
		// Beim ersten Mal nur die Login-Aufforderung, kein echter Fehler:
		const msg = err.message || String(err);
		if (msg.indexOf('127.0.0.1') !== -1 || msg.toLowerCase().indexOf('login') !== -1) {
			console.log('\n➜ Bitte im Browser einloggen:', msg, '\n');
			return; // nach erfolgreichem Login feuert der Callback erneut ohne err
		}
		console.error('Init fehlgeschlagen:', msg);
		process.exit(1);
	}

	// Login ok -> Cookie (cookieData mit Refresh-Token) speichern
	const fresh = alexa.cookieData || alexa.cookie;
	fs.writeFileSync(COOKIE_FILE, JSON.stringify(fresh, null, 2));
	console.log('✔ Cookie gespeichert:', COOKIE_FILE);

	// Optional: Temperatur-Sensor finden, cachen und einmal anzeigen
	discoverAndShow(function() {
		if (alexa.stop) { try { alexa.stop(); } catch (e) {} }
		process.exit(0);
	});
});

function discoverAndShow(done) {
	alexa.getSmarthomeEntities(function(err, entities) {
		if (err || !Array.isArray(entities)) {
			console.warn('Konnte Geräte nicht laden – Cookie ist aber gespeichert.');
			return done();
		}
		const ids = entities.map(function(e) { return e.id || e.entityId; }).filter(Boolean);
		alexa.querySmarthomeDevices(ids, 'ENTITY', function(err2, res) {
			if (err2) { console.warn('Status-Abfrage fehlgeschlagen.'); return done(); }
			const states = (res && res.deviceStates) || [];
			for (const dev of states) {
				for (const capRaw of (dev.capabilityStates || [])) {
					let cap; try { cap = JSON.parse(capRaw); } catch (e) { continue; }
					if (cap.namespace === 'Alexa.TemperatureSensor' && cap.name === 'temperature') {
						const id = dev.entity && dev.entity.entityId;
						const t  = cap.value && cap.value.value;
						if (id) {
							fs.writeFileSync(ENTITY_FILE, id);
							console.log('✔ Temperatur-Sensor gecacht:', ENTITY_FILE);
							console.log('🌡  Aktuell:', t, '°C');
							return done();
						}
					}
				}
			}
			console.warn('Kein Temperatursensor gefunden (Modell ohne Sensor?). Cookie ist trotzdem gespeichert.');
			done();
		});
	});
}
