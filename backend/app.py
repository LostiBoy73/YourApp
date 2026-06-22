import os
import sqlite3
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
# Erlaubt deinem Frontend auf GitHub Pages, mit diesem Backend zu kommunizieren!
CORS(app) 

# --- Absoluter Pfad zur Datenbank ---
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
    try:
        conn.execute('ALTER TABLE rezepte ADD COLUMN portionen INTEGER DEFAULT 1')
    except sqlite3.OperationalError:
        pass

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

# ==========================================
# API ROUTEN FÜR REZEPTE
# ==========================================

@app.route('/api/rezepte', methods=['GET'])
def api_rezepte():
    suchbegriff = request.args.get('suche', '').strip()
    kategorie_filter = request.args.get('kategorie', '')
    
    conn = get_db_connection()
    rezepte = conn.execute('SELECT * FROM rezepte').fetchall()
    
    gefilterte_rezepte = []
    kategorien_set = set()
    
    for r in rezepte:
        if r['kategorie']:
            for kat in r['kategorie'].split(','):
                if kat.strip():
                    kategorien_set.add(kat.strip().capitalize())
                    
        treffer_suche = not suchbegriff or suchbegriff.lower() in r['titel'].lower()
        treffer_kat = not kategorie_filter or kategorie_filter.lower() in r['kategorie'].lower()
        
        if treffer_suche and treffer_kat:
            gefilterte_rezepte.append(dict(r))
            
    conn.close()
    
    return jsonify({
        'rezepte': gefilterte_rezepte,
        'kategorien': sorted(list(kategorien_set))
    })

@app.route('/api/rezepte/<int:id>', methods=['GET'])
def api_rezept_detail(id):
    conn = get_db_connection()
    rezept = conn.execute('SELECT * FROM rezepte WHERE id = ?', (id,)).fetchone()
    conn.close()
    
    if rezept is None:
        return jsonify({'error': 'Rezept nicht gefunden'}), 404
        
    return jsonify(dict(rezept))

