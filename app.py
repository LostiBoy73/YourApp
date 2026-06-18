from flask import Flask, render_template, request, redirect, url_for
import sqlite3

app = Flask(__name__)

# Funktion zur Verbindung mit der SQLite-Datenbank
def get_db_connection():
    conn = sqlite3.connect('rezepte.db')
    conn.row_factory = sqlite3.Row # Aktiviert den Zugriff auf Spalten über Namen statt Nummern
    return conn

# Datenbank und Tabelle beim Start automatisch anlegen
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

# ROUTE 1: Startseite - Zeigt alle Rezepte an
@app.route('/')
def index():
    conn = get_db_connection()
    # Alle Rezepte aus der Datenbank abfragen
    rezepte = conn.execute('SELECT * FROM rezepte').fetchall()
    conn.close()
    # Wir übergeben die Rezepte an das HTML-Template
    return render_template('index.html', rezepte=rezepte)

# ROUTE 2: Seite für das Formular anzeigen
@app.route('/neu')
def neues_rezept():
    return render_template('neues_rezept.html')

# ROUTE 3: Formulardaten empfangen und in der DB speichern
@app.route('/speichern', methods=['POST'])
def speichern():
    # Daten aus dem HTML-Formular auslesen
    titel = request.form['titel']
    dauer = request.form['dauer']
    kategorie = request.form['kategorie']
    zutaten = request.form['zutaten']
    anleitung = request.form['anleitung']

    # In die Datenbank einfügen
    conn = get_db_connection()
    conn.execute('''
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung)
        VALUES (?, ?, ?, ?, ?)
    ''', (titel, dauer, kategorie, zutaten, anleitung))
    conn.commit()
    conn.close()

    # Nach dem Speichern zurück zur Startseite springen
    return redirect(url_for('index'))

if __name__ == '__main__':
    # Starte den Server im Debug-Modus (er startet bei Änderungen automatisch neu)
    app.run(debug=True)