// Hält eine offene Verbindung zur Alexa-Cloud, pollt alle 5 Min die
// Echo-Temperatur -> this.room_temperature, und sagt beim Start/Stop Bescheid.

const speak_replace_list="allana;alanna|maged;m-a-g-e-t"; // TODO

const Alexa = require('alexa-remote2');

const INTERVAL_MS  = 5 * 60 * 1000;
const COOKIE_FILE  = 'alexa_cookie.json';
const ENTITY_FILE  = 'alexa_temp_entity.txt';
const SPEAK_DEVICE = '';   // Name (wie in der Alexa-App) ODER Serial. Leer = ersten Echo automatisch nehmen.

const ALEXA_OPTS = {
	amazonPage: 'amazon.de',
	alexaServiceHost: 'alexa.amazon.de',
	acceptLanguage: 'de-DE',
	proxyOwnIp: "192.168.178.48",
	proxyPort: 8001,
	useWsMqtt: true,                  // Push-Verbindung an
	//autoQueryActivityOnTrigger: true, // bei jedem Trigger automatisch den Transkript-Text holen
	bluetooth: false,
	logger: () => {},
};

const service = this;
service.room_temperature = null;
service.room_temperature_time = 0;

let alexa = null;
let entityId = null;
let timer = null;
let busy = false;
let ready = false;

// ----------------------------------------------------------- Lifecycle
async function start() {
	ready=false;
	try {
		const cookie = await rtjscomp.data_load(COOKIE_FILE);   // .json -> bereits Objekt
		if (!cookie) {
			console.error('[alexa-remote] Kein Cookie in data/' + COOKIE_FILE + ' – bitte alexa-login.js laufen lassen.');
			return;
		}
		const cachedId = await rtjscomp.data_load(ENTITY_FILE); // .txt -> String
		if (cachedId) entityId = String(cachedId).trim();

		alexa = new Alexa();
		alexa.init(Object.assign({}, ALEXA_OPTS, { cookie: cookie }), onReady);

	} catch (e) {
		console.error('[alexa-remote] Start fehlgeschlagen:', (e && e.message) || e);
	}
}

async function onReady(err) {
	if (err) {
		console.error('[alexa-remote] Init fehlgeschlagen:', err.message || err);
		return;
	}
	if (alexa.cookieData) await rtjscomp.data_save(COOKIE_FILE, alexa.cookieData);
	ready = true;
	service.speak=announce;

	setTimeout(()=>announce('rtjscomp Alexa Service gestartet'),1e3);   // Startansage

	if (!entityId) entityId = await discoverEntity();
	if (!entityId) {
		console.error('[alexa-remote] Kein Temperatursensor gefunden.');
		return;
	}
	measure();
	timer = setInterval(measure, INTERVAL_MS);
	alexa.on('command', onAlexaActivity);

	const origEmit = alexa.emit.bind(alexa);
	alexa.emit = function(name) { console.log('[alexa-remote] event:', name); return origEmit.apply(null, arguments); };

	//alexa.on('ws-connect',    function()  { console.log('[alexa-remote] Push verbunden ✔'); });
	//alexa.on('ws-disconnect', function()  { console.log('[alexa-remote] Push getrennt'); });
	//alexa.on('ws-error',      function(e) { console.error('[alexa-remote] Push-Fehler:', (e && e.message) || e); });
	//alexa.on('command',       onPush);

	function safe(o) { try { return JSON.stringify(o); } catch (e) { return String(o); } }
	function extractSummary(act) {
		if (!act) return null;
		let d = act.description;
		if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
		if (d && d.summary) return d.summary;
		// Fallback: erstes Transkript aus dem Verlauf
		const items = act.data && act.data.voiceHistoryRecordItems;
		if (Array.isArray(items)) {
			const hit = items.find(function(i){ return i && i.transcriptText; });
			if (hit) return hit.transcriptText;
		}
		return null;
	}

	// volle Details der interessanten Events
	alexa.on('command', function(evt) {
		console.log('[command] ' + safe(evt));
	});
	alexa.on('ws-device-activity', function(act) {
		const a = readActivity(act);
		if (!a.user) return;
		console.log('🎤 „' + a.user + '"  [intent=' + a.intent + ', domain=' + a.domain + ']');

		// nur eigene Befehle ausführen, die Alexa selbst NICHT gegriffen hat
		if (a.intent && a.intent !== 'Unknown') return;   // <- verhindert das Reinquatschen
		runCommand(a.user);
	});

	alexa.on('ws-connect',    function() { console.log('[alexa-remote] Push verbunden ✔'); });
	alexa.on('ws-error',      function(e){ console.error('[alexa-remote] Push-Fehler:', (e && e.message) || e); });
}
let lastSeen = 0;

function onPush(evt) {
	if (!evt || evt.command !== 'PUSH_ACTIVITY' || !alexa) return;
	alexa.getActivities({ size: 1, filter: true }, function(err, activities) {
		if (err) return console.error('[alexa-remote] getActivities:', err.message || err);
		const act = (activities || [])[0];
		if (!act) return;

		const ts = act.creationTimestamp || act.timestamp || 0;
		if (ts && ts === lastSeen) return;   // gleiche Aktivität nicht doppelt
		lastSeen = ts;

		const text = extractSummary(act);
		const dev  = act.name || (act.device && act.device.deviceName) || '?';
		if (text) console.log('🎤 [' + dev + '] gehört: ' + text);
	});
}

