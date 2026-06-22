// ==========================================
// KONFIGURATION
// ==========================================
// Für lokale Tests am PC (Lass das erstmal so stehen!)
// Später, wenn der Pi läuft, änderst du das zu: 'https://api.robots-compliance.cc'
const API_BASE_URL = "https://robots-compliance.cc";

// Hilfsfunktion: Parameter aus der URL lesen (z.B. ?id=5)
function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

// ==========================================
// 1. MEINE REZEPTE (rezepte.html)
// ==========================================
async function loadRezepte() {
    const container = document.getElementById('recipe-list-container');
    if (!container) return;

    const suche = getQueryParam('suche') || '';
    const kategorie = getQueryParam('kategorie') || '';

    try {
        const response = await fetch(`${API_BASE_URL}/api/rezepte?suche=${encodeURIComponent(suche)}&kategorie=${encodeURIComponent(kategorie)}`);
        const data = await response.json();
        
        // Suchleiste und Filter updaten (falls sie im HTML sind)
        const searchInput = document.getElementById('suche-input');
        if (searchInput) searchInput.value = suche;
        
        const catSelect = document.getElementById('kategorie-select');
        if (catSelect) {
            catSelect.innerHTML = '<option value="">Alle Kategorien</option>';
            data.kategorien.forEach(kat => {
                const selected = kat.toLowerCase() === kategorie.toLowerCase() ? 'selected' : '';
                catSelect.innerHTML += `<option value="${kat}" ${selected}>${kat}</option>`;
            });
        }

        container.innerHTML = ''; 

        if (data.rezepte.length === 0) {
            container.innerHTML = '<p style="text-align: center; width: 100%;">Keine Rezepte gefunden.</p>';
            return;
        }

        data.rezepte.forEach(rezept => {
            // Kategorien als Badges
            let catHTML = '';
            if (rezept.kategorie) {
                rezept.kategorie.split(',').forEach(k => {
                    if (k.trim()) catHTML += `<span class="badge">🏷️ ${k.trim()}</span>`;
                });
            }

            container.innerHTML += `
                <article>
                    <header style="margin-bottom: 0.5rem;">
                        <h3 style="margin-bottom: 0.5rem;"><a href="./rezept_detail.html?id=${rezept.id}">${rezept.titel}</a></h3>
                        <div style="margin-bottom: 0;">${catHTML || '<span style="font-size: 0.8rem; color: var(--pico-muted-color);">Keine Kategorien</span>'}</div>
                    </header>
                    <footer style="margin-top: auto;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span>⏱ ${rezept.dauer} Min.</span>
                            <a href="./bearbeiten.html?id=${rezept.id}" class="outline" style="padding: 2px 10px; font-size: 0.8rem;">✏️ Bearbeiten</a>
                        </div>
                    </footer>
                </article>
            `;
        });
    } catch (error) {
        container.innerHTML = '<p>Fehler beim Laden der Rezepte.</p>';
        console.error(error);
    }
}

// ==========================================
// 2. REZEPT DETAILANSICHT (rezept_detail.html)
// ==========================================
let slides = [];
let aktuellerSchritt = 0;

