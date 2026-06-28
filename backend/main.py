from __future__ import annotations

import hashlib
import json
import re
import secrets
import sqlite3
from pathlib import Path
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
        "https://lostiboy73.github.io",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# DATENBANK
# ==========================================

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def add_column_if_missing(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    if column not in table_columns(conn, table):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_db() -> None:
    conn = get_db_connection()

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            salt TEXT,
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
            source TEXT DEFAULT 'manual',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
            name TEXT DEFAULT '',
            owner_name TEXT DEFAULT 'Gast',
            typ TEXT DEFAULT 'rezept',
            rezept_id INTEGER,
            titel TEXT,
            text TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    add_column_if_missing(conn, "users", "salt", "TEXT")
    add_column_if_missing(conn, "users", "token", "TEXT")
    add_column_if_missing(conn, "users", "created_at", "TEXT DEFAULT CURRENT_TIMESTAMP")

    add_column_if_missing(conn, "rezepte", "owner_name", "TEXT DEFAULT 'Gast'")
    add_column_if_missing(conn, "rezepte", "is_public", "INTEGER DEFAULT 0")
    add_column_if_missing(conn, "rezepte", "source", "TEXT DEFAULT 'manual'")
    add_column_if_missing(conn, "rezepte", "created_at", "TEXT DEFAULT CURRENT_TIMESTAMP")

    add_column_if_missing(conn, "einkaufsliste", "rezept_titel", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "einkaufsliste", "menge", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "einkaufsliste", "einheit", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "einkaufsliste", "name", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "einkaufsliste", "owner_name", "TEXT DEFAULT 'Gast'")
    add_column_if_missing(conn, "einkaufsliste", "typ", "TEXT DEFAULT 'rezept'")
    add_column_if_missing(conn, "einkaufsliste", "rezept_id", "INTEGER")
    add_column_if_missing(conn, "einkaufsliste", "titel", "TEXT")
    add_column_if_missing(conn, "einkaufsliste", "text", "TEXT")
    add_column_if_missing(conn, "einkaufsliste", "created_at", "TEXT DEFAULT CURRENT_TIMESTAMP")

    conn.execute("UPDATE rezepte SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL OR created_at = ''")
    conn.commit()
    conn.close()


@app.on_event("startup")
def startup() -> None:
    init_db()


init_db()


# ==========================================
# REQUEST-HELPER
# ==========================================

async def get_request_data(request: Request) -> Any:
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            data = await request.json()
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}
    try:
        return await request.form()
    except Exception:
        return {}


def get_single_value(data: Any, key: str, default: str = "") -> str:
    if hasattr(data, "get"):
        value = data.get(key, default)
        if isinstance(value, list):
            return str(value[0]) if value else default
        return default if value is None else str(value)
    return default


def get_list_value(data: Any, key: str) -> List[str]:
    if hasattr(data, "getlist"):
        return [str(value) for value in data.getlist(key)]
    if hasattr(data, "get"):
        value = data.get(key)
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item) for item in value]
        return [str(value)]
    return []


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


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    return None if row is None else dict(row)


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


def make_legacy_sha256(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


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


def auth_response(username: str, token: str) -> Dict[str, Any]:
    return {
        "success": True,
        "ok": True,
        "username": username,
        "user": {"username": username},
        "token": token,
    }


async def register_impl(request: Request) -> Dict[str, Any]:
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

    return auth_response(username, token)


async def login_impl(request: Request) -> Dict[str, Any]:
    data = await get_request_data(request)
    username = normalize_username(get_single_value(data, "username"))
    password = get_single_value(data, "password")

    conn = get_db_connection()
    row = conn.execute("SELECT username, password_hash, salt FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(status_code=401, detail="Benutzername oder Passwort falsch")

    stored_hash = row["password_hash"] or ""
    salt = row["salt"] or ""
    valid = False
    should_migrate = False

    if salt:
        valid = secrets.compare_digest(make_password_hash(password, salt), stored_hash)
    else:
        valid = secrets.compare_digest(make_legacy_sha256(password), stored_hash)
        should_migrate = valid

    if not valid:
        conn.close()
        raise HTTPException(status_code=401, detail="Benutzername oder Passwort falsch")

    token = secrets.token_urlsafe(32)
    if should_migrate:
        salt = secrets.token_hex(16)
        stored_hash = make_password_hash(password, salt)
        conn.execute(
            "UPDATE users SET token = ?, salt = ?, password_hash = ? WHERE username = ?",
            (token, salt, stored_hash, username),
        )
    else:
        conn.execute("UPDATE users SET token = ? WHERE username = ?", (token, username))
    conn.commit()
    conn.close()

    return auth_response(username, token)


@app.post("/api/auth/register")
async def register_auth(request: Request) -> Dict[str, Any]:
    return await register_impl(request)


@app.post("/api/auth/login")
async def login_auth(request: Request) -> Dict[str, Any]:
    return await login_impl(request)


# Kompatibilität für die zwischenzeitliche /api/login-/api/register-Version.
@app.post("/api/register")
async def register_compat(request: Request) -> Dict[str, Any]:
    return await register_impl(request)


@app.post("/api/login")
async def login_compat(request: Request) -> Dict[str, Any]:
    return await login_impl(request)


# ==========================================
# REZEPT-HELPER
# ==========================================

def is_external_source(source: Any) -> bool:
    normalized = str(source or "").strip().lower()
    return normalized in {"chefkoch", "mealdb", "themealdb", "external", "external_api", "api"}


def parse_json_if_possible(value: Any) -> Any:
    if isinstance(value, (list, dict)):
        return value
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if not ((text.startswith("[") and text.endswith("]")) or (text.startswith("{") and text.endswith("}"))):
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


def categories_to_storage(value: Any) -> str:
    parsed = parse_json_if_possible(value)
    if isinstance(parsed, list):
        return ", ".join(str(item).strip() for item in parsed if str(item).strip())
    if isinstance(value, list):
        return ", ".join(str(item).strip() for item in value if str(item).strip())
    return str(value or "").strip()


def ingredient_dict_to_line(item: Any) -> str:
    if isinstance(item, dict):
        menge = str(item.get("menge", "") or "").strip()
        einheit = str(item.get("einheit", "") or "").strip()
        name = str(item.get("name", item.get("zutat", "")) or "").strip()
        return "|".join([menge, einheit, name]).strip("|") if name else ""
    return str(item or "").strip()


def ingredients_to_storage(value: Any) -> str:
    parsed = parse_json_if_possible(value)
    if isinstance(parsed, list):
        return "\n".join(line for line in (ingredient_dict_to_line(item) for item in parsed) if line)
    if isinstance(value, list):
        return "\n".join(line for line in (ingredient_dict_to_line(item) for item in value) if line)
    return str(value or "").strip()


def step_dict_to_line(item: Any) -> str:
    if isinstance(item, dict):
        dauer = str(item.get("dauer", "") or "0").strip() or "0"
        text = str(item.get("schritt", item.get("text", "")) or "").strip()
        return f"{dauer}:::{text}" if text else ""
    return str(item or "").strip()


def steps_to_storage(value: Any) -> str:
    parsed = parse_json_if_possible(value)
    if isinstance(parsed, list):
        return "|||".join(line for line in (step_dict_to_line(item) for item in parsed) if line)
    if isinstance(value, list):
        return "|||".join(line for line in (step_dict_to_line(item) for item in value) if line)
    return str(value or "").strip()


def build_recipe_payload(data: Any) -> Dict[str, Any]:
    titel = get_single_value(data, "titel").strip()
    portionen = max(1, safe_int(get_single_value(data, "portionen", "1"), 1))

    kategorien = [k.strip() for k in get_list_value(data, "kategorie[]") if k.strip()]
    if not kategorien:
        raw_kategorie = get_single_value(data, "kategorie").strip()
        if raw_kategorie:
            kategorien = [k.strip() for k in re.split(r"[,;/]", raw_kategorie) if k.strip()]
    kategorie_text = ", ".join(kategorien)

    mengen = get_list_value(data, "zutaten_menge[]")
    einheiten = get_list_value(data, "zutaten_einheit[]")
    namen = get_list_value(data, "zutaten_name[]")
    zutaten_liste: List[str] = []
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
    schritte_liste: List[str] = []
    gesamt_dauer = 0
    if schritte:
        max_len = max(len(schritte), len(dauern))
        for i in range(max_len):
            text = schritte[i].strip() if i < len(schritte) else ""
            dauer_text = dauern[i].strip() if i < len(dauern) else ""
            if not text:
                continue
            dauer = max(0, safe_int(dauer_text, 0))
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


def serialize_recipe(row: sqlite3.Row) -> Dict[str, Any]:
    recipe = dict(row)
    recipe["is_public"] = int(recipe.get("is_public") or 0)
    recipe["source"] = recipe.get("source") or "manual"
    recipe["owner_name"] = recipe.get("owner_name") or "Gast"
    recipe["created_at"] = recipe.get("created_at") or ""
    return recipe


# ==========================================
# API: BASIS
# ==========================================

@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


# ==========================================
# API: REZEPTE
# ==========================================

@app.get("/api/rezepte")
def get_rezepte(request: Request, suche: str = "", kategorie: str = "", scope: str = "mine") -> Dict[str, Any]:
    scope = scope.strip().lower()
    owner_name = get_current_user(request, required=(scope == "mine")) if scope != "public" else None

    conn = get_db_connection()
    params: List[Any] = []
    if scope == "public":
        where_clause = "WHERE is_public = 1"
    elif scope == "all":
        where_clause = ""
    else:
        where_clause = "WHERE owner_name = ?"
        params.append(owner_name)

    rows = conn.execute(
        f"""
        SELECT id, titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, created_at
        FROM rezepte
        {where_clause}
        ORDER BY datetime(created_at) DESC, id DESC
        """,
        params,
    ).fetchall()
    conn.close()

    search = suche.strip().lower()
    cat_filter = kategorie.strip().lower()
    result: List[Dict[str, Any]] = []
    categories: set[str] = set()

    for row in rows:
        rezept = serialize_recipe(row)
        kat = rezept.get("kategorie") or ""
        for item in str(kat).split(","):
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

    return {"success": True, "ok": True, "rezepte": result, "kategorien": sorted(categories), "scope": scope, "owner_name": owner_name or ""}


@app.get("/api/rezepte/public")
def get_public_rezepte() -> Dict[str, Any]:
    conn = get_db_connection()
    rows = conn.execute(
        """
        SELECT id, titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, created_at
        FROM rezepte
        WHERE is_public = 1
        ORDER BY datetime(created_at) DESC, id DESC
        """
    ).fetchall()
    conn.close()
    return {"success": True, "ok": True, "rezepte": [serialize_recipe(row) for row in rows]}


@app.get("/api/rezepte/{rezept_id}")
def get_rezept_detail(rezept_id: int, request: Request) -> Dict[str, Any]:
    current_user = get_current_user(request, required=False)
    conn = get_db_connection()
    row = conn.execute(
        """
        SELECT id, titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, created_at
        FROM rezepte
        WHERE id = ?
        """,
        (rezept_id,),
    ).fetchone()
    conn.close()

    rezept = row_to_dict(row)
    if rezept is None:
        raise HTTPException(status_code=404, detail="Rezept nicht gefunden")
    if int(rezept.get("is_public") or 0) != 1 and rezept.get("owner_name") != current_user:
        raise HTTPException(status_code=403, detail="Dieses Rezept ist privat")
    return serialize_recipe(row)


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
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (data["titel"], data["dauer"], data["kategorie"], data["zutaten"], data["anleitung"], data["portionen"], owner_name, is_public, "manual"),
    )
    conn.commit()
    rid = cursor.lastrowid
    row = conn.execute("SELECT * FROM rezepte WHERE id = ?", (rid,)).fetchone()
    conn.close()
    return {"success": True, "ok": True, "id": rid, **serialize_recipe(row)}


@app.put("/api/rezepte/{rezept_id}")
async def update_rezept(rezept_id: int, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    raw_data = await get_request_data(request)
    data = build_recipe_payload(raw_data)

    conn = get_db_connection()
    existing = conn.execute("SELECT id, owner_name, source FROM rezepte WHERE id = ?", (rezept_id,)).fetchone()
    if existing is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Rezept nicht gefunden")
    if existing["owner_name"] != owner_name:
        conn.close()
        raise HTTPException(status_code=403, detail="Du kannst nur eigene Rezepte bearbeiten")

    source = existing["source"] or "manual"
    is_public = 0 if is_external_source(source) else (1 if get_bool_value(raw_data, "is_public", False) else 0)

    conn.execute(
        """
        UPDATE rezepte
        SET titel = ?, dauer = ?, kategorie = ?, zutaten = ?, anleitung = ?, portionen = ?, is_public = ?
        WHERE id = ?
        """,
        (data["titel"], data["dauer"], data["kategorie"], data["zutaten"], data["anleitung"], data["portionen"], is_public, rezept_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM rezepte WHERE id = ?", (rezept_id,)).fetchone()
    conn.close()
    return {"success": True, "ok": True, "id": rezept_id, **serialize_recipe(row)}


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
    conn.execute(
        "DELETE FROM einkaufsliste WHERE owner_name = ? AND (rezept_titel = ? OR titel = ? OR rezept_id = ?)",
        (owner_name, title, title, rezept_id),
    )
    conn.commit()
    conn.close()
    return {"success": True, "ok": True}


@app.post("/api/rezepte/{rezept_id}/visibility")
async def update_rezept_visibility(rezept_id: int, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    data = await get_request_data(request)
    requested_public = 1 if get_bool_value(data, "is_public", False) else 0

    conn = get_db_connection()
    existing = conn.execute("SELECT id, owner_name, source FROM rezepte WHERE id = ?", (rezept_id,)).fetchone()
    if existing is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Rezept nicht gefunden")
    if existing["owner_name"] != owner_name:
        conn.close()
        raise HTTPException(status_code=403, detail="Du kannst nur eigene Rezepte veröffentlichen")

    is_public = 0 if is_external_source(existing["source"]) else requested_public
    conn.execute("UPDATE rezepte SET is_public = ? WHERE id = ?", (is_public, rezept_id))
    conn.commit()
    conn.close()
    return {"success": True, "ok": True, "id": rezept_id, "is_public": is_public}


# ==========================================
# API: EINKAUFSLISTE
# ==========================================

def parse_ingredient_line(line: str) -> tuple[str, str, str]:
    parts = [part.strip() for part in str(line or "").split("|")]
    if len(parts) >= 3:
        return parts[0], parts[1], "|".join(parts[2:]).strip()
    return "", "", str(line or "").strip()


@app.get("/api/einkaufsliste")
def get_einkaufsliste(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    rows = conn.execute(
        """
        SELECT id, rezept_titel, menge, einheit, name, owner_name, typ, rezept_id, titel, text, created_at
        FROM einkaufsliste
        WHERE owner_name = ?
        ORDER BY id DESC
        """,
        (owner_name,),
    ).fetchall()
    conn.close()

    recipes_by_title: Dict[str, Dict[str, Any]] = {}
    manual: List[Dict[str, Any]] = []
    ingredients: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        item = dict(row)
        typ = (item.get("typ") or "").strip().lower()
        recipe_title = (item.get("rezept_titel") or item.get("titel") or "").strip()
        name = (item.get("name") or item.get("text") or "").strip()
        unit = (item.get("einheit") or "").strip()
        amount = (item.get("menge") or "").strip()
        is_manual = typ == "manual" or typ == "manuell" or recipe_title.lower() == "manuell"

        if is_manual:
            manual.append({"id": item.get("id"), "name": name, "text": name, "typ": "manual"})
            continue

        if recipe_title:
            recipes_by_title[recipe_title] = {"titel": recipe_title, "title": recipe_title, "id": item.get("rezept_id")}
        if not name:
            continue

        key = f"{name.strip().lower()}_{unit.strip().lower()}"
        if key not in ingredients:
            ingredients[key] = {"name": name.capitalize(), "einheit": unit, "menge_zahl": 0.0, "texte": []}
        if amount:
            try:
                ingredients[key]["menge_zahl"] += float(amount.replace(",", "."))
            except ValueError:
                ingredients[key]["texte"].append(amount)

    summarized: List[Dict[str, Any]] = []
    for item in ingredients.values():
        amount_display = ""
        if item["menge_zahl"] > 0:
            number = item["menge_zahl"]
            amount_display = str(int(number)) if float(number).is_integer() else f"{number:.2f}".rstrip("0").rstrip(".")
        if item["texte"]:
            text = " + ".join(item["texte"])
            amount_display = f"{amount_display} + {text}" if amount_display else text
        summarized.append({"name": item["name"], "einheit": item["einheit"], "menge": amount_display, "typ": "rezept"})

    return {
        "success": True,
        "ok": True,
        "owner_name": owner_name,
        "rezepte": sorted(recipes_by_title.values(), key=lambda item: item["titel"]),
        "zutaten": sorted(summarized, key=lambda item: item["name"]),
        "manuell": manual,
    }


@app.post("/api/einkaufsliste/entfernen_rezept")
async def remove_rezept_from_einkaufsliste(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    data = await get_request_data(request)
    title = get_single_value(data, "titel").strip() or get_single_value(data, "title").strip()
    rezept_id = safe_int(get_single_value(data, "rezept_id", "0"), 0)

    if not title and rezept_id:
        conn_lookup = get_db_connection()
        row = conn_lookup.execute("SELECT titel FROM rezepte WHERE id = ?", (rezept_id,)).fetchone()
        title = row["titel"] if row else ""
        conn_lookup.close()

    if not title and not rezept_id:
        raise HTTPException(status_code=400, detail="Titel oder Rezept-ID fehlt")

    conn = get_db_connection()
    if rezept_id:
        conn.execute(
            "DELETE FROM einkaufsliste WHERE owner_name = ? AND (rezept_id = ? OR rezept_titel = ? OR titel = ?)",
            (owner_name, rezept_id, title, title),
        )
    else:
        conn.execute(
            "DELETE FROM einkaufsliste WHERE owner_name = ? AND (rezept_titel = ? OR titel = ?)",
            (owner_name, title, title),
        )
    conn.commit()
    conn.close()
    return {"success": True, "ok": True}


@app.post("/api/einkaufsliste/manuell")
async def add_manual_item(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    data = await get_request_data(request)
    name = get_single_value(data, "name").strip() or get_single_value(data, "text").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name fehlt")

    conn = get_db_connection()
    cursor = conn.execute(
        """
        INSERT INTO einkaufsliste (rezept_titel, menge, einheit, name, owner_name, typ, rezept_id, titel, text, created_at)
        VALUES ('Manuell', '', '', ?, ?, 'manual', NULL, 'Manuell', ?, CURRENT_TIMESTAMP)
        """,
        (name, owner_name, name),
    )
    conn.commit()
    item_id = cursor.lastrowid
    conn.close()
    return {"success": True, "ok": True, "id": item_id}


@app.delete("/api/einkaufsliste/manuell/{item_id}")
def delete_manual_item(item_id: int, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    conn.execute(
        """
        DELETE FROM einkaufsliste
        WHERE id = ? AND owner_name = ? AND (rezept_titel = 'Manuell' OR titel = 'Manuell' OR typ IN ('manual', 'manuell'))
        """,
        (item_id, owner_name),
    )
    conn.commit()
    conn.close()
    return {"success": True, "ok": True}


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
    conn.execute(
        "DELETE FROM einkaufsliste WHERE owner_name = ? AND (rezept_titel = ? OR titel = ? OR rezept_id = ?)",
        (owner_name, title, title, rezept_id),
    )

    for raw_line in ingredients_to_storage(rezept["zutaten"]).splitlines():
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        amount, unit, name = parse_ingredient_line(raw_line)
        if name:
            conn.execute(
                """
                INSERT INTO einkaufsliste (rezept_titel, menge, einheit, name, owner_name, typ, rezept_id, titel, text, created_at)
                VALUES (?, ?, ?, ?, ?, 'rezept', ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (title, amount, unit, name, owner_name, rezept_id, title, name),
            )
    conn.commit()
    conn.close()
    return {"success": True, "ok": True}

# ==========================================
# IMPORT
# ==========================================

def imported_recipe_from_result(result: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "titel": str(result.get("titel") or result.get("title") or "Importiertes Rezept").strip(),
        "dauer": safe_int(result.get("dauer") or result.get("zeit") or 0, 0),
        "kategorie": categories_to_storage(result.get("kategorie") or result.get("kategorien") or "Importiert"),
        "zutaten": ingredients_to_storage(result.get("zutaten") or result.get("ingredients") or ""),
        "anleitung": steps_to_storage(result.get("anleitung") or result.get("schritte") or result.get("instructions") or ""),
        "portionen": max(1, safe_int(result.get("portionen") or result.get("servings") or 1, 1)),
    }


@app.post("/api/import_chefkoch")
async def import_chefkoch(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    data = await get_request_data(request)
    url = get_single_value(data, "url").strip()
    if not url or "chefkoch.de" not in url:
        return {"success": False, "ok": False, "error": "Bitte gib einen gültigen Link von www.chefkoch.de ein."}

    try:
        from chefkoch_import import importiere_rezept
        result = importiere_rezept(url)
    except Exception as exc:
        return {"success": False, "ok": False, "error": f"Import-Skript Fehler: {exc}"}

    if not result.get("erfolg", result.get("success", False)):
        return {"success": False, "ok": False, "error": result.get("fehler") or result.get("error") or "Import fehlgeschlagen"}

    recipe = imported_recipe_from_result(result)
    conn = get_db_connection()
    cursor = conn.execute(
        """
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'chefkoch', CURRENT_TIMESTAMP)
        """,
        (recipe["titel"], recipe["dauer"], recipe["kategorie"], recipe["zutaten"], recipe["anleitung"], recipe["portionen"], owner_name),
    )
    conn.commit()
    rid = cursor.lastrowid
    row = conn.execute("SELECT * FROM rezepte WHERE id = ?", (rid,)).fetchone()
    conn.close()
    return {"success": True, "ok": True, "id": rid, **serialize_recipe(row)}


@app.get("/api/entdecken")
def entdecken(query: str = "") -> Dict[str, Any]:
    search = query.strip()
    if not search:
        return {"success": True, "ok": True, "meals": []}
    try:
        response = requests.get("https://www.themealdb.com/api/json/v1/1/search.php", params={"s": search}, timeout=15)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"TheMealDB konnte nicht geladen werden: {exc}")
    return {"success": True, "ok": True, "meals": payload.get("meals") or []}


@app.post("/api/import_apimeal/{api_id}")
async def import_mealdb(api_id: str, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    api_url = f"https://www.themealdb.com/api/json/v1/1/lookup.php?i={api_id}"
    try:
        response = requests.get(api_url, timeout=15)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        return {"success": False, "ok": False, "error": f"TheMealDB konnte nicht geladen werden: {exc}"}

    if not payload.get("meals"):
        return {"success": False, "ok": False, "error": "Rezept in TheMealDB nicht gefunden"}

    meal = payload["meals"][0]
    title = meal.get("strMeal") or "Unbekanntes Rezept"
    category = meal.get("strCategory") or "Importiert"
    ingredients: List[str] = []
    for i in range(1, 21):
        ingredient = meal.get(f"strIngredient{i}")
        measure = meal.get(f"strMeasure{i}")
        if ingredient and ingredient.strip():
            ingredients.append(f"{(measure or '').strip()}||{ingredient.strip()}")

    instructions_raw = meal.get("strInstructions") or ""
    steps = [s.strip() for s in instructions_raw.split("\n") if s.strip()]
    if not steps and instructions_raw.strip():
        steps = [instructions_raw.strip()]
    steps_text = "|||".join([f"0:::{step}" for step in steps])

    conn = get_db_connection()
    cursor = conn.execute(
        """
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, created_at)
        VALUES (?, 30, ?, ?, ?, 1, ?, 0, 'mealdb', CURRENT_TIMESTAMP)
        """,
        (title, category, "\n".join(ingredients), steps_text, owner_name),
    )
    conn.commit()
    rid = cursor.lastrowid
    row = conn.execute("SELECT * FROM rezepte WHERE id = ?", (rid,)).fetchone()
    conn.close()
    return {"success": True, "ok": True, "id": rid, **serialize_recipe(row)}


def parse_text_recipe(text: str, fallback_title: str = "") -> Dict[str, Any]:
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Kein Rezepttext angegeben")

    lines = [line.strip() for line in cleaned.split("\n")]
    non_empty = [line for line in lines if line]
    title = fallback_title.strip() or non_empty[0]
    start_index = 0 if fallback_title.strip() else 1

    section = "intro"
    categories: List[str] = []
    ingredients: List[str] = []
    steps: List[str] = []
    portionen = 1
    duration = 0

    heading_map = {
        "zutaten": "ingredients",
        "zutat": "ingredients",
        "ingredients": "ingredients",
        "anleitung": "steps",
        "zubereitung": "steps",
        "schritte": "steps",
        "steps": "steps",
        "kategorie": "categories",
        "kategorien": "categories",
        "category": "categories",
    }

    ingredient_pattern = re.compile(r"^[-*•]?\s*(?:(\d+(?:[,.]\d+)?)\s*)?([a-zA-ZäöüÄÖÜß]+)?\s+(.+)$")

    for raw_line in lines[start_index:]:
        line = raw_line.strip()
        if not line:
            continue

        normalized_heading = line.strip(":").lower()
        if normalized_heading in heading_map:
            section = heading_map[normalized_heading]
            continue

        meta_match = re.match(r"^(dauer|zeit|kochzeit)\s*:?\s*(\d+)", line, flags=re.IGNORECASE)
        if meta_match:
            duration = safe_int(meta_match.group(2), duration)
            continue

        portion_match = re.match(r"^(portionen|portion|personen)\s*:?\s*(\d+)", line, flags=re.IGNORECASE)
        if portion_match:
            portionen = max(1, safe_int(portion_match.group(2), 1))
            continue

        if section == "categories":
            categories.extend([part.strip() for part in re.split(r"[,;/]", line) if part.strip()])
            continue

        if section == "ingredients":
            cleaned_line = re.sub(r"^[-*•]\s*", "", line)
            match = ingredient_pattern.match(cleaned_line)
            if match:
                amount, unit, name = match.groups()
                ingredients.append(f"{amount or ''}|{unit or ''}|{name.strip()}")
            else:
                ingredients.append(cleaned_line)
            continue

        if section == "steps":
            step = re.sub(r"^\d+[.)]\s*", "", line)
            steps.append(f"0:::{step}")
            continue

        lowered = line.lower()
        if lowered.startswith("kategorie"):
            categories.extend([part.strip() for part in re.split(r"[,;/]", line.split(":", 1)[-1]) if part.strip()])

    if not ingredients:
        possible_lines = [line for line in non_empty[1:] if not re.match(r"^(dauer|zeit|kochzeit|portionen|personen|zutaten|anleitung|zubereitung)", line, flags=re.IGNORECASE)]
        for line in possible_lines[:8]:
            if len(line.split()) <= 8:
                ingredients.append(re.sub(r"^[-*•]\s*", "", line))

    if not steps:
        paragraph = " ".join(non_empty[1:])
        for part in re.split(r"(?<=[.!?])\s+", paragraph):
            part = part.strip()
            if len(part) > 15:
                steps.append(f"0:::{part}")

    return {
        "titel": title,
        "dauer": duration,
        "kategorie": ", ".join(categories or ["Import"]),
        "zutaten": "\n".join(ingredients),
        "anleitung": "|||".join(steps),
        "portionen": portionen,
    }


@app.post("/api/import_text")
async def import_text(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    data = await get_request_data(request)
    text = get_single_value(data, "text").strip()
    title = get_single_value(data, "titel").strip()
    recipe = parse_text_recipe(text, title)

    conn = get_db_connection()
    cursor = conn.execute(
        """
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'text', CURRENT_TIMESTAMP)
        """,
        (recipe["titel"], recipe["dauer"], recipe["kategorie"], recipe["zutaten"], recipe["anleitung"], recipe["portionen"], owner_name),
    )
    conn.commit()
    rid = cursor.lastrowid
    row = conn.execute("SELECT * FROM rezepte WHERE id = ?", (rid,)).fetchone()
    conn.close()
    return {"success": True, "ok": True, "id": rid, **serialize_recipe(row)}
