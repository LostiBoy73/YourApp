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
    conn.commit()
    conn.close()

init_db()

# ROUTE 1: Das neue Hauptmenü (Dashboard)
@app.route('/')
def index():
    return render_template('index.html')

# NEUE ROUTE: Die alte Rezept-Übersicht ist jetzt hier
@app.route('/rezepte')
def rezepte():
    conn = get_db_connection()
    rezepte_db = conn.execute('SELECT * FROM rezepte').fetchall()
    conn.close()
    return render_template('rezepte.html', rezepte=rezepte_db)

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
    dauer = request.form['dauer']
    kategorie = request.form['kategorie']

    # Die Liste der Schritte abfangen
    schritte = request.form.getlist('anleitung_schritt[]')
    
    # Leere Schritte rausfiltern und mit "|||" als Trennzeichen zusammenkleben
    schritte_liste = [s.strip() for s in schritte if s.strip()]
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
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung_text)
        VALUES (?, ?, ?, ?, ?)
    ''', (titel, dauer, kategorie, zutaten_text, anleitung))
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
    dauer = request.form['dauer']
    kategorie = request.form['kategorie']

    # Die Liste der Schritte abfangen
    schritte = request.form.getlist('anleitung_schritt[]')
    
    # Leere Schritte rausfiltern und mit "|||" als Trennzeichen zusammenkleben
    schritte_liste = [s.strip() for s in schritte if s.strip()]
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
        SET titel = ?, dauer = ?, kategorie = ?, zutaten = ?, anleitung_text = ?
        WHERE id = ?
    ''', (titel, dauer, kategorie, zutaten_text, anleitung, id))
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

if __name__ == '__main__':
    # Starte den Server im Debug-Modus (er startet bei Änderungen automatisch neu)
    app.run(debug=True)