async function loadRezeptDetail() {
    const container = document.getElementById('detail-container');
    if (!container) return;

    const id = getQueryParam('id');
    if (!id) {
        container.innerHTML = 'Keine Rezept-ID angegeben.';
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/rezepte/${id}`);
        if (!response.ok) throw new Error('Rezept nicht gefunden');
        const rezept = await response.json();

        document.title = rezept.titel;
        document.getElementById('detail-titel').innerText = rezept.titel;
        
        // Tags
        let tagsHTML = '';
        if (rezept.kategorie) {
            rezept.kategorie.split(',').forEach(k => {
                if (k.trim()) tagsHTML += `🏷️ ${k.trim()} &nbsp;`;
            });
        }
        document.getElementById('detail-tags').innerHTML = tagsHTML;

        // Portionen
        document.getElementById('portionen-rechner').value = rezept.portionen || 1;
        document.getElementById('portionen-rechner').dataset.standard = rezept.portionen || 1;

        // Zutaten
        const zutatenList = document.getElementById('detail-zutaten');
        zutatenList.innerHTML = '';
        if (rezept.zutaten) {
            rezept.zutaten.split('\n').forEach(zeile => {
                if (!zeile.trim()) return;
                const teile = zeile.split('|');
                if (teile.length === 3) {
                    zutatenList.innerHTML += `<li><strong><span class="zutat-menge" data-grundmenge="${teile[0]}">${teile[0]}</span> ${teile[1]}</strong> ${teile[2]}</li>`;
                } else {
                    zutatenList.innerHTML += `<li>${zeile}</li>`;
                }
            });
        } else {
            zutatenList.innerHTML = '<li>Keine Zutaten angegeben.</li>';
        }

        // Anleitung (Slider)
        const schritteContainer = document.getElementById('detail-schritte');
        schritteContainer.innerHTML = '';
        const schritte = rezept.anleitung ? rezept.anleitung.split('|||').filter(s => s.trim()) : [];
        
        if (schritte.length > 0) {
            schritte.forEach((schritt, index) => {
                const teile = schritt.split(':::');
                const zeit = teile.length === 2 ? teile[0] : '';
                const text = teile.length === 2 ? teile[1] : teile[0];
                const display = index === 0 ? 'flex' : 'none';

                schritteContainer.innerHTML += `
                    <div class="schritt-slide" style="display: ${display};">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; color: var(--pico-muted-color); font-size: 0.9rem; font-weight: bold; border-bottom: 1px solid var(--pico-muted-border-color); padding-bottom: 0.5rem; margin-bottom: 1rem;">
                            <span>Schritt ${index + 1} von ${schritte.length}</span>
                            ${zeit ? `<span>⏱ ${zeit} Min.</span>` : ''}
                        </div>
                        <div style="flex-grow: 1; display: flex; align-items: center; justify-content: center; text-align: center;">
                            <p style="font-size: 1.3rem; margin: 0;">${text}</p>
                        </div>
                    </div>
                `;
            });
        } else {
            schritteContainer.innerHTML = '<p>Keine Anleitung vorhanden.</p>';
        }

        // Slider initialisieren
        slides = document.querySelectorAll('.schritt-slide');
        updateButtons();

    } catch (error) {
        container.innerHTML = '<p>Fehler beim Laden des Rezepts.</p>';
        console.error(error);
    }
}

// Portionen Rechner Logic
function portionenUmrechnen() {
    const input = document.getElementById('portionen-rechner');
    const neuePortionen = input.value;
    const standardPortionen = input.dataset.standard;
    const mengenFelder = document.querySelectorAll('.zutat-menge');

    mengenFelder.forEach(feld => {
        let grundMengeStr = feld.getAttribute('data-grundmenge').replace(',', '.');
        let grundMenge = parseFloat(grundMengeStr);

        if (!isNaN(grundMenge) && standardPortionen > 0) {
            let neueMenge = (grundMenge / standardPortionen) * neuePortionen;
            let anzeige = Number.isInteger(neueMenge) ? neueMenge : neueMenge.toFixed(1);
            feld.innerText = anzeige.toString().replace('.', ',');
        }
    });
}

// Slider Logic
function updateButtons() {
    const btnZurueck = document.getElementById('btn-zurueck');
    const btnWeiter = document.getElementById('btn-weiter');
    if (!btnZurueck || !btnWeiter) return;

    if (slides.length <= 1) {
        btnZurueck.style.display = 'none';
        btnWeiter.style.display = 'none';
        return;
    }
    btnZurueck.disabled = (aktuellerSchritt === 0);
    btnWeiter.disabled = (aktuellerSchritt === slides.length - 1);
}

function zeigeSchritt(index) {
    slides.forEach((slide, i) => { slide.style.display = (i === index) ? 'flex' : 'none'; });
    aktuellerSchritt = index;
    updateButtons();
}

function naechsterSchritt() { if (aktuellerSchritt < slides.length - 1) zeigeSchritt(aktuellerSchritt + 1); }
function vorherigerSchritt() { if (aktuellerSchritt > 0) zeigeSchritt(aktuellerSchritt - 1); }

async function addRezeptToEinkaufsliste() {
    const id = getQueryParam('id');
    const btn = document.getElementById('btn-einkaufsliste');
    btn.innerHTML = '⏳ Füge hinzu...';
    try {
        await fetch(`${API_BASE_URL}/api/einkaufsliste/${id}`, { method: 'POST' });
        btn.innerHTML = '✅ Auf der Einkaufsliste!';
        btn.classList.add('outline');
        setTimeout(() => { btn.innerHTML = '🛒 Zur Einkaufsliste hinzufügen'; btn.classList.remove('outline'); }, 3000);
    } catch (e) {
        alert('Fehler beim Hinzufügen!');
    }
}

async function rezeptLoeschen() {
    if (!confirm('Möchtest du dieses Rezept wirklich unwiderruflich löschen?')) return;
    const id = getQueryParam('id');
    try {
        await fetch(`${API_BASE_URL}/api/rezepte/${id}`, { method: 'DELETE' });
        window.location.href = './rezepte.html';
    } catch (e) {
        alert('Fehler beim Löschen!');
    }
}


// ==========================================
// 3. EINKAUFSLISTE (einkaufsliste.html)
// ==========================================
async function loadEinkaufsliste() {
    const containerRezepte = document.getElementById('einkauf-rezepte');
    const containerZutaten = document.getElementById('einkauf-zutaten');
    const containerManuell = document.getElementById('einkauf-manuell');
    if (!containerRezepte) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/einkaufsliste`);
        const data = await response.json();

        // Rezepte links
        containerRezepte.innerHTML = '';
        if (data.rezepte.length > 0) {
            data.rezepte.forEach(titel => {
                containerRezepte.innerHTML += `
                    <li style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--pico-muted-border-color);">
                        <strong>${titel}</strong>
                        <button onclick="removeEinkaufRezept('${titel}')" class="outline" style="padding: 2px 10px; border: none; font-size: 1.2rem; margin:0;" title="Entfernen">🗑️</button>
                    </li>
                `;
            });
        } else {
            containerRezepte.innerHTML = '<p style="color: var(--pico-muted-color);">Noch keine Rezepte hinzugefügt.</p>';
        }

        // Zutaten rechts
        containerZutaten.innerHTML = '';
        if (data.zutaten.length > 0) {
            data.zutaten.forEach(z => {
                containerZutaten.innerHTML += `
                    <li style="margin-bottom: 0.5rem;">
                        <label style="display: flex; align-items: center; gap: 10px; margin: 0;">
                            <input type="checkbox" style="margin:0;">
                            <span><strong>${z.menge} ${z.einheit}</strong> ${z.name}</span>
                        </label>
                    </li>
                `;
            });
        } else {
            containerZutaten.innerHTML = '<p style="color: var(--pico-muted-color);">Die Zutatenliste ist leer.</p>';
        }

        // Manuell
        if (data.manuell.length > 0) {
            document.getElementById('manuell-header').style.display = 'block';
            containerManuell.innerHTML = '';
            data.manuell.forEach(item => {
                containerManuell.innerHTML += `
                    <li style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <label style="display: flex; align-items: center; gap: 10px; margin: 0;">
                            <input type="checkbox" style="margin:0;"> 
                            <span>${item.name}</span>
                        </label>
                        <button onclick="removeEinkaufManuell(${item.id})" class="outline" style="padding: 2px 10px; border: none; font-size: 1.2rem; margin:0;">🗑️</button>
                    </li>
                `;
            });
        } else {
            document.getElementById('manuell-header').style.display = 'none';
            containerManuell.innerHTML = '';
        }

    } catch (e) {
        console.error(e);
    }
}