@app.route('/api/rezepte', methods=['POST'])
def api_speichern():
    titel = request.form.get('titel', '')
    portionen = request.form.get('portionen', 1)

    kategorien = request.form.getlist('kategorie[]')
    kategorie_text = ", ".join([k.strip() for k in kategorien if k.strip()])

    schritte = request.form.getlist('anleitung_schritt[]')
    dauern = request.form.getlist('anleitung_dauer[]')
    schritte_liste = []
    gesamt_dauer = 0
    for i in range(len(schritte)):
        text = schritte[i].strip()
        if text:
            zeit = dauern[i].strip() if i < len(dauern) and dauern[i].strip() else "0"
            gesamt_dauer += int(zeit)
            schritte_liste.append(f"{zeit}:::{text}")
    anleitung_text = "|||".join(schritte_liste)

    mengen = request.form.getlist('zutaten_menge[]')
    einheiten = request.form.getlist('zutaten_einheit[]')
    namen = request.form.getlist('zutaten_name[]')
    zutaten_liste = []
    for i in range(len(namen)):
        if namen[i].strip():
            menge = mengen[i].strip() if i < len(mengen) and mengen[i] else ""
            einheit = einheiten[i].strip() if i < len(einheiten) and einheiten[i] else ""
            zutaten_liste.append(f"{menge}|{einheit}|{namen[i]}")
    zutaten_text = "\n".join(zutaten_liste)

    conn = get_db_connection()
    cursor = conn.execute('''
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (titel, gesamt_dauer, kategorie_text, zutaten_text, anleitung_text, portionen))
    neue_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'id': neue_id})

@app.route('/api/rezepte/<int:id>', methods=['PUT', 'POST'])
def api_aktualisieren(id):
    # Funktioniert exakt wie Speichern, aber mit UPDATE
    titel = request.form.get('titel', '')
    portionen = request.form.get('portionen', 1)
    kategorien = request.form.getlist('kategorie[]')
    kategorie_text = ", ".join([k.strip() for k in kategorien if k.strip()])

    schritte = request.form.getlist('anleitung_schritt[]')
    dauern = request.form.getlist('anleitung_dauer[]')
    schritte_liste = []
    gesamt_dauer = 0
    for i in range(len(schritte)):
        text = schritte[i].strip()
        if text:
            zeit = dauern[i].strip() if i < len(dauern) and dauern[i].strip() else "0"
            gesamt_dauer += int(zeit)
            schritte_liste.append(f"{zeit}:::{text}")
    anleitung_text = "|||".join(schritte_liste)

    mengen = request.form.getlist('zutaten_menge[]')
    einheiten = request.form.getlist('zutaten_einheit[]')
    namen = request.form.getlist('zutaten_name[]')
    zutaten_liste = []
    for i in range(len(namen)):
        if namen[i].strip():
            menge = mengen[i].strip() if i < len(mengen) and mengen[i] else ""
            einheit = einheiten[i].strip() if i < len(einheiten) and einheiten[i] else ""
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

    return jsonify({'success': True})

@app.route('/api/rezepte/<int:id>', methods=['DELETE'])
def api_loeschen(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM rezepte WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


# ==========================================
# API ROUTEN FÜR EINKAUFSLISTE
# ==========================================

@app.route('/api/einkaufsliste', methods=['GET'])
def api_einkaufsliste_abrufen():
    conn = get_db_connection()
    eintraege = conn.execute('SELECT * FROM einkaufsliste').fetchall()
    conn.close()

    rezepte_set = set()
    manuelle_eintraege = []
    zutaten_dict = {}

    for e in eintraege:
        if e['rezept_titel'] == 'Manuell':
            manuelle_eintraege.append(dict(e))
            continue
        
        rezepte_set.add(e['rezept_titel'])
        
        name = e['name'].strip().capitalize()
        einheit = e['einheit'].strip()
        menge_str = e['menge'].strip()
        key = f"{name}_{einheit.lower()}"
        
        if key not in zutaten_dict:
            zutaten_dict[key] = {'name': name, 'einheit': einheit, 'menge_zahl': 0.0, 'texte': []}
        
        if menge_str:
            try:
                menge_float = float(menge_str.replace(',', '.'))
                zutaten_dict[key]['menge_zahl'] += menge_float
            except ValueError:
                zutaten_dict[key]['texte'].append(menge_str)
    
    zusammengefasste_zutaten = []
    for daten in zutaten_dict.values():
        menge_anzeige = ""
        if daten['menge_zahl'] > 0:
            zahl = daten['menge_zahl']
            menge_anzeige = f"{int(zahl)}" if zahl.is_integer() else f"{zahl:.2f}".rstrip('0').rstrip('.')
        
        if daten['texte']:
            texte_zusammen = " + ".join(daten['texte'])
            menge_anzeige = f"{menge_anzeige} + {texte_zusammen}" if menge_anzeige else texte_zusammen
            
        zusammengefasste_zutaten.append({
            'name': daten['name'], 'einheit': daten['einheit'], 'menge': menge_anzeige
        })

    return jsonify({
        'rezepte': sorted(list(rezepte_set)),
        'zutaten': sorted(zusammengefasste_zutaten, key=lambda x: x['name']),
        'manuell': manuelle_eintraege
    })

@app.route('/api/einkaufsliste/<int:id>', methods=['POST'])
def api_einkaufsliste_hinzufuegen(id):
    conn = get_db_connection()
    rezept = conn.execute('SELECT * FROM rezepte WHERE id = ?', (id,)).fetchone()
    
    if rezept and rezept['zutaten']:
        for zeile in rezept['zutaten'].split('\n'):
            if zeile.strip():
                zutat_daten = zeile.split('|')
                if len(zutat_daten) == 3:
                    menge, einheit, name = zutat_daten[0], zutat_daten[1], zutat_daten[2]
                else:
                    menge, einheit, name = "", "", zeile
                
                conn.execute('INSERT INTO einkaufsliste (rezept_titel, menge, einheit, name) VALUES (?, ?, ?, ?)', 
                             (rezept['titel'], menge, einheit, name))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/einkaufsliste/entfernen_rezept', methods=['POST'])
def api_einkaufsliste_entfernen_rezept():
    titel = request.json.get('titel') if request.is_json else request.form.get('titel')
    conn = get_db_connection()
    conn.execute('DELETE FROM einkaufsliste WHERE rezept_titel = ?', (titel,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/einkaufsliste/manuell', methods=['POST'])
def api_einkaufsliste_manuell():
    name = request.json.get('name') if request.is_json else request.form.get('name')
    conn = get_db_connection()
    conn.execute("INSERT INTO einkaufsliste (rezept_titel, menge, einheit, name) VALUES ('Manuell', '', '', ?)", (name,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/einkaufsliste/manuell/<int:id>', methods=['DELETE'])
def api_einkaufsliste_entfernen_manuell(id):
    conn = get_db_connection()
    conn.execute('DELETE FROM einkaufsliste WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


# ==========================================
# API ROUTEN FÜR IMPORT (Chefkoch & API)
# ==========================================

@app.route('/api/import_chefkoch', methods=['POST'])
def api_import_chefkoch():
    url = request.json.get('url') if request.is_json else request.form.get('url')
    if 'chefkoch.de' not in url:
        return jsonify({'success': False, 'error': 'Bitte gib einen gültigen Link von www.chefkoch.de ein!'})
        
    try:
        from chefkoch_import import importiere_rezept
        ergebnis = importiere_rezept(url)
    except Exception as e:
        return jsonify({'success': False, 'error': f'Import-Skript Fehler: {str(e)}'})
        
    if not ergebnis['erfolg']:
        return jsonify({'success': False, 'error': ergebnis['fehler']})
        
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (ergebnis['titel'], ergebnis['dauer'], "Importiert", ergebnis['zutaten'], ergebnis['anleitung'], ergebnis['portionen']))
    neue_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'id': neue_id})

@app.route('/api/import_apimeal/<api_id>', methods=['POST'])
def api_import_mealdb(api_id):
    api_url = f"https://www.themealdb.com/api/json/v1/1/lookup.php?i={api_id}"
    response = requests.get(api_url)
    data = response.json()
    
    if not data.get('meals'):
        return jsonify({'success': False, 'error': 'Rezept in TheMealDB nicht gefunden'})
        
    meal = data['meals'][0]
    titel = meal.get('strMeal', 'Unbekanntes Rezept')
    kategorie = meal.get('strCategory', 'Importiert')
    
    zutaten_liste = []
    for i in range(1, 21):
        zutat = meal.get(f'strIngredient{i}')
        menge_einheit = meal.get(f'strMeasure{i}')
        if zutat and zutat.strip():
            m = menge_einheit.strip() if menge_einheit else ""
            zutaten_liste.append(f"{m}||{zutat.strip()}")
            
    anleitung_raw = meal.get('strInstructions', '')
    schritte = [s.strip() for s in anleitung_raw.split('\n') if s.strip()]
    schritte_liste = [f"0:::{schritt}" for schritt in schritte]

    conn = get_db_connection()
    conn.execute('''
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (titel, 30, kategorie, "\n".join(zutaten_liste), "|||".join(schritte_liste), 1))
    conn.commit()
    conn.close()

    return jsonify({'success': True})

if __name__ == '__main__':
    # Läuft lokal auf Port 5000. 
    # Wenn du es auf dem Pi dauerhaft betreibst, nutzt du später z.B. gunicorn.
    app.run(debug=True, host='0.0.0.0', port=5000)