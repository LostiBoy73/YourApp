import os
from flask import Flask, render_template, request, redirect, url_for
import sqlite3

app = Flask(__name__)

# --- Absoluter Pfad zur Datenbank ---
# Das garantiert, dass der Server die Datei immer im richtigen Projektordner sucht
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'rezepte.db')

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row 
    return conn

def init_db():
    conn = get_db_connection()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS rezepte (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titel TEXT NOT NULL,
            dauer INTEGER,
            kategorie TEXT,
            zutaten TEXT,
            anleitung TEXT
        )
    ''')

    # 2. NEU: Die Tabelle für unsere Einkaufsliste
    conn.execute('''
        CREATE TABLE IF NOT EXISTS einkaufsliste (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rezept_titel TEXT,
            menge TEXT,
            einheit TEXT,
            name TEXT
        )
    ''')
    conn.commit()
    conn.close()

init_db()

# ROUTE 1: Das neue Hauptmenü (Dashboard)
@app.route('/')
def index():
    return render_template('index.html')

# NEUE ROUTE: Die Rezept-Übersicht inkl. Filter- und Suchfunktion
@app.route('/rezepte')
def rezepte():
    # 1. Suchbegriffe aus der URL auslesen (Standard ist leer)
    suchbegriff = request.args.get('suche', '').lower()
    kategorie_filter = request.args.get('kategorie', '')

    conn = get_db_connection()
    alle_rezepte = conn.execute('SELECT * FROM rezepte').fetchall()
    conn.close()

    # 2. Alle einzigartigen Kategorien für das Dropdown sammeln
    alle_kategorien = set() # Ein 'set' in Python verhindert automatisch Duplikate
    for r in alle_rezepte:
        if r['kategorie']:
            # Wir säubern die Tags und schreiben sie groß
            tags = [k.strip().capitalize() for k in r['kategorie'].split(',') if k.strip()]
            alle_kategorien.update(tags)
    
    # Die gesammelten Kategorien alphabetisch sortieren
    kategorien_liste = sorted(list(alle_kategorien))

    # 3. Rezepte filtern
    gefilterte_rezepte = []
    for r in alle_rezepte:
        treffer_suche = True
        treffer_kategorie = True

        # Wenn ein Suchbegriff eingegeben wurde: Prüfen, ob er im Titel steckt (z.B. "pizza" in "Pizzaschnecken")
        if suchbegriff:
            if suchbegriff not in r['titel'].lower():
                treffer_suche = False
        
        # Wenn eine Kategorie ausgewählt wurde: Prüfen, ob das Rezept diesen Tag hat
        if kategorie_filter:
            if r['kategorie']:
                tags = [k.strip().capitalize() for k in r['kategorie'].split(',') if k.strip()]
                if kategorie_filter not in tags:
                    treffer_kategorie = False
            else:
                treffer_kategorie = False # Wenn das Rezept gar keine Kategorie hat, ist es kein Treffer

        # Nur wenn das Rezept BEIDE Bedingungen erfüllt, wird es angezeigt
        if treffer_suche and treffer_kategorie:
            gefilterte_rezepte.append(r)

    # Wir übergeben die gefilterten Rezepte UND die Filter-Auswahl an das HTML-Template
    return render_template('rezepte.html', 
                           rezepte=gefilterte_rezepte, 
                           alle_kategorien=kategorien_liste,
                           aktuelle_suche=suchbegriff,
                           aktuelle_kategorie=kategorie_filter)

# ROUTE 7: Detailansicht eines einzelnen Rezepts (Guided Cooking)
@app.route('/rezept/<int:id>')
def rezept_detail(id):
    conn = get_db_connection()
    # Wir suchen genau das Rezept mit der angeklickten ID
    rezept = conn.execute('SELECT * FROM rezepte WHERE id = ?', (id,)).fetchone()
    conn.close()
    
    # Falls jemand eine ID eingibt, die es nicht gibt, schicken wir ihn zurück
    if rezept is None:
        return redirect(url_for('rezepte'))
        
    return render_template('rezept_detail.html', rezept=rezept)

# ROUTE 2: Seite für das Formular anzeigen (mit dynamischem Zurück-Button)
@app.route('/neu')
def neues_rezept():
    # Wir lesen den 'von'-Parameter aus der URL aus. 
    # Wenn jemand die Seite direkt aufruft (ohne Parameter), nehmen wir standardmäßig 'rezepte'
    von_wo = request.args.get('von', 'rezepte')
    
    # Wir übergeben die Info an das HTML-Template
    return render_template('neues_rezept.html', von_wo=von_wo)

# ROUTE 3: Formulardaten empfangen und in der DB speichern
@app.route('/speichern', methods=['POST'])
def speichern():
    titel = request.form['titel']

    # Die Liste der Kategorien abfangen
    kategorien = request.form.getlist('kategorie[]')
    
    # Leere Felder ignorieren und mit Komma getrennt zusammenkleben
    kategorien_liste = [k.strip() for k in kategorien if k.strip()]
    kategorie_text = ", ".join(kategorien_liste)

    # Die Liste der Schritte UND Dauern abfangen
    schritte = request.form.getlist('anleitung_schritt[]')
    dauern = request.form.getlist('anleitung_dauer[]')
    
    schritte_liste = []
    gesamt_dauer = 0
    
    for i in range(len(schritte)):
        text = schritte[i].strip()
        if text:
            # Zeit abfangen. Wenn nichts eingetragen wurde, nehmen wir 0
            zeit = dauern[i] if i < len(dauern) and dauern[i] else "0"
            gesamt_dauer += int(zeit)
            # Format speichern: Zeit:::Text
            schritte_liste.append(f"{zeit}:::{text}")
            
    anleitung_text = "|||".join(schritte_liste)

    # NEU: Die Listen der dynamischen Felder abfangen
    mengen = request.form.getlist('zutaten_menge[]')
    einheiten = request.form.getlist('zutaten_einheit[]')
    namen = request.form.getlist('zutaten_name[]')

    # Wir bauen die Zutaten zu einem strukturierten Text zusammen.
    # Beispiel: "250|g|Mehl" pro Zeile
    zutaten_liste = []
    for i in range(len(namen)):
        if namen[i].strip(): # Nur speichern, wenn der Name nicht leer ist
            menge = mengen[i] if mengen[i] else ""
            einheit = einheiten[i] if einheiten[i] else ""
            # Wir trennen Menge, Einheit und Name mit einem senkrechten Strich |
            zutaten_liste.append(f"{menge}|{einheit}|{namen[i]}")
    
    # Alle Zutaten-Zeilen werden mit einem echten Zeilenumbruch (\n) verbunden
    zutaten_text = "\n".join(zutaten_liste)

    
    conn = get_db_connection()
    conn.execute('''
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung)
        VALUES (?, ?, ?, ?, ?)
    ''', (titel, gesamt_dauer, kategorie_text, zutaten_text, anleitung_text))
    conn.commit()
    conn.close()

    return redirect(url_for('rezepte'))

# ROUTE 4: Seite zum Bearbeiten eines bestimmten Rezepts anzeigen
@app.route('/bearbeiten/<int:id>')
def bearbeiten(id):
    conn = get_db_connection()
    # Hole genau das eine Rezept, das die angeklickte ID hat
    rezept = conn.execute('SELECT * FROM rezepte WHERE id = ?', (id,)).fetchone()
    conn.close()
    # Wir übergeben das gefundene Rezept an ein neues HTML-Template
    return render_template('bearbeiten.html', rezept=rezept)

# ROUTE 5: Die korrigierten Daten in der Datenbank überschreiben
@app.route('/aktualisieren/<int:id>', methods=['POST'])
def aktualisieren(id):
    titel = request.form['titel']

    # Die Liste der Kategorien abfangen
    kategorien = request.form.getlist('kategorie[]')
    
    # Leere Felder ignorieren und mit Komma getrennt zusammenkleben
    kategorien_liste = [k.strip() for k in kategorien if k.strip()]
    kategorie_text = ", ".join(kategorien_liste)

    # Die Liste der Schritte UND Dauern abfangen
    schritte = request.form.getlist('anleitung_schritt[]')
    dauern = request.form.getlist('anleitung_dauer[]')
    
    schritte_liste = []
    gesamt_dauer = 0
    
    for i in range(len(schritte)):
        text = schritte[i].strip()
        if text:
            # Zeit abfangen. Wenn nichts eingetragen wurde, nehmen wir 0
            zeit = dauern[i] if i < len(dauern) and dauern[i] else "0"
            gesamt_dauer += int(zeit)
            # Format speichern: Zeit:::Text
            schritte_liste.append(f"{zeit}:::{text}")
            
    anleitung_text = "|||".join(schritte_liste)

    # NEU: Auch beim Bearbeiten die Listen der Zutaten abfangen
    mengen = request.form.getlist('zutaten_menge[]')
    einheiten = request.form.getlist('zutaten_einheit[]')
    namen = request.form.getlist('zutaten_name[]')

    # Zutaten wieder zu einem Text zusammenbauen
    zutaten_liste = []
    for i in range(len(namen)):
        if namen[i].strip():
            menge = mengen[i] if mengen[i] else ""
            einheit = einheiten[i] if einheiten[i] else ""
            zutaten_liste.append(f"{menge}|{einheit}|{namen[i]}")
    
    zutaten_text = "\n".join(zutaten_liste)

    conn = get_db_connection()
    conn.execute('''
        UPDATE rezepte
        SET titel = ?, dauer = ?, kategorie = ?, zutaten = ?, anleitung = ?
        WHERE id = ?
    ''', (titel, gesamt_dauer, kategorie_text, zutaten_text, anleitung_text, id))
    conn.commit()
    conn.close()

    return redirect(url_for('rezepte'))

# ROUTE 6: Ein komplettes Rezept löschen
@app.route('/loeschen/<int:id>', methods=['POST'])
def loeschen(id):
    conn = get_db_connection()
    # SQL DELETE löscht die gesamte Zeile mit dieser ID
    conn.execute('DELETE FROM rezepte WHERE id = ?', (id,))
    conn.commit()
    conn.close()

    # Danach zurück zur Startseite
    return redirect(url_for('rezepte'))

# ROUTE 8: Zutaten eines Rezepts auf die Einkaufsliste setzen
@app.route('/einkaufsliste_hinzufuegen/<int:id>', methods=['POST'])
def einkaufsliste_hinzufuegen(id):
    conn = get_db_connection()
    rezept = conn.execute('SELECT * FROM rezepte WHERE id = ?', (id,)).fetchone()
    
    if rezept and rezept['zutaten']:
        # Wir gehen jede gespeicherte Zutat durch
        for zeile in rezept['zutaten'].split('\n'):
            if zeile.strip():
                zutat_daten = zeile.split('|')
                
                # Neues Format (3 Teile)
                if len(zutat_daten) == 3:
                    menge = zutat_daten[0]
                    einheit = zutat_daten[1]
                    name = zutat_daten[2]
                # Altes Format (Fallback)
                else:
                    menge = ""
                    einheit = ""
                    name = zeile
                
                # Jede Zutat kommt als einzelne Zeile in die Einkaufsliste
                conn.execute('''
                    INSERT INTO einkaufsliste (rezept_titel, menge, einheit, name)
                    VALUES (?, ?, ?, ?)
                ''', (rezept['titel'], menge, einheit, name))
                
    conn.commit()
    conn.close()
    
    # Wir schicken den Nutzer zurück zur Detailseite, geben aber ein heimliches "?erfolg=1" in der URL mit
    return redirect(url_for('rezept_detail', id=id, erfolg=1))

if __name__ == '__main__':
    # Starte den Server im Debug-Modus (er startet bei Änderungen automatisch neu)
    app.run(debug=True)