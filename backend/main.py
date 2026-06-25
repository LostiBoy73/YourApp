from pathlib import Path
import hashlib
import secrets
import sqlite3
from typing import Any, Dict, List, Optional

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "rezepte.db"

app = FastAPI(title="KochFlow API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://robots-compliance.cc",
        "https://www.robots-compliance.cc",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    return None if row is None else dict(row)


def add_column_if_missing(conn: sqlite3.Connection, table: str, column_definition: str) -> None:
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column_definition}")
    except sqlite3.OperationalError as exc:
        if "duplicate column name" not in str(exc).lower():
            raise


def init_db() -> None:
    conn = get_db_connection()

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            token TEXT UNIQUE,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rezepte (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titel TEXT NOT NULL,
            dauer INTEGER DEFAULT 0,
            kategorie TEXT DEFAULT '',
            zutaten TEXT DEFAULT '',
            anleitung TEXT DEFAULT '',
            portionen INTEGER DEFAULT 1,
            owner_name TEXT DEFAULT 'Gast',
            is_public INTEGER DEFAULT 0,
            source TEXT DEFAULT 'manual'
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS einkaufsliste (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rezept_titel TEXT DEFAULT '',
            menge TEXT DEFAULT '',
            einheit TEXT DEFAULT '',
            name TEXT NOT NULL,
            owner_name TEXT DEFAULT 'Gast'
        )
        """
    )

    add_column_if_missing(conn, "rezepte", "owner_name TEXT DEFAULT 'Gast'")
    add_column_if_missing(conn, "rezepte", "is_public INTEGER DEFAULT 0")
    add_column_if_missing(conn, "rezepte", "source TEXT DEFAULT 'manual'")
    add_column_if_missing(conn, "einkaufsliste", "owner_name TEXT DEFAULT 'Gast'")

    conn.commit()
    conn.close()


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


# ==========================================
# AUTH
# ==========================================

def normalize_username(username: Any) -> str:
    if username is None:
        return ""
    return str(username).strip()[:80]


def make_password_hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        120_000,
    ).hex()


def get_bearer_token(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1].strip()
    return ""


def get_current_user(request: Request, required: bool = True) -> Optional[str]:
    token = get_bearer_token(request)
    if not token:
        if required:
            raise HTTPException(status_code=401, detail="Nicht angemeldet")
        return None

    conn = get_db_connection()
    row = conn.execute("SELECT username FROM users WHERE token = ?", (token,)).fetchone()
    conn.close()

    if row is None:
        if required:
            raise HTTPException(status_code=401, detail="Ungültige Anmeldung")
        return None

    return row["username"]


@app.post("/api/auth/register")
async def register(request: Request) -> Dict[str, Any]:
    data = await get_request_data(request)
    username = normalize_username(get_single_value(data, "username"))
    password = get_single_value(data, "password")

    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Benutzername muss mindestens 3 Zeichen haben")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Passwort muss mindestens 4 Zeichen haben")

    salt = secrets.token_hex(16)
    password_hash = make_password_hash(password, salt)
    token = secrets.token_urlsafe(32)

    conn = get_db_connection()
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, salt, token) VALUES (?, ?, ?, ?)",
            (username, password_hash, salt, token),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=409, detail="Benutzername existiert bereits")
    conn.close()

    return {"success": True, "ok": True, "username": username, "token": token}


@app.post("/api/auth/login")
async def login(request: Request) -> Dict[str, Any]:
    data = await get_request_data(request)
    username = normalize_username(get_single_value(data, "username"))
    password = get_single_value(data, "password")

    conn = get_db_connection()
    row = conn.execute("SELECT username, password_hash, salt FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=401, detail="Benutzername oder Passwort falsch")

    expected_hash = make_password_hash(password, row["salt"])
    if not secrets.compare_digest(expected_hash, row["password_hash"]):
        conn.close()
        raise HTTPException(status_code=401, detail="Benutzername oder Passwort falsch")

    token = secrets.token_urlsafe(32)
    conn.execute("UPDATE users SET token = ? WHERE username = ?", (token, username))
    conn.commit()
    conn.close()

    return {"success": True, "ok": True, "username": username, "token": token}


# ==========================================
# REQUEST HELPER
# ==========================================
async def get_request_data(request: Request) -> Any:
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            return await request.json()
        except Exception:
            return {}
    try:
        return await request.form()
    except Exception:
        return {}


def get_list_value(data: Any, key: str) -> List[str]:
    if hasattr(data, "getlist"):
        return [str(value) for value in data.getlist(key)]
    value = data.get(key) if hasattr(data, "get") else None
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    return [str(value)]


def get_single_value(data: Any, key: str, default: str = "") -> str:
    if not hasattr(data, "get"):
        return default
    value = data.get(key, default)
    return default if value is None else str(value)


def get_bool_value(data: Any, key: str, default: bool = False) -> bool:
    value = get_single_value(data, key, "")
    if value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "ja", "on", "public", "öffentlich"}


def safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(str(value).replace(",", ".")))
    except (TypeError, ValueError):
        return default


def build_recipe_payload(data: Any) -> Dict[str, Any]:
    titel = get_single_value(data, "titel").strip()
    portionen = safe_int(get_single_value(data, "portionen", "1"), 1)

    kategorien = [k.strip() for k in get_list_value(data, "kategorie[]") if k.strip()]
    if not kategorien:
        raw_kategorie = get_single_value(data, "kategorie").strip()
        if raw_kategorie:
            kategorien = [k.strip() for k in raw_kategorie.split(",") if k.strip()]
    kategorie_text = ", ".join(kategorien)

    mengen = get_list_value(data, "zutaten_menge[]")
    einheiten = get_list_value(data, "zutaten_einheit[]")
    namen = get_list_value(data, "zutaten_name[]")
    zutaten_liste = []

    if namen:
        max_len = max(len(mengen), len(einheiten), len(namen))
        for i in range(max_len):
            menge = mengen[i].strip() if i < len(mengen) else ""
            einheit = einheiten[i].strip() if i < len(einheiten) else ""
            name = namen[i].strip() if i < len(namen) else ""
            if name:
                zutaten_liste.append(f"{menge}|{einheit}|{name}")
    else:
        raw_zutaten = get_single_value(data, "zutaten").strip()
        if raw_zutaten:
            zutaten_liste = [line.strip() for line in raw_zutaten.splitlines() if line.strip()]
    zutaten_text = "\n".join(zutaten_liste)

    schritte = get_list_value(data, "anleitung_schritt[]")
    dauern = get_list_value(data, "anleitung_dauer[]")
    schritte_liste = []
    gesamt_dauer = 0

    if schritte:
        max_len = max(len(schritte), len(dauern))
        for i in range(max_len):
            text = schritte[i].strip() if i < len(schritte) else ""
            dauer_text = dauern[i].strip() if i < len(dauern) else ""
            if not text:
                continue
            dauer = safe_int(dauer_text, 0)
            gesamt_dauer += dauer
            schritte_liste.append(f"{dauer}:::{text}")
    else:
        raw_anleitung = get_single_value(data, "anleitung").strip()
        if raw_anleitung:
            schritte_liste = [line.strip() for line in raw_anleitung.splitlines() if line.strip()]
            gesamt_dauer = safe_int(get_single_value(data, "dauer", "0"), 0)
    anleitung_text = "|||".join(schritte_liste)

    return {
        "titel": titel,
        "dauer": gesamt_dauer,
        "kategorie": kategorie_text,
        "zutaten": zutaten_text,
        "anleitung": anleitung_text,
        "portionen": portionen,
    }


# ==========================================
# API: REZEPTE
# ==========================================
@app.get("/api/rezepte")
def get_rezepte(request: Request, suche: str = "", kategorie: str = "", scope: str = "mine") -> Dict[str, Any]:
    scope = scope.strip().lower()
    owner_name = get_current_user(request, required=(scope == "mine")) if scope == "mine" else None

    conn = get_db_connection()
    params: List[Any] = []

    if scope == "public":
        where_clause = "WHERE is_public = 1"
    elif scope == "all":
        # Only useful for debugging; public frontend should not use this.
        where_clause = ""
    else:
        where_clause = "WHERE owner_name = ?"
        params.append(owner_name)

    rows = conn.execute(
        f"""
        SELECT id, titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source
        FROM rezepte
        {where_clause}
        ORDER BY id DESC
        """,
        params,
    ).fetchall()

    search = suche.strip().lower()
    cat_filter = kategorie.strip().lower()
    result = []
    categories = set()

    for row in rows:
        rezept = dict(row)
        kat = rezept.get("kategorie") or ""
        for item in kat.split(","):
            item = item.strip()
            if item:
                categories.add(item)

        text = " ".join([
            rezept.get("titel") or "",
            rezept.get("zutaten") or "",
            rezept.get("anleitung") or "",
            kat,
        ]).lower()
        if search and search not in text:
            continue
        if cat_filter and cat_filter not in kat.lower():
            continue
        result.append(rezept)

    conn.close()
    return {"rezepte": result, "kategorien": sorted(categories), "scope": scope, "owner_name": owner_name or ""}


@app.get("/api/rezepte/{rezept_id}")
def get_rezept_detail(rezept_id: int, request: Request) -> Dict[str, Any]:
    current_user = get_current_user(request, required=False)
    conn = get_db_connection()
    row = conn.execute(
        """
        SELECT id, titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source
        FROM rezepte WHERE id = ?
        """,
        (rezept_id,),
    ).fetchone()
    conn.close()

    rezept = row_to_dict(row)
    if rezept is None:
        raise HTTPException(status_code=404, detail="Rezept nicht gefunden")
    if int(rezept.get("is_public") or 0) != 1 and rezept.get("owner_name") != current_user:
        raise HTTPException(status_code=403, detail="Dieses Rezept ist privat")
    return rezept


@app.post("/api/rezepte")
async def create_rezept(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    raw_data = await get_request_data(request)
    data = build_recipe_payload(raw_data)
    is_public = 1 if get_bool_value(raw_data, "is_public", False) else 0

    if not data["titel"]:
        raise HTTPException(status_code=400, detail="Titel fehlt")
    if not data["zutaten"]:
        raise HTTPException(status_code=400, detail="Zutaten fehlen")
    if not data["anleitung"]:
        raise HTTPException(status_code=400, detail="Anleitung fehlt")

    conn = get_db_connection()
    cursor = conn.execute(
        """
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (data["titel"], data["dauer"], data["kategorie"], data["zutaten"], data["anleitung"], data["portionen"], owner_name, is_public, "manual"),
    )
    conn.commit()
    rid = cursor.lastrowid
    conn.close()
    return {"success": True, "ok": True, "id": rid, "owner_name": owner_name, "is_public": is_public}


