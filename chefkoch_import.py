import requests
from bs4 import BeautifulSoup
import re

def importiere_rezept(url):
    try:
        # 1. Webseite herunterladen (Wir tun so, als wären wir ein normaler Browser, sonst blockt Chefkoch uns)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status() # Wirft einen Fehler, wenn die Seite nicht gefunden wurde
        
        # 2. Den HTML-Code "lesbar" machen
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # --- TITEL ---
        titel_element = soup.find('h1')
        titel = titel_element.text.strip() if titel_element else "Importiertes Rezept"
        
        # --- PORTIONEN ---
        portionen = 2 # Standard-Fallback
        # Chefkoch versteckt die Portionen meist in einem Input-Feld
        portionen_input = soup.find('input', {'name': 'Zutaten-Portionen'}) or soup.find('input', class_=re.compile('yield|portion'))
        if portionen_input and portionen_input.get('value'):
            try:
                portionen = int(portionen_input['value'])
            except ValueError:
                pass
                
        # --- DAUER ---
        dauer = 0
        # Wir suchen nach einem kleinen Textblock, der "Min." oder die Uhrzeit-Klasse enthält
        recipe_info = soup.find(class_=re.compile("recipe-preptime|recipe-info|time"))
        if recipe_info:
            zahlen = re.findall(r'\d+', recipe_info.text)
            if zahlen:
                dauer = int(zahlen[0])
                        
        # --- ZUTATEN ---
        zutaten_liste = []
        # Wir suchen die Tabelle mit den Zutaten
        zutaten_tabelle = soup.find('table', class_=re.compile("ingredients|zutaten"))
        if zutaten_tabelle:
            zeilen = zutaten_tabelle.find_all('tr')
            for zeile in zeilen:
                spalten = zeile.find_all('td')
                if len(spalten) >= 2:
                    # Chefkoch hat meist links die Menge und rechts den Namen
                    menge_einheit = spalten[0].text.strip().replace('  ', ' ')
                    name = spalten[1].text.strip()
                    
                    # Versuch, Menge (Zahl) und Einheit (z.B. "g") zu trennen
                    teile = menge_einheit.split(' ', 1)
                    menge = teile[0] if len(teile) > 0 else ""
                    einheit = teile[1] if len(teile) > 1 else ""
                    
                    zutaten_liste.append(f"{menge}|{einheit}|{name}")
        
        # Zum Text-Block zusammenbauen, so wie unsere Datenbank es erwartet
        zutaten_text = "\n".join(zutaten_liste)
        
        # --- ANLEITUNG ---
        anleitung_text = ""
        gefilterte_schritte = []
        
        # Den Textblock mit der Zubereitung suchen
        anleitung_element = soup.find('article', class_=re.compile("instruction|zubereitung"))
        if not anleitung_element:
            # Manchmal ist es auch nur ein einfacher Text-Container
            anleitung_element = soup.find('div', class_=re.compile("recipe-instructions|ds-box"))
            
        if anleitung_element:
            schritte = anleitung_element.stripped_strings
            for s in schritte:
                # Wir filtern ein paar Typische Chefkoch-Werbesätze und kurze Buttons heraus
                if len(s) > 15 and "Drucken" not in s and "Mailen" not in s:
                    # Wir nutzen unser Format: "0 Minuten ::: Text"
                    gefilterte_schritte.append(f"0:::{s}")
                    
        anleitung_text = "|||".join(gefilterte_schritte)
        
        # Alles erfolgreich gesammelt!
        return {
            'erfolg': True,
            'titel': titel,
            'portionen': portionen,
            'dauer': dauer,
            'zutaten': zutaten_text,
            'anleitung': anleitung_text
        }
        
    except Exception as e:
        # Falls etwas abstürzt, fangen wir es ab
        return {
            'erfolg': False,
            'fehler': f"Chefkoch hat die Anfrage blockiert oder die Seite wurde nicht gefunden. (Details: {str(e)})"
        }