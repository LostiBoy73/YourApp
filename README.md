# KochFlow

KochFlow ist eine mobile-first Rezept-Web-App zum Erstellen, Verwalten und Kochen von Rezepten.

Die App dient als digitales Rezeptbuch für den Browser. Nutzer können eigene Rezepte speichern, ausgewählte Rezepte öffentlich teilen, externe Rezeptideen importieren und Zutaten aus Rezepten automatisch in eine Einkaufsliste übernehmen.

## Funktionen

* Rezepte erstellen, bearbeiten und löschen
* Zutaten mit Menge und Einheit speichern
* Zubereitungsschritte mit optionaler Dauer erfassen
* Schritt-für-Schritt-Kochmodus
* private und öffentliche Rezepte
* öffentliche Rezepte im Community-Bereich anzeigen
* Rezepte zur Einkaufsliste hinzufügen
* gleiche Zutaten in der Einkaufsliste zusammenfassen
* manuelle Einkaufslisteneinträge ergänzen
* Rezepte suchen und filtern
* experimenteller Import externer Rezeptideen
* responsive Oberfläche für Smartphone und Desktop

## Tech Stack

### Frontend

* HTML
* CSS
* JavaScript
* GitHub Pages

### Backend

* Python
* FastAPI
* SQLite
* Uvicorn

## Architektur

Das Frontend wird als statische Web-App bereitgestellt und kommuniziert über HTTP-Anfragen mit einem separaten FastAPI-Backend.

```text
Browser
→ Statisches Frontend
→ REST-API
→ FastAPI-Backend
→ SQLite-Datenbank
```

Das Repository enthält das Frontend sowie eine Referenzimplementierung für das Backend.

## Lokale Frontend-Entwicklung

Das Frontend kann lokal über einen einfachen HTTP-Server gestartet werden.

```bash
python -m http.server 5500
```

Danach im Browser öffnen:

```text
http://localhost:5500/index.html
```

## Backend

Das Backend stellt API-Endpunkte für folgende Bereiche bereit:

* Authentifizierung
* Rezeptverwaltung
* öffentliche Rezepte
* Einkaufsliste
* Importfunktionen

Die SQLite-Datenbankdatei ist nicht Bestandteil des Repositories.

## Projektkontext

KochFlow wurde im Rahmen einer schulischen App-Challenge entwickelt. Neben der technischen Umsetzung standen auch Planung, Umsetzung, Testen und Reflexion des Entwicklungsprozesses im Fokus.

## Status

Prototyp in Entwicklung.