@app.put("/api/rezepte/{rezept_id}")
async def update_rezept(rezept_id: int, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    raw_data = await get_request_data(request)
    data = build_recipe_payload(raw_data)

    conn = get_db_connection()
    existing = conn.execute("SELECT id, owner_name FROM rezepte WHERE id = ?", (rezept_id,)).fetchone()
    if existing is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Rezept nicht gefunden")
    if existing["owner_name"] != owner_name:
        conn.close()
        raise HTTPException(status_code=403, detail="Du kannst nur eigene Rezepte bearbeiten")

    conn.execute(
        """
        UPDATE rezepte SET titel = ?, dauer = ?, kategorie = ?, zutaten = ?, anleitung = ?, portionen = ?
        WHERE id = ?
        """,
        (data["titel"], data["dauer"], data["kategorie"], data["zutaten"], data["anleitung"], data["portionen"], rezept_id),
    )
    conn.commit()
    conn.close()
    return {"success": True, "ok": True, "id": rezept_id}


@app.delete("/api/rezepte/{rezept_id}")
def delete_rezept(rezept_id: int, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    existing = conn.execute("SELECT id, titel, owner_name FROM rezepte WHERE id = ?", (rezept_id,)).fetchone()
    if existing is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Rezept nicht gefunden")
    if existing["owner_name"] != owner_name:
        conn.close()
        raise HTTPException(status_code=403, detail="Du kannst nur eigene Rezepte löschen")

    title = existing["titel"]
    conn.execute("DELETE FROM rezepte WHERE id = ?", (rezept_id,))
    conn.execute("DELETE FROM einkaufsliste WHERE rezept_titel = ? AND owner_name = ?", (title, owner_name))
    conn.commit()
    conn.close()
    return {"success": True, "ok": True}


@app.post("/api/rezepte/{rezept_id}/visibility")
async def update_rezept_visibility(rezept_id: int, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    data = await get_request_data(request)
    is_public = 1 if get_bool_value(data, "is_public", False) else 0

    conn = get_db_connection()
    existing = conn.execute("SELECT id, owner_name FROM rezepte WHERE id = ?", (rezept_id,)).fetchone()
    if existing is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Rezept nicht gefunden")
    if existing["owner_name"] != owner_name:
        conn.close()
        raise HTTPException(status_code=403, detail="Du kannst nur eigene Rezepte veröffentlichen")

    conn.execute("UPDATE rezepte SET is_public = ? WHERE id = ?", (is_public, rezept_id))
    conn.commit()
    conn.close()
    return {"success": True, "ok": True, "id": rezept_id, "is_public": is_public}


# ==========================================
# API: EINKAUFSLISTE
# ==========================================
@app.get("/api/einkaufsliste")
def get_einkaufsliste(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT id, rezept_titel, menge, einheit, name, owner_name FROM einkaufsliste WHERE owner_name = ? ORDER BY id DESC",
        (owner_name,),
    ).fetchall()
    conn.close()

    recipes = set()
    manual = []
    ingredients: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        item = dict(row)
        recipe_title = (item.get("rezept_titel") or "").strip()
        name = (item.get("name") or "").strip()
        unit = (item.get("einheit") or "").strip()
        amount = (item.get("menge") or "").strip()

        if recipe_title == "Manuell":
            manual.append(item)
            continue
        if recipe_title:
            recipes.add(recipe_title)
        if not name:
            continue

        key = f"{name.capitalize()}_{unit.lower()}"
        if key not in ingredients:
            ingredients[key] = {"name": name.capitalize(), "einheit": unit, "menge_zahl": 0.0, "texte": []}
        if amount:
            try:
                ingredients[key]["menge_zahl"] += float(amount.replace(",", "."))
            except ValueError:
                ingredients[key]["texte"].append(amount)

    summarized = []
    for item in ingredients.values():
        amount_display = ""
        if item["menge_zahl"] > 0:
            n = item["menge_zahl"]
            amount_display = str(int(n)) if float(n).is_integer() else f"{n:.2f}".rstrip("0").rstrip(".")
        if item["texte"]:
            text = " + ".join(item["texte"])
            amount_display = f"{amount_display} + {text}" if amount_display else text
        summarized.append({"name": item["name"], "einheit": item["einheit"], "menge": amount_display})

    return {"owner_name": owner_name, "rezepte": sorted(recipes), "zutaten": sorted(summarized, key=lambda x: x["name"]), "manuell": manual}


@app.post("/api/einkaufsliste/{rezept_id}")
def add_rezept_to_einkaufsliste(rezept_id: int, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    rezept = conn.execute("SELECT id, titel, zutaten, owner_name, is_public FROM rezepte WHERE id = ?", (rezept_id,)).fetchone()
    if rezept is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Rezept nicht gefunden")
    if rezept["owner_name"] != owner_name and int(rezept["is_public"] or 0) != 1:
        conn.close()
        raise HTTPException(status_code=403, detail="Nur eigene oder öffentliche Rezepte können hinzugefügt werden")

    title = rezept["titel"]
    conn.execute("DELETE FROM einkaufsliste WHERE rezept_titel = ? AND owner_name = ?", (title, owner_name))
    for line in (rezept["zutaten"] or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        if len(parts) == 3:
            amount, unit, name = parts[0].strip(), parts[1].strip(), parts[2].strip()
        else:
            amount, unit, name = "", "", line
        if name:
            conn.execute("INSERT INTO einkaufsliste (rezept_titel, menge, einheit, name, owner_name) VALUES (?, ?, ?, ?, ?)", (title, amount, unit, name, owner_name))
    conn.commit()
    conn.close()
    return {"success": True, "ok": True}


@app.post("/api/einkaufsliste/entfernen_rezept")
async def remove_rezept_from_einkaufsliste(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    data = await get_request_data(request)
    title = get_single_value(data, "titel").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Titel fehlt")
    conn = get_db_connection()
    conn.execute("DELETE FROM einkaufsliste WHERE rezept_titel = ? AND owner_name = ?", (title, owner_name))
    conn.commit()
    conn.close()
    return {"success": True, "ok": True}


@app.post("/api/einkaufsliste/manuell")
async def add_manual_item(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    data = await get_request_data(request)
    name = get_single_value(data, "name").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name fehlt")
    conn = get_db_connection()
    cursor = conn.execute("INSERT INTO einkaufsliste (rezept_titel, menge, einheit, name, owner_name) VALUES ('Manuell', '', '', ?, ?)", (name, owner_name))
    conn.commit()
    item_id = cursor.lastrowid
    conn.close()
    return {"success": True, "ok": True, "id": item_id}


@app.delete("/api/einkaufsliste/manuell/{item_id}")
def delete_manual_item(item_id: int, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    conn.execute("DELETE FROM einkaufsliste WHERE id = ? AND rezept_titel = 'Manuell' AND owner_name = ?", (item_id, owner_name))
    conn.commit()
    conn.close()
    return {"success": True, "ok": True}


# ==========================================
# IMPORT
# ==========================================
@app.post("/api/import_chefkoch")
async def import_chefkoch(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    data = await get_request_data(request)
    url = get_single_value(data, "url").strip()
    if not url or "chefkoch.de" not in url:
        return {"success": False, "error": "Bitte gib einen gültigen Link von www.chefkoch.de ein."}

    try:
        from chefkoch_import import importiere_rezept
        result = importiere_rezept(url)
    except Exception as exc:
        return {"success": False, "error": f"Import-Skript Fehler: {exc}"}

    if not result.get("erfolg"):
        return {"success": False, "error": result.get("fehler", "Import fehlgeschlagen")}

    conn = get_db_connection()
    cursor = conn.execute(
        """
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (result.get("titel", "Importiertes Rezept"), safe_int(result.get("dauer"), 0), "Importiert", result.get("zutaten", ""), result.get("anleitung", ""), safe_int(result.get("portionen"), 1), owner_name, 0, "chefkoch"),
    )
    conn.commit()
    rid = cursor.lastrowid
    conn.close()
    return {"success": True, "ok": True, "id": rid}


@app.post("/api/import_apimeal/{api_id}")
async def import_mealdb(api_id: str, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    api_url = f"https://www.themealdb.com/api/json/v1/1/lookup.php?i={api_id}"
    try:
        response = requests.get(api_url, timeout=15)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        return {"success": False, "error": f"TheMealDB konnte nicht geladen werden: {exc}"}

    if not payload.get("meals"):
        return {"success": False, "error": "Rezept in TheMealDB nicht gefunden"}

    meal = payload["meals"][0]
    title = meal.get("strMeal") or "Unbekanntes Rezept"
    category = meal.get("strCategory") or "Importiert"
    ingredients = []
    for i in range(1, 21):
        ingredient = meal.get(f"strIngredient{i}")
        measure = meal.get(f"strMeasure{i}")
        if ingredient and ingredient.strip():
            ingredients.append(f"{(measure or '').strip()}||{ingredient.strip()}")
    instructions_raw = meal.get("strInstructions") or ""
    steps = [s.strip() for s in instructions_raw.split("\n") if s.strip()] or ([instructions_raw.strip()] if instructions_raw.strip() else [])
    steps_text = "|||".join([f"0:::{step}" for step in steps])

    conn = get_db_connection()
    cursor = conn.execute(
        """
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (title, 30, category, "\n".join(ingredients), steps_text, 1, owner_name, 0, "mealdb"),
    )
    conn.commit()
    rid = cursor.lastrowid
    conn.close()
    return {"success": True, "ok": True, "id": rid}