# rtjscomp Alexa Service (alexa-remote-noai)

Dieser Service verbindet `rtjscomp` mit der Amazon Alexa Cloud über die Bibliothek `alexa-remote2`.
Er lädt Alexa-Accounts aus einer Konfiguration, verwaltet Cookies, sammelt Smarthome-Entitäten und kann Befehle wie `speak`, `turnOn` und `turnOff` ausführen.

## Dateien

- `alexa-remote-noai.service.js` - Hauptservice für Alexa-Verbindung und Smarthome-Geräte.
- `alexa-remote.service.js` - älterer Alexa-Service, hier zur Referenz verfügbar.
- `alexa-login.js` - Hilfs-Skript zum Einloggen und Speichern des Alexa-Cookies.
- `alexa-login.api`, `speak.api`, `temp.api` - API-Definitionen für das Webmodul.
- `speak.html` - Beispielseite zum Testen der Sprachausgabe.

## Voraussetzungen

- Node.js-Umgebung im `rtjscomp`-Projekt.
- Abhängigkeit `alexa-remote2` ist in `rtjscomp/package.json` definiert.
- Ein gültiges Alexa-Cookie muss vorhanden sein.

## Installation

1. Im `rtjscomp`-Projekt-Root:

```bash
npm install
```

2. Falls noch kein Alexa-Cookie vorhanden ist, starte `alexa-login.js` und führe die Anmeldung im Browser aus:

```bash
node public/web/alexa/alexa-login.js
```

3. Öffne die angezeigte Login-URL im Browser und melde dich bei Amazon an.

## Konfiguration

Der Service erwartet die Konfiguration in der Datei `data/alexa/config.json`.
Zusätzlich werden Account-Cookies in `data/alexa/account_<accountId>/secret_cookie.json` geladen.

Beispiel für `config.json`:

```json
{
  "accountIds": ["meinAccount"],
  "ALEXA_OPTS": {
    "proxyOwnIp": "127.0.0.1",
    "proxyPort": 8080,
    "amazonPage": "amazon.de",
    "alexaServiceHost": "alexa.amazon.de",
    "acceptLanguage": "de-DE"
  }
}
```

Hinweis: `ALEXA_OPTS` wird mit den Standardwerten im Service vermischt.

## Datenstruktur

Der Service nutzt folgende Pfade relativ zum Daten-Verzeichnis von `rtjscomp`:

- `data/alexa/config.json`
- `data/alexa/account_<accountId>/secret_cookie.json`

## Start des Services

Der Service wird beim Laden automatisch gestartet:

- `await load();`
- `await start();`
- Rückgabewert: `()=>stop()` zum Anhalten des Services.

Der Service startet alle konfigurierten Accounts, lädt Smarthome-Entitäten, speichert aktualisierte Cookies und ruft periodisch `save()` auf.

## Eingebaute Aktionen

- `speak(accountId, text)` - spielt einen Text über das erste Gerät mit `AUDIO_PLAYER`-Capability ab.
- `sendCommand(accountId, entityId, command, value)` - unterstützt:
  - `speak`
  - `turnOn`
  - `turnOff`

## Verfügbare Utility-Funktionen

Der Service stellt mehrere Helfer bereit, mit denen du Accounts und Entities filtern oder prüfen kannst. Diese Funktionen machen es einfach, eigene Automationen und UI-Features zu bauen:

- `hasAccount(accountId)` - prüft, ob der angegebene Account geladen ist.
- `getAccount(accountId)` - gibt das Account-Objekt zurück oder wirft einen Fehler, wenn es nicht existiert.
- `hasAccountEntity(accountId, entityId)` - prüft, ob ein Account eine bestimmte Entity-ID hat.
- `getAccountEntity(accountId, entityId)` - gibt die Entity-Daten für eine bestimmte Entity zurück.
- `hasAccountEntityBy(accountId, entityKey, entityValue)` - prüft, ob ein Account eine Entity mit einem bestimmten Feldwert enthält.
- `getAccountEntityBy(accountId, entityKey, entityValue)` - gibt die erste Entity zurück, die ein bestimmtes Feld erfüllt.
- `filterAccountEntityByData(accountId, entityDataNamespace)` - gibt alle Entity-IDs zurück, die Daten im angegebenen Namespace enthalten.
- `filterAccountEntityByCapability(accountId, entityCapability)` - gibt alle Entity-IDs zurück, die eine bestimmte Capability unterstützen.
- `findEntity(entityId)` - sucht eine Entity-ID über alle Accounts hinweg und gibt das Entity-Objekt zurück.

## Zugriff auf `svr.accounts`

Der Service exponiert das Objekt `svr.accounts`, das folgende Struktur enthält:

- `svr.accounts[accountId].alexa` - die Alexa-Remote-Instanz für den Account
- `svr.accounts[accountId].cookie` - gespeichertes Cookie-Objekt
- `svr.accounts[accountId].entities` - Array aller geladenen Entities
- `svr.accounts[accountId].entityIds` - Array der Entity-IDs
- `svr.accounts[accountId].ready` - Statusflag, ob der Account bereit ist

Damit kannst du eigene Service-Logik direkt auf Account- und Entity-Ebene anknüpfen.

## Verhalten beim Start

Beim erfolgreichen Verbindungsaufbau führt der Service aktuell folgende Tests aus:

- Ausgabe von Temperatur-Sensorwerten
- `speak(accountId, "RTJSCOMP Service gestartet!")`
- Versucht `turnOn` auf dem Gerät mit `displayName` "Lichterkette"

> Achtung: Dieser letzte Test kann reale Smarthome-Geräte schalten.

## Fehleranalyse

- Fehlende `config.json` führt zum Abbruch mit einer Fehlermeldung.
- Cookie-Änderungen werden automatisch in `secret_cookie.json` gespeichert.
- Gerätedaten werden bei jedem Start und bei Nutzung von `refreshEntitiesFullStructure` aktualisiert.

## Hinweise

- `proxyPort` und `proxyOwnIp` sollten passend zum lokalen Netzwerk eingestellt werden.
- Der Service nutzt `proxyOnly: true`, um den Login-Flow lokal zu kapseln.
- Wenn du den Service anpassen willst, prüfe insbesondere `onAlexaAccountConnected` und die Test-Aufrufe im Startprozess.
