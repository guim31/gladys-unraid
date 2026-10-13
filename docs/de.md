# Unraid

[Unraid](https://unraid.net/) ist das Betriebssystem vieler NAS und
Heimserver: ein Array aus Festplatten, durch Parität geschützt, dazu
Docker-Container und virtuelle Maschinen. Diese Integration liest deinen
Unraid-Server über seine **offizielle API** und bringt ihn in Gladys: den Server
selbst und die Festplatten, Container, VMs und die USV, die du auswählst.
Szenen können reagieren, wenn eine Festplatte ausfällt oder zu heiß wird, eine
Paritätsprüfung endet, ein Container stoppt oder Unraid eine Benachrichtigung
veröffentlicht; sie können einen Container oder eine VM starten, stoppen oder
neu starten. Ein Widget fasst den Server auf dem Dashboard zusammen. Alles
bleibt in deinem lokalen Netzwerk.

**Entwickelt ohne Zugriff auf einen echten Unraid-Server**: aufgebaut auf dem
offiziellen API-Schema und gegen einen simulierten Server getestet. Feedback ist
willkommen in [den Issues](https://github.com/guim31/gladys-unraid/issues).

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- Unraid **7.2 oder neuer**: Die API ist eingebaut. Unraid 6.x hat diese API
  nicht und wird nicht unterstützt; Unraid 7.0 und 7.1 funktionieren eventuell
  mit dem Plugin Unraid Connect, ungetestet.
- Den Unraid-Server, erreichbar vom Gladys-Rechner aus (die Adresse seiner
  Weboberfläche).

Das Lesen des Servers **weckt nie eine Festplatte im Standby**: Die Temperaturen
stammen aus dem, was Unraid schon weiß, und eine schlafende Festplatte hat
einfach keine.

## Erste Schritte

### 1. Einen API-Schlüssel erstellen

In der Weboberfläche von Unraid: **Settings → Management Access → API Keys →
Create**. Gib ihm einen Namen (`Gladys`) und:

- die Rolle **Viewer**, um den Server zu überwachen (nur Lesen);
- um Container und VMs aus Gladys zu starten, zu stoppen und neu zu starten,
  zusätzlich die Rechte **Docker** und **VMs** mit der Aktion „update“. Ohne
  sie lehnt Unraid jeden Befehl ab, und Gladys sagt es dir.

Kopiere den Schlüssel: Unraid zeigt ihn nur einmal an.

### 2. Die Integration konfigurieren

In Gladys, **Integrationen → Unraid → Konfiguration**:

- **Adresse**: die Adresse der Unraid-Weboberfläche, wie im Browser
  (`192.168.1.10`, `tower.local`, `https://192.168.1.10`). Die Integration
  folgt den „Use SSL/TLS“-Weiterleitungen von Unraid: zu HTTPS unter derselben
  Adresse oder zu deiner `myunraid.net`-Adresse.
- **API-Schlüssel**: der oben erstellte Schlüssel.
- **Name** (optional): der Name des Servers in Gladys; leer, der Name des
  Unraid-Servers.
- **Selbstsignierte Zertifikate akzeptieren**: aktivieren, wenn „Use SSL/TLS“
  in Unraid auf „Yes“ steht (sein Zertifikat ist selbstsigniert).
- **Aktualisierungsintervall**: 15 Sekunden bis 5 Minuten (standardmäßig
  1 Minute).
- **Sprache der Namen und Texte**: die Namen der Funktionen, die Zustandstexte
  und die Texte der Szenen-Ereignisse (standardmäßig Französisch).

Speichern, dann **Verbindung testen**: Der Server wird gelesen und die
Integration meldet, was sie findet (Unraid-Version, Festplatten, Container,
VMs, USV).

### 3. Die Geräte hinzufügen

Öffne den Reiter **Entdecken** der Integration: Der Server, seine Festplatten,
seine Container, seine VMs und seine USV sind dort aufgelistet. Füge die hinzu,
die du verfolgen willst; die anderen bleiben außerhalb von Gladys (die
Szenen-Auslöser überwachen sie trotzdem).

## Die Geräte

### Der Server

| Funktion                        | Wert                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| Online                          | 1, solange Unraid antwortet, 0 nach zwei fehlgeschlagenen Abfragen  |
| Prozessor                       | Prozessorauslastung, %                                              |
| Arbeitsspeicher                 | belegter Speicher (ohne Cache), %                                   |
| Prozessortemperatur             | der heißeste Prozessor, °C                                          |
| Laufzeit                        | Tage seit dem letzten Start                                         |
| Array gestartet                 | 1 gestartet, 0 gestoppt                                             |
| Array-Status                    | Text: „Gestartet“, „Gestoppt“, „Gestartet · Paritätsprüfung 45 %“ … |
| Belegter Array-Speicher         | %                                                                   |
| Freier Array-Speicher           | Terabyte                                                            |
| Fortschritt der Paritätsprüfung | % während einer Prüfung, eines Wiederaufbaus oder Löschens, sonst 0 |
| Paritätsfehler                  | Fehler der laufenden oder letzten Prüfung                           |
| Auffällige Festplatten          | Festplatten, die nicht „normal“ sind oder Lesefehler haben          |
| Ungelesene Warnungen            | ungelesene Unraid-Benachrichtigungen der Stufe Alarm oder Warnung   |
| Container-Updates               | Container mit einem neueren Image                                   |
| Unraid-Version                  | Text                                                                |

Eine Funktion, die der Server nicht liefern kann (ältere API, kein
Prozessorsensor), wird nicht angelegt.

### Festplatten

Ein Gerät pro Steckplatz des Arrays: Parität, Datenfestplatten,
Pool-Festplatten (Cache). Das Gerät folgt dem Steckplatz (`Disk 3`), wie Unraid:
Eine ersetzte Festplatte behält ihr Gerät und ihren Verlauf.

| Funktion          | Wert                                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| Temperatur        | °C, solange die Festplatte dreht; nichts im Standby                        |
| Im Standby        | 1 schläft, 0 dreht (nur Festplatten mit Drehteller)                        |
| Belegter Speicher | % (nicht bei Paritätsfestplatten)                                          |
| Freier Speicher   | Gigabyte (nicht bei Paritätsfestplatten)                                   |
| Fehler            | Lesefehler, die Unraid seit dem letzten Start zählt                        |
| Status            | Text: „Normal“, „Deaktiviert“, „Fehlt“, „Emuliert“, „Falsche Festplatte“ … |

### Container

Ein Gerät pro Docker-Container, nach dem Container benannt (seine Identität:
Ein Update erstellt den Container neu und behält das Gerät).

| Funktion         | Wert                                                       |
| ---------------- | ---------------------------------------------------------- |
| Läuft            | Schalter: an startet den Container, aus stoppt ihn         |
| Update verfügbar | 1, wenn ein neueres Image existiert (Prüfung durch Unraid) |

Die Container von Gladys selbst (Gladys und ihre Integrationen) sind nur
lesbar: Gladys stoppt sich hier nie selbst. Prozessor und Speicher pro
Container liefert die API nur über eine dauerhafte Verbindung: nicht
unterstützt.

### Virtuelle Maschinen

| Funktion | Wert                                                                           |
| -------- | ------------------------------------------------------------------------------ |
| Läuft    | Schalter: an startet die VM, aus fährt sie sauber herunter (Einschaltknopf)    |
| Zustand  | Text: „Läuft“, „Gestoppt“, „Pausiert“, „Wird heruntergefahren“, „Abgestürzt“ … |

Eine VM auszuschalten bittet ihr Betriebssystem herunterzufahren, wie der
Einschaltknopf: nie ein erzwungener Stopp. Eine VM, die das ignoriert, läuft
weiter.

### USV

Wenn Unraid eine USV verwaltet (Settings → UPS Settings):

| Funktion         | Wert                                       |
| ---------------- | ------------------------------------------ |
| Akku             | Ladung, %                                  |
| Restlaufzeit     | Minuten im Akkubetrieb                     |
| Last             | %                                          |
| Im Akkubetrieb   | 1 im Akkubetrieb, 0 am Netz                |
| Leistung         | aufgenommene Watt, wenn die USV sie meldet |
| Eingangsspannung | Volt                                       |
| Status           | Text der USV („ONLINE“ …)                  |

## Dashboard

Das Widget **Unraid** zeigt den Server auf einen Blick: Prozessor, Speicher und
belegter Array-Speicher, dann eine Liste mit zuerst dem, was Aufmerksamkeit
braucht (eine Festplatte mit Problemen, eine Festplatte, die Unraid für voll
hält, eine warme Festplatte, ein Container mit Autostart, der nicht läuft, die
USV im Akkubetrieb, ungelesene Warnungen), dann das Array, die letzte
Paritätsprüfung, die Festplatten, die Container, die VMs, die USV und die
Container-Updates.

Wähle in seinen Einstellungen einen Container oder eine VM, um deren Tasten zu
bekommen: **Starten**, **Stoppen** und **Neu starten** (nur Container); Stoppen
und Neu starten fragen nach. Ohne Auswahl liest eine Taste **Aktualisieren** den
Server neu.

## Szenen

### Auslöser

- **Unraid-Festplatte mit Fehler**: Eine Festplatte des Arrays wird deaktiviert,
  fehlt oder wird emuliert, oder ihre Lesefehler steigen. Filter: eine
  Festplatte (leer: beliebig). Weitergegebene Informationen: Servername, Name
  der Festplatte, Status der Festplatte, Lesefehler.
- **Unraid-Festplatte zu heiß**: Eine Festplatte erreicht die gewählte
  Temperatur (40 bis 70 °C), bei zwei Abfragen in Folge; erneut gemeldet, wenn
  sie 3 °C darunter abgekühlt ist, und nicht zweimal innerhalb von 30 Minuten.
  Eine schlafende Festplatte wird dafür nie geweckt. Weitergegebene
  Informationen: Servername, Name der Festplatte, Temperatur, Schwelle.
- **Unraid-Paritätsprüfung beendet**: Eine Paritätsprüfung, ein Wiederaufbau
  oder das Löschen einer Festplatte ist beendet. Filter: das Ergebnis (ohne
  Fehler, mit Fehlern, vorzeitig gestoppt). Weitergegebene Informationen:
  Servername, Ergebnis, gefundene Fehler, Dauer in Minuten, Vorgang. Eine
  Prüfung, die endet, während Gladys gestoppt ist, wird bei der nächsten Abfrage
  gemeldet.
- **Unraid-Container gestoppt**: Ein laufender Container wurde gestoppt oder
  entfernt, bei zwei Abfragen in Folge und seit mindestens einer Minute (ein Update
  erstellt ihn in Sekunden neu), und nicht durch Gladys. Filter: ein Container (leer: beliebig).
  Weitergegebene Informationen: Servername, Name des Containers, Zustand.
- **Unraid-Benachrichtigung**: Unraid hat eine neue Benachrichtigung
  veröffentlicht (SMART-Warnungen, Temperaturen, Array-Ereignisse, Updates, eine
  fast volle Festplatte …). Filter: die Wichtigkeit (Alarm, Warnung,
  Information; leer: beliebig). Weitergegebene Informationen: Servername,
  Wichtigkeit, Titel, Betreff, Beschreibung. Die beim Start der Integration
  vorhandenen Benachrichtigungen werden nicht gemeldet.

Zustände und Temperaturen der Festplatten sind auch Funktionen: Für eine eigene
Schwelle nutze eine Bedingung auf die Funktion.

### Aktionen

- **Unraid-Container steuern**: startet, stoppt oder startet einen Container neu.
  Ausgabe: der Name des Containers.
- **Unraid-VM steuern**: startet eine VM oder fährt sie sauber herunter.
  Ausgabe: der Name der VM.
- **Zustand des Unraid-Servers**: liest den Server für die nächsten Aktionen.
  Ausgaben: antwortet (ja/nein), eine fertige Zusammenfassung („Array:
  Gestartet. 6 Festplatte(n) OK. 12/14 Container laufen.“), Array-Status,
  auffällige Festplatten, Prozessor, Arbeitsspeicher, laufende Container,
  ungelesene Warnungen.

Nichts stoppt das Array oder den Server aus Gladys: zu riskant für eine Szene
oder einen Sprachbefehl. Nutze dafür die Oberfläche von Unraid.

### Szenen-Ideen

- **Paritätsprüfung beendet** mit Fehlern → schick dir eine Nachricht:
  „Paritätsprüfung: {Fehler} Fehler in {Dauer} Minuten“.
- **Unraid-Benachrichtigung**, Wichtigkeit Alarm → eine Benachrichtigung auf dein
  Handy mit ihrem Betreff.
- Jede Nacht um 4 Uhr → **Unraid-Container steuern**: den Container neu starten,
  der es braucht (ein hängender Medienserver, ein VPN).
- **Unraid-Festplatte zu heiß**, 50 °C → den Lüfter des Schranks einschalten.
- Jeden Morgen → **Zustand des Unraid-Servers**, dann seine Zusammenfassung
  senden.

## Fehlerbehebung

- **„API-Schlüssel abgelehnt“**: Der Schlüssel wurde gelöscht oder falsch
  kopiert. Erstelle einen neuen in Settings → Management Access → API Keys.
- **„Keine Unraid-API unter dieser Adresse“**: Unraid älter als 7.2 (ohne das
  Plugin Unraid Connect) oder die Adresse eines anderen Dienstes.
- **„Die Unraid-API antwortet nicht“**: Die Weboberfläche antwortet, aber nicht
  die API dahinter: Unraid startet gerade oder die API ist gestoppt
  (`unraid-api restart` in einem Terminal).
- **„Zertifikat abgelehnt“**: „Use SSL/TLS“ steht auf „Yes“: Aktiviere
  „Selbstsignierte Zertifikate akzeptieren“.
- **„Dein DNS blockiert myunraid.net“**: Mit „Use SSL/TLS“ auf „Strict“ leitet
  Unraid auf eine `myunraid.net`-Adresse um, die viele Router blockieren (Schutz
  vor DNS-Rebinding). Gib `https://` und die IP des Servers ein und aktiviere
  „Selbstsignierte Zertifikate akzeptieren“; oder erlaube `myunraid.net` in
  deinem Router.
- **Ein Befehl wird abgelehnt**: Gib dem API-Schlüssel die Rechte Docker und
  VMs.
- **Keine Temperatur für eine Festplatte**: Die Festplatte schläft; die Temperatur kommt
  zurück, wenn sie dreht.
- **Ein Gerät zeigt „Aktualisieren“ in Entdecken**: Eine Funktion ist
  hinzugekommen (eine erste Paritätsprüfung, ein neues Feld der API).
  Aktualisiere es, um sie zu bekommen.

## Grenzen

- Ein Unraid-Server pro Installation.
- Abfrage alle 15 Sekunden bis 5 Minuten: Eine Änderung erscheint bei der
  nächsten Abfrage.
- Kein Prozessor und Speicher pro Container (die API liefert sie nur über eine
  dauerhafte Verbindung), kein Netzwerkverkehr, keine Freigaben.
- Updates von Unraid selbst meldet die API nicht: nur die der Container.
- Die Integration speichert in `/data` nur, womit die Szenen-Auslöser
  vergleichen (Zustände der Festplatten, laufend gesehene Container, die
  laufende Paritätsoperation, bereits gemeldete Benachrichtigungen), und die
  Funktionen jedes Geräts; der API-Schlüssel bleibt in der Konfiguration von
  Gladys und wird nie protokolliert.
- Nicht mit Lime Technology, Inc. verbunden. Unraid ist eine Marke von Lime
  Technology, Inc.