function extractSummary(act) {
	const d = act && act.description;
	if (!d) return null;
	if (typeof d === 'object') return d.summary;
	try { return JSON.parse(d).summary; } catch (e) { return null; }
}
function stop() {
	if (timer) { clearInterval(timer); timer = null; }

	let done = false;
	const finish = function() {
		if (done) return;
		done = true;
		if (alexa && alexa.stop) { try { alexa.stop(); } catch (e) {} }
		alexa = null;
		ready = false;
	};

	// Stoppansage nur, wenn die Verbindung noch steht – dann erst schließen
	if (alexa && ready) {
		announce('rtjscomp Alexa Service gestoppt', finish);
		setTimeout(finish, 3000);   // Fallback, falls die Ansage hängt
	} else {
		finish();
	}
}

// ----------------------------------------------------------- TTS
function resolveSpeaker() {
	if (SPEAK_DEVICE) return SPEAK_DEVICE;
	const map = (alexa && alexa.serialNumbers) || {};
	for (const sn in map) {
		const d = map[sn];
		if (d && d.capabilities && d.capabilities.indexOf('AUDIO_PLAYER') !== -1) return sn;
	}
	return null;
}

function announce(text, cb) {
	const target = alexa && resolveSpeaker();
	if (!target) { if (cb) cb(); return; }
	alexa.sendSequenceCommand(target, 'speak', text, function(err) {
		if (err) console.error('[alexa-remote] Ansage fehlgeschlagen:', err.message || err);
		if (cb) cb();
	});
}

// Stichwort (im gesprochenen Text gesucht) -> Aktion
const COMMANDS = [
	{ match: /wie warm|temperatur/i, run: function() {
		announce('Im Zimmer sind ' + (service.room_temperature != null ? service.room_temperature : 'unbekannt') + ' Grad');
	}},
	{ match: /licht/i,  run: function() { announce('Okay'); /* dein Smarthome-Call */ } },
	{ match: /systemzustand/i,  run: function() { announce('Läuft sauber seit Immer'); /* dein Smarthome-Call */ } },
];

function runCommand(text) {
	const lower = text.toLowerCase();
	for (const cmd of COMMANDS) {
		if (cmd.match.test(lower)) { try { cmd.run(); } catch (e) { console.error(e); } break; }
	}
}

function onAlexaActivity(evt) {
	// Form driftet je nach Amazon/Lib-Version -> beim ersten Mal einmal loggen:
	// console.log('[alexa-remote] activity:', JSON.stringify(evt));
	const text = extractSummary(evt);
	if (!text) return;
	const lower = String(text).toLowerCase();
	for (const cmd of COMMANDS) {
		if (cmd.match.test(lower)) {
			try { cmd.run(); } catch (e) { console.error('[alexa-remote] Befehl:', e); }
			break;
		}
	}
}

function extractSummary(evt) {
	if (!evt) return null;
	const d = evt.description || (evt.activity && evt.activity.description);
	if (!d) return null;
	if (typeof d === 'object') return d.summary;          // schon geparst
	try { return JSON.parse(d).summary; } catch (e) { return null; } // JSON-String
}

// ----------------------------------------------------------- Abfragen
function discoverEntity() {
	return new Promise(function(resolve) {
		alexa.getSmarthomeEntities(function(err, entities) {
			if (err || !Array.isArray(entities)) return resolve(null);
			const ids = entities.map(function(e) { return e.id || e.entityId; }).filter(Boolean);
			alexa.querySmarthomeDevices(ids, 'ENTITY', async function(err2, res) {
				if (err2) return resolve(null);
				const id = findTemperatureEntityId((res && res.deviceStates) || []);
				if (id) await rtjscomp.data_save(ENTITY_FILE, id);
				resolve(id);
			});
		});
	});
}

function measure() {
	if (busy || !alexa || !entityId) return;
	busy = true;
	alexa.querySmarthomeDevices([entityId], 'ENTITY', function(err, res) {
		busy = false;
		if (err) return console.error('[alexa-remote] Abfrage:', err.message || err);
		const value = readTemperature((res && res.deviceStates) || []);
		if (value != null) {
			service.room_temperature = value;
			service.room_temperature_time = Date.now();
		}
	});
}

// ----------------------------------------------------------- Parser
function findTemperatureEntityId(deviceStates) {
	for (const dev of deviceStates) {
		if (readCapTemp(dev) != null) return dev.entity && dev.entity.entityId;
	}
	return null;
}

function readTemperature(deviceStates) {
	for (const dev of deviceStates) {
		const t = readCapTemp(dev);
		if (t != null) return t;
	}
	return null;
}

function readCapTemp(dev) {
	for (const capRaw of ((dev && dev.capabilityStates) || [])) {
		let cap; try { cap = JSON.parse(capRaw); } catch (e) { continue; }
		if (cap.namespace === 'Alexa.TemperatureSensor' && cap.name === 'temperature') {
			return (cap.value && cap.value.value != null) ? cap.value.value : null;
		}
	}
	return null;
}
// Holt aus dem Event, was DU gesagt hast + Alexas Antwort
function readActivity(act) {
	const d = (act && act.data) || {};
	const items = d.voiceHistoryRecordItems || [];
	let user = null, response = null;
	for (const it of items) {
		if (!it || !it.transcriptText) continue;
		if (it.recordItemType === 'CUSTOMER_TRANSCRIPT') user = it.transcriptText;
		else if (it.recordItemType === 'ALEXA_RESPONSE')  response = it.transcriptText;
	}
	return { user, response, intent: d.intent, domain: d.domain, type: d.utteranceType };
}

// ----------------------------------------------------------- Start
start();

// rtjscomp ruft das beim Reload/Disable -> Stoppansage + sauberer Stop
return function() {
	stop();
};