async function removeEinkaufRezept(titel) {
    await fetch(`${API_BASE_URL}/api/einkaufsliste/entfernen_rezept`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({titel: titel})
    });
    loadEinkaufsliste();
}

async function removeEinkaufManuell(id) {
    await fetch(`${API_BASE_URL}/api/einkaufsliste/manuell/${id}`, { method: 'DELETE' });
    loadEinkaufsliste();
}

const formManuell = document.getElementById('form-einkauf-manuell');
if (formManuell) {
    formManuell.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('manuell-input');
        await fetch(`${API_BASE_URL}/api/einkaufsliste/manuell`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: input.value})
        });
        input.value = '';
        loadEinkaufsliste();
    });
}


// ==========================================
// 4. FORMULARE (Neues Rezept & Bearbeiten)
// ==========================================

// Hilfsfunktionen für die Formulare (Zeilen hinzufügen/löschen)
function addZutatZeile() {
    const container = document.getElementById('zutaten-container');
    const neueZeile = container.firstElementChild.cloneNode(true);
    const inputs = neueZeile.getElementsByTagName('input');
    for (let input of inputs) { input.value = ''; }
    container.appendChild(neueZeile);
}

function addSchrittZeile() {
    const container = document.getElementById('schritte-container');
    const neueZeile = container.firstElementChild.cloneNode(true);
    const textareas = neueZeile.getElementsByTagName('textarea');
    const inputs = neueZeile.getElementsByTagName('input');
    for (let textarea of textareas) { textarea.value = ''; }
    for (let input of inputs) { input.value = ''; }
    container.appendChild(neueZeile);
}

