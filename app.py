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
    
    # 1. Die alte Rezept-Tabelle erstellen
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

    # NEU: Danach (und außerhalb der Anführungszeichen!) die neue Spalte anhängen
    try:
        conn.execute('ALTER TABLE rezepte ADD COLUMN portionen INTEGER DEFAULT 1')
    except sqlite3.OperationalError:
        pass

    # 2. Die Tabelle für unsere Einkaufsliste
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
    portionen = request.form.get('portionen', 1)

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
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (titel, gesamt_dauer, kategorie_text, zutaten_text, anleitung_text, portionen))
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
    portionen = request.form.get('portionen', 1)

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
        SET titel = ?, dauer = ?, kategorie = ?, zutaten = ?, anleitung = ?, portionen = ?
        WHERE id = ?
    ''', (titel, gesamt_dauer, kategorie_text, zutaten_text, anleitung_text, portionen, id))
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

# ROUTE 9: Die Einkaufsliste anzeigen und Zutaten zusammenrechnen
@app.route('/einkaufsliste')
def einkaufsliste():
    conn = get_db_connection()
    eintraege = conn.execute('SELECT * FROM einkaufsliste').fetchall()
    conn.close()

    # 1. Enthaltene Rezepte sammeln (ohne Duplikate und ohne "Manuell")
    rezepte_set = set()
    for e in eintraege:
        if e['rezept_titel'] != 'Manuell':
            rezepte_set.add(e['rezept_titel'])
    enthaltene_rezepte = sorted(list(rezepte_set))

    # 2. Zutaten zusammenrechnen
    zutaten_dict = {}
    manuelle_eintraege = []

    for e in eintraege:
        if e['rezept_titel'] == 'Manuell':
            manuelle_eintraege.append(e)
            continue
        
        name = e['name'].strip().capitalize()
        einheit = e['einheit'].strip()
        menge_str = e['menge'].strip()
        
        # Eindeutiger Schlüssel aus Name und Einheit (z.B. "Mehl_g")
        key = f"{name}_{einheit.lower()}"
        
        if key not in zutaten_dict:
            zutaten_dict[key] = {
                'name': name, 'einheit': einheit, 'menge_zahl': 0.0, 'texte': []
            }
        
        # Versuchen, die Menge in eine Zahl umzuwandeln und zu addieren
        if menge_str:
            try:
                # Kommas durch Punkte ersetzen (für Dezimalzahlen wie 1,5)
                menge_float = float(menge_str.replace(',', '.'))
                zutaten_dict[key]['menge_zahl'] += menge_float
            except ValueError:
                # Wenn es Text ist (z.B. "etwas", "Prise"), heben wir den Text auf
                zutaten_dict[key]['texte'].append(menge_str)
    
    # 3. Aufbereiten für die Anzeige im HTML
    zusammengefasste_zutaten = []
    for daten in zutaten_dict.values():
        menge_anzeige = ""
        if daten['menge_zahl'] > 0:
            zahl = daten['menge_zahl']
            # Macht aus 2.0 eine glatte 2, aber lässt 2.5 stehen
            menge_anzeige = f"{int(zahl)}" if zahl.is_integer() else f"{zahl:.2f}".rstrip('0').rstrip('.')
        
        # Textmengen anhängen (z.B. "2 + etwas")
        if daten['texte']:
            texte_zusammen = " + ".join(daten['texte'])
            menge_anzeige = f"{menge_anzeige} + {texte_zusammen}" if menge_anzeige else texte_zusammen
        
        zusammengefasste_zutaten.append({
            'name': daten['name'], 'einheit': daten['einheit'], 'menge': menge_anzeige
        })
        
    # Alphabetisch nach Zutatennamen sortieren
    zusammengefasste_zutaten = sorted(zusammengefasste_zutaten, key=lambda x: x['name'])

    return render_template('einkaufsliste.html', 
                           rezepte=enthaltene_rezepte, 
                           zutaten=zusammengefasste_zutaten,
                           manuell=manuelle_eintraege)

# ROUTE 10: Ein komplettes Rezept (und damit seine Zutaten) von der Liste entfernen
@app.route('/einkaufsliste_entfernen_rezept', methods=['POST'])
def einkaufsliste_entfernen_rezept():
    titel = request.form['titel']
    conn = get_db_connection()
    # Löscht alle Zutaten, die zu diesem Rezeptnamen gehören
    conn.execute('DELETE FROM einkaufsliste WHERE rezept_titel = ?', (titel,))
    conn.commit()
    conn.close()
    return redirect(url_for('einkaufsliste'))

# ROUTE 11: Ein manuelles Freitext-Feld zur Liste hinzufügen
@app.route('/einkaufsliste_manuell', methods=['POST'])
def einkaufsliste_manuell():
    name = request.form['name']
    conn = get_db_connection()
    # Wir speichern es mit dem Platzhalter "Manuell", damit wir es später filtern können
    conn.execute('''
        INSERT INTO einkaufsliste (rezept_titel, menge, einheit, name)
        VALUES ('Manuell', '', '', ?)
    ''', (name,))
    conn.commit()
    conn.close()
    return redirect(url_for('einkaufsliste'))

# ROUTE 12: Manuellen Eintrag löschen
@app.route('/einkaufsliste_entfernen_manuell/<int:id>', methods=['POST'])
def einkaufsliste_entfernen_manuell(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM einkaufsliste WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return redirect(url_for('einkaufsliste'))

if __name__ == '__main__':
    # Starte den Server im Debug-Modus (er startet bei Änderungen automatisch neu)
    app.run(debug=True)