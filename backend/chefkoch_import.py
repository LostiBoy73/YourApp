import requests
from bs4 import BeautifulSoup
import re

def importiere_rezept(url):
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # 1. TITEL
        titel = soup.find('h1').text.strip() if soup.find('h1') else "Import"
        
        # 2. ZUTATEN (Alle Tabellen sammeln, auch bei Mehr-Komponenten-Gerichten)
        zutaten_liste = []
        tabellen = soup.find_all('table', class_=re.compile("ingredients|zutaten"))
        for tabelle in tabellen:
            for zeile in tabelle.find_all('tr'):
                spalten = zeile.find_all('td')
                if len(spalten) >= 2:
                    menge_einheit = spalten[0].text.strip().replace('\xa0', ' ')
                    name = spalten[1].text.strip()
                    teile = menge_einheit.split(' ', 1)
                    menge = teile[0] if len(teile) > 0 else ""
                    einheit = teile[1] if len(teile) > 1 else ""
                    zutaten_liste.append(f"{menge}|{einheit}|{name}")
        zutaten_text = "\n".join(zutaten_liste)
        
        # 3. ZUBEREITUNG (Alle Artikel suchen, die Anweisungen enthalten)
        gefilterte_schritte = []
        # Wir suchen nach divs oder articles mit Instruktionen
        anleitungs_divs = soup.find_all('div', class_=re.compile("instruction|step"))
        for div in anleitungs_divs:
            for text in div.stripped_strings:
                if len(text) > 5 and not any(x in text for x in ["Drucken", "Zutaten"]):
                    gefilterte_schritte.append(f"0:::{text}")
        
        # Fallback: Wenn das nichts findet, suchen wir nach allen <p> Tags in der Nähe der Anleitung
        if not gefilterte_schritte:
            anleitung_bereich = soup.find('article', class_=re.compile("instruction"))
            if anleitung_bereich:
                for p in anleitung_bereich.find_all('p'):
                    gefilterte_schritte.append(f"0:::{p.text.strip()}")

        anleitung_text = "|||".join(gefilterte_schritte)
        
        # 4. DAUER (Sicherheitshalber via Regex aus dem gesamten Text holen)
        text_ganze_seite = soup.get_text()
        minuten_match = re.search(r'(\d+)\s*Min', text_ganze_seite)
        dauer = int(minuten_match.group(1)) if minuten_match else 30

        return {
            'erfolg': True, 'titel': titel, 'portionen': 2, 'dauer': dauer,
            'zutaten': zutaten_text, 'anleitung': anleitung_text
        }
    except Exception as e:
        return {'erfolg': False, 'fehler': str(e)}