function addKategorieZeile() {
    const container = document.getElementById('kategorie-container');
    const neueZeile = container.firstElementChild.cloneNode(true);
    const inputs = neueZeile.getElementsByTagName('input');
    for (let input of inputs) { input.value = ''; }
    container.appendChild(neueZeile);
}

function removeZeile(element) {
    const zeile = element.parentElement;
    const container = zeile.parentElement;
    if (container.children.length > 1) {
        zeile.remove();
    } else {
        const inputs = zeile.querySelectorAll('input, textarea');
        inputs.forEach(input => input.value = '');
    }
}

// Formular "Neues Rezept" abschicken
const formNeuesRezept = document.getElementById('form-neues-rezept');
if (formNeuesRezept) {
    formNeuesRezept.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(formNeuesRezept);
        const btn = e.submitter; btn.disabled = true; btn.innerHTML = 'Speichere...';
        
        try {
            await fetch(`${API_BASE_URL}/api/rezepte`, { method: 'POST', body: formData });
            window.location.href = './rezepte.html';
        } catch (error) {
            alert('Fehler beim Speichern!');
            btn.disabled = false; btn.innerHTML = 'Rezept speichern';
        }
    });
}

// Seite "Bearbeiten" laden und Felder befüllen
async function loadBearbeitenForm() {
    const formBearbeiten = document.getElementById('form-bearbeiten');
    if (!formBearbeiten) return;

    const id = getQueryParam('id');
    if (!id) { alert('Keine ID gefunden'); return; }

    try {
        const response = await fetch(`${API_BASE_URL}/api/rezepte/${id}`);
        const rezept = await response.json();

        document.getElementById('titel').value = rezept.titel;
        document.getElementById('portionen').value = rezept.portionen || 1;

        // Kategorien befüllen
        if (rezept.kategorie) {
            const katContainer = document.getElementById('kategorie-container');
            const kats = rezept.kategorie.split(',');
            katContainer.innerHTML = '';
            kats.forEach(k => {
                if(k.trim()) {
                    katContainer.innerHTML += `
                        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                            <input type="text" name="kategorie[]" value="${k.trim()}" placeholder="z.B. Vegetarisch" style="margin-bottom: 0;">
                            <button type="button" class="outline" onclick="removeZeile(this)" style="margin-bottom: 0; padding: 0 15px;" title="Zeile löschen">🗑️</button>
                        </div>`;
                }
            });
            if(katContainer.innerHTML === '') addKategorieZeile(); // Mindestens eine leere Zeile
        }

        // Zutaten befüllen
        if (rezept.zutaten) {
            const zutatenContainer = document.getElementById('zutaten-container');
            zutatenContainer.innerHTML = '';
            rezept.zutaten.split('\n').forEach(zeile => {
                if(!zeile.trim()) return;
                const t = zeile.split('|');
                let m = t.length === 3 ? t[0] : '';
                let e = t.length === 3 ? t[1] : '';
                let n = t.length === 3 ? t[2] : zeile;
                zutatenContainer.innerHTML += `
                    <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                        <input type="text" name="zutaten_menge[]" value="${m}" placeholder="Menge" style="width: 80px; margin-bottom: 0;">
                        <input type="text" name="zutaten_einheit[]" value="${e}" placeholder="Einheit" style="width: 100px; margin-bottom: 0;">
                        <input type="text" name="zutaten_name[]" value="${n}" placeholder="Zutat" required style="flex-grow: 1; margin-bottom: 0;">
                        <button type="button" class="outline" onclick="removeZeile(this)" style="margin-bottom: 0; padding: 0 15px;" title="Zeile löschen">🗑️</button>
                    </div>`;
            });
            if(zutatenContainer.innerHTML === '') addZutatZeile();
        }

        // Anleitung befüllen
        if (rezept.anleitung) {
            const schritteContainer = document.getElementById('schritte-container');
            schritteContainer.innerHTML = '';
            rezept.anleitung.split('|||').forEach(schritt => {
                if(!schritt.trim()) return;
                const t = schritt.split(':::');
                let zeit = t.length === 2 ? t[0] : '';
                let text = t.length === 2 ? t[1] : t[0];
                schritteContainer.innerHTML += `
                    <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                        <input type="number" name="anleitung_dauer[]" value="${zeit}" placeholder="Min." style="width: 80px; margin-bottom: 0;">
                        <textarea name="anleitung_schritt[]" placeholder="Was ist zu tun?" required style="flex-grow: 1; margin-bottom: 0; min-height: 50px;">${text}</textarea>
                        <button type="button" class="outline" onclick="removeZeile(this)" style="margin-bottom: 0; padding: 0 15px;" title="Zeile löschen">🗑️</button>
                    </div>`;
            });
            if(schritteContainer.innerHTML === '') addSchrittZeile();
        }

        // Submit Handler fürs Bearbeiten-Formular
        formBearbeiten.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(formBearbeiten);
            const btn = e.submitter; btn.disabled = true; btn.innerHTML = 'Aktualisiere...';
            
            try {
                await fetch(`${API_BASE_URL}/api/rezepte/${id}`, { method: 'PUT', body: formData });
                window.location.href = `./rezept_detail.html?id=${id}`;
            } catch (error) {
                alert('Fehler beim Aktualisieren!');
                btn.disabled = false; btn.innerHTML = 'Änderungen speichern';
            }
        });

    } catch (e) {
        console.error("Fehler beim Laden der Bearbeitungs-Daten:", e);
    }
}


// ==========================================
// 5. IMPORT (Chefkoch & API)
// ==========================================
const formChefkoch = document.getElementById('form-import-chefkoch');
if (formChefkoch) {
    formChefkoch.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('url').value;
        const btn = e.submitter; btn.innerHTML = '⏳ Importiere, bitte warten...'; btn.disabled = true;
        const msgBox = document.getElementById('import-message');
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/import_chefkoch`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({url: url})
            });
            const result = await response.json();
            
            if (result.success) {
                window.location.href = `./bearbeiten.html?id=${result.id}`;
            } else {
                msgBox.innerHTML = `❌ Fehler: ${result.error}`;
                msgBox.style.display = 'block';
                btn.innerHTML = '📥 Rezept jetzt importieren'; btn.disabled = false;
            }
        } catch (error) {
            msgBox.innerHTML = `❌ Server-Fehler beim Import. Läuft die API?`;
            msgBox.style.display = 'block';
            btn.innerHTML = '📥 Rezept jetzt importieren'; btn.disabled = false;
        }
    });
}

async function apiRezeptImportieren(apiId, btnElement) {
    btnElement.innerHTML = '⏳ Importiere...';
    btnElement.disabled = true;
    try {
        const response = await fetch(`${API_BASE_URL}/api/import_apimeal/${apiId}`, { method: 'POST' });
        const result = await response.json();
        if (result.success) {
            window.location.href = './rezepte.html';
        } else {
            alert('Fehler beim Import: ' + result.error);
            btnElement.innerHTML = '📥 In meine App importieren'; btnElement.disabled = false;
        }
    } catch (e) {
        alert('Serverfehler beim Import.');
        btnElement.innerHTML = '📥 In meine App importieren'; btnElement.disabled = false;
    }
}

// Entdecken-Seite: Sucht direkt über den Browser bei TheMealDB!
async function loadEntdecken() {
    const container = document.getElementById('entdecken-container');
    if (!container) return;

    const suche = getQueryParam('suche') || 'c';
    document.getElementById('entdecken-suche-input').value = suche;

    try {
        // Direkt vom Browser zur API! Das spart Serverlast auf dem Pi.
        const response = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(suche)}`);
        const data = await response.json();
        
        container.innerHTML = '';
        if (data.meals) {
            data.meals.forEach(rezept => {
                container.innerHTML += `
                    <article class="api-card">
                        <img src="${rezept.strMealThumb}" alt="${rezept.strMeal}">
                        <div class="api-content">
                            <h3>${rezept.strMeal}</h3>
                            <p style="color: var(--pico-muted-color); margin-bottom: 1.5rem; flex-grow: 1;">
                                🏷️ ${rezept.strCategory}<br>
                                🌍 ${rezept.strArea}
                            </p>
                            <button onclick="apiRezeptImportieren('${rezept.idMeal}', this)" class="secondary" style="width: 100%; margin: 0;">📥 In meine App importieren</button>
                        </div>
                    </article>
                `;
            });
        } else {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; margin-top: 2rem;">
                    <h3 style="color: var(--pico-muted-color);">Leider nichts gefunden 😕</h3>
                    <p>Für "<strong>${suche}</strong>" gab es keine Treffer.<br>
                    <em>Tipp: Da wir eine englische Datenbank nutzen, musst du auf Englisch suchen!</em></p>
                </div>
            `;
        }
    } catch (e) {
        container.innerHTML = '<p>Fehler beim Abrufen der API-Daten.</p>';
    }
}


// ==========================================
// INITIALISIERUNG
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadRezepte();
    loadRezeptDetail();
    loadBearbeitenForm();
    loadEinkaufsliste();
    loadEntdecken();
});