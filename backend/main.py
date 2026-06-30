from __future__ import annotations

import hashlib
import html as html_lib
import json
import mimetypes
import os
import re
import secrets
import sqlite3
from pathlib import Path
from urllib.parse import quote_plus, unquote
from typing import Any, Dict, List, Optional

import requests
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "rezepte.db"
UPLOAD_DIR = BASE_DIR / "uploads"
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024

app = FastAPI(title="KochFlow API")

ALLOWED_ORIGINS = [
    "https://robots-compliance.cc",
    "https://www.robots-compliance.cc",
    "https://lostiboy73.github.io",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

# Zusätzlich zur festen Liste: lokale Tests auf beliebigen Ports und GitHub-Pages-Forks erlauben.
# CORSMiddleware beantwortet damit auch OPTIONS-Preflight-Anfragen sauber.
ALLOWED_ORIGIN_REGEX = (
    r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
    r"|^https://(www\.)?robots-compliance\.cc$"
    r"|^https://[a-z0-9-]+\.github\.io$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
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
            image_url TEXT DEFAULT '',
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

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wochenplan (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_name TEXT NOT NULL,
            tag TEXT NOT NULL,
            slot TEXT DEFAULT 'mittag',
            rezept_id INTEGER,
            notiz TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rezept_favoriten (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_name TEXT NOT NULL,
            rezept_id INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(owner_name, rezept_id)
        )
        """
    )

    add_column_if_missing(conn, "users", "salt", "TEXT")
    add_column_if_missing(conn, "users", "token", "TEXT")
    add_column_if_missing(conn, "users", "created_at", "TEXT DEFAULT CURRENT_TIMESTAMP")

    add_column_if_missing(conn, "rezepte", "owner_name", "TEXT DEFAULT 'Gast'")
    add_column_if_missing(conn, "rezepte", "is_public", "INTEGER DEFAULT 0")
    add_column_if_missing(conn, "rezepte", "source", "TEXT DEFAULT 'manual'")
    add_column_if_missing(conn, "rezepte", "image_url", "TEXT DEFAULT ''")
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

    add_column_if_missing(conn, "wochenplan", "owner_name", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "wochenplan", "tag", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "wochenplan", "slot", "TEXT DEFAULT 'mittag'")
    add_column_if_missing(conn, "wochenplan", "rezept_id", "INTEGER")
    add_column_if_missing(conn, "wochenplan", "notiz", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "wochenplan", "created_at", "TEXT DEFAULT CURRENT_TIMESTAMP")
    add_column_if_missing(conn, "wochenplan", "updated_at", "TEXT DEFAULT CURRENT_TIMESTAMP")

    add_column_if_missing(conn, "rezept_favoriten", "owner_name", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "rezept_favoriten", "rezept_id", "INTEGER")
    add_column_if_missing(conn, "rezept_favoriten", "created_at", "TEXT DEFAULT CURRENT_TIMESTAMP")

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


def clean_recipe_image_url(value: Any) -> str:
    url = html_lib.unescape(str(value or "").strip())
    if not url:
        return ""
    if url.startswith("/api/uploads/") or url.startswith("/uploads/"):
        return url
    if url.startswith("//"):
        url = "https:" + url
    if not re.match(r"^https?://", url, flags=re.IGNORECASE):
        return ""
    if re.search(r"\.(jpg|jpeg|png|webp|gif)(\?|$)", url, flags=re.IGNORECASE):
        return url
    if "chefkoch" in url.lower():
        return url
    return ""


def uploaded_file_from_form(data: Any, *keys: str) -> Any:
    if not hasattr(data, "get"):
        return None
    for key in keys:
        value = data.get(key)
        if value is not None and hasattr(value, "filename"):
            return value
    return None


async def save_uploaded_recipe_image(data: Any) -> str:
    upload = uploaded_file_from_form(data, "image_file", "bild_datei", "bild", "image")
    if upload is None:
        return ""

    filename = str(getattr(upload, "filename", "") or "").strip()
    if not filename:
        return ""

    ext = Path(filename).suffix.lower()
    content_type = str(getattr(upload, "content_type", "") or "").lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        guessed = mimetypes.guess_extension(content_type.split(";", 1)[0]) if content_type else ""
        ext = ".jpg" if guessed in {".jpe", ".jpeg"} else (guessed or "")
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Nur JPG, PNG, WebP oder GIF sind als Rezeptbild erlaubt.")
    if content_type and not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Die hochgeladene Datei ist kein Bild.")

    content = await upload.read()
    if not content:
        return ""
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Das Bild ist zu groß. Maximal erlaubt sind 5 MB.")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = f"{secrets.token_urlsafe(18)}{ext}"
    target = UPLOAD_DIR / safe_name
    target.write_bytes(content)
    return f"/api/uploads/{safe_name}"


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


def root_usernames() -> set[str]:
    raw = os.getenv("KOCHFLOW_ROOT_USERS", "root")
    return {name.strip().lower() for name in raw.split(",") if name.strip()}


def is_root_user(username: Optional[str]) -> bool:
    return bool(username and username.strip().lower() in root_usernames())


def can_manage_recipe(username: Optional[str], recipe_owner: Optional[str]) -> bool:
    return is_root_user(username) or bool(username and recipe_owner and str(recipe_owner) == str(username))


def require_root_user(request: Request) -> str:
    username = get_current_user(request, required=True)
    if not is_root_user(username):
        raise HTTPException(status_code=403, detail="Nur Root-User dürfen diese Aktion ausführen")
    return username


def auth_response(username: str, token: str) -> Dict[str, Any]:
    return {
        "success": True,
        "ok": True,
        "username": username,
        "user": {"username": username, "is_root": is_root_user(username)},
        "token": token,
        "is_root": is_root_user(username),
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
    return normalized in {"chefkoch", "chefkoch_search", "mealdb", "themealdb", "external", "external_api", "api", "text"}


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
        "image_url": clean_recipe_image_url(get_single_value(data, "image_url") or get_single_value(data, "bild_url")),
    }


def serialize_recipe(row: sqlite3.Row) -> Dict[str, Any]:
    recipe = dict(row)
    recipe["is_public"] = int(recipe.get("is_public") or 0)
    recipe["source"] = recipe.get("source") or "manual"
    recipe["owner_name"] = recipe.get("owner_name") or "Gast"
    recipe["created_at"] = recipe.get("created_at") or ""
    recipe["image_url"] = clean_recipe_image_url(recipe.get("image_url") or recipe.get("bild_url") or "")
    return recipe


def favorite_recipe_ids(conn: sqlite3.Connection, owner_name: Optional[str]) -> set[int]:
    if not owner_name:
        return set()
    rows = conn.execute(
        "SELECT rezept_id FROM rezept_favoriten WHERE owner_name = ?",
        (owner_name,),
    ).fetchall()
    return {int(row["rezept_id"]) for row in rows if row["rezept_id"]}


def mark_favorites(recipes: List[Dict[str, Any]], favorite_ids: set[int]) -> List[Dict[str, Any]]:
    for recipe in recipes:
        recipe["favorited"] = int(recipe.get("id") or 0) in favorite_ids
    return recipes


# ==========================================
# API: BASIS
# ==========================================

@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/uploads/{filename}")
def get_uploaded_image(filename: str) -> FileResponse:
    safe = Path(filename).name
    path = UPLOAD_DIR / safe
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Bild nicht gefunden")
    media_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    if not media_type.startswith("image/"):
        raise HTTPException(status_code=404, detail="Bild nicht gefunden")
    return FileResponse(path, media_type=media_type)


# ==========================================
# API: REZEPTE
# ==========================================

@app.get("/api/rezepte")
def get_rezepte(request: Request, suche: str = "", kategorie: str = "", scope: str = "mine") -> Dict[str, Any]:
    scope = scope.strip().lower()
    if scope == "public":
        owner_name = get_current_user(request, required=False)
    else:
        owner_name = get_current_user(request, required=True)

    conn = get_db_connection()
    params: List[Any] = []
    if scope == "public":
        where_clause = "WHERE is_public = 1"
    elif scope == "all":
        if not is_root_user(owner_name):
            conn.close()
            raise HTTPException(status_code=403, detail="Alle Rezepte dürfen nur Root-User laden")
        where_clause = ""
    else:
        where_clause = "WHERE owner_name = ?"
        params.append(owner_name)

    rows = conn.execute(
        f"""
        SELECT id, titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, image_url, created_at
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
def get_public_rezepte(request: Request) -> Dict[str, Any]:
    current_user = get_current_user(request, required=False)
    conn = get_db_connection()
    rows = conn.execute(
        """
        SELECT id, titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, image_url, created_at
        FROM rezepte
        WHERE is_public = 1
        ORDER BY datetime(created_at) DESC, id DESC
        """
    ).fetchall()
    favorite_ids = favorite_recipe_ids(conn, current_user)
    recipes = mark_favorites([serialize_recipe(row) for row in rows], favorite_ids)
    conn.close()
    return {"success": True, "ok": True, "rezepte": recipes}


@app.get("/api/favoriten")
def get_favoriten(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    rows = conn.execute(
        """
        SELECT r.id, r.titel, r.dauer, r.kategorie, r.zutaten, r.anleitung, r.portionen,
               r.owner_name, r.is_public, r.source, r.image_url, r.created_at, f.created_at AS favorited_at
        FROM rezept_favoriten f
        JOIN rezepte r ON r.id = f.rezept_id
        WHERE f.owner_name = ? AND r.is_public = 1
        ORDER BY datetime(f.created_at) DESC, r.titel COLLATE NOCASE ASC
        """,
        (owner_name,),
    ).fetchall()
    recipes = []
    for row in rows:
        recipe = serialize_recipe(row)
        recipe["favorited"] = True
        recipe["favorited_at"] = row["favorited_at"]
        recipes.append(recipe)
    conn.close()
    return {"success": True, "ok": True, "rezepte": recipes}


@app.post("/api/favoriten/{rezept_id}")
def add_favorit(rezept_id: int, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    recipe = conn.execute(
        "SELECT id, owner_name, is_public FROM rezepte WHERE id = ?",
        (rezept_id,),
    ).fetchone()
    if recipe is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Rezept nicht gefunden")
    if int(recipe["is_public"] or 0) != 1:
        conn.close()
        raise HTTPException(status_code=403, detail="Nur öffentliche Rezepte können favorisiert werden")
    if recipe["owner_name"] == owner_name:
        conn.close()
        raise HTTPException(status_code=400, detail="Eigene Rezepte stehen bereits im Wochenplan zur Verfügung")

    conn.execute(
        "INSERT OR IGNORE INTO rezept_favoriten (owner_name, rezept_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
        (owner_name, rezept_id),
    )
    conn.commit()
    conn.close()
    return {"success": True, "ok": True, "id": rezept_id, "favorited": True}


@app.delete("/api/favoriten/{rezept_id}")
def remove_favorit(rezept_id: int, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    conn.execute(
        "DELETE FROM rezept_favoriten WHERE owner_name = ? AND rezept_id = ?",
        (owner_name, rezept_id),
    )
    conn.commit()
    conn.close()
    return {"success": True, "ok": True, "id": rezept_id, "favorited": False}


@app.get("/api/rezepte/{rezept_id}")
def get_rezept_detail(rezept_id: int, request: Request) -> Dict[str, Any]:
    current_user = get_current_user(request, required=False)
    conn = get_db_connection()
    row = conn.execute(
        """
        SELECT id, titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, image_url, created_at
        FROM rezepte
        WHERE id = ?
        """,
        (rezept_id,),
    ).fetchone()

    favorite_ids = favorite_recipe_ids(conn, current_user)
    conn.close()

    rezept = row_to_dict(row)
    if rezept is None:
        raise HTTPException(status_code=404, detail="Rezept nicht gefunden")
    if int(rezept.get("is_public") or 0) != 1 and not can_manage_recipe(current_user, rezept.get("owner_name")):
        raise HTTPException(status_code=403, detail="Dieses Rezept ist privat")
    serialized = serialize_recipe(row)
    serialized["favorited"] = int(serialized.get("id") or 0) in favorite_ids
    return serialized


@app.post("/api/rezepte")
async def create_rezept(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    raw_data = await get_request_data(request)
    data = build_recipe_payload(raw_data)
    source = get_single_value(raw_data, "source", "manual").strip().lower() or "manual"
    if source not in {"manual", "chefkoch", "mealdb", "themealdb", "external", "external_api", "api", "text"}:
        source = "manual"
    is_public = 0 if is_external_source(source) or source == "text" else (1 if get_bool_value(raw_data, "is_public", False) else 0)

    if not data["titel"]:
        raise HTTPException(status_code=400, detail="Titel fehlt")
    if not data["zutaten"]:
        raise HTTPException(status_code=400, detail="Zutaten fehlen")
    if not data["anleitung"]:
        raise HTTPException(status_code=400, detail="Anleitung fehlt")

    uploaded_image_url = await save_uploaded_recipe_image(raw_data)
    if is_external_source(source):
        # Externe Chefkoch-Bilder werden nur in Entdecken angezeigt, aber nicht in eigene Rezeptdaten übernommen.
        image_url = uploaded_image_url
    else:
        image_url = uploaded_image_url or data.get("image_url", "")

    conn = get_db_connection()
    cursor = conn.execute(
        """
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, image_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """,
        (data["titel"], data["dauer"], data["kategorie"], data["zutaten"], data["anleitung"], data["portionen"], owner_name, is_public, source, image_url),
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
    existing = conn.execute("SELECT id, owner_name, source, image_url FROM rezepte WHERE id = ?", (rezept_id,)).fetchone()
    if existing is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Rezept nicht gefunden")
    if not can_manage_recipe(owner_name, existing["owner_name"]):
        conn.close()
        raise HTTPException(status_code=403, detail="Du kannst nur eigene Rezepte bearbeiten")

    source = existing["source"] or "manual"
    is_public = 0 if is_external_source(source) else (1 if get_bool_value(raw_data, "is_public", False) else 0)
    if get_bool_value(raw_data, "image_remove", False) or get_bool_value(raw_data, "bild_entfernen", False):
        image_url = ""
    else:
        uploaded_image_url = await save_uploaded_recipe_image(raw_data)
        existing_image = clean_recipe_image_url(existing["image_url"] or "")
        if is_external_source(source):
            # Bei importierten Rezepten nur eigene Uploads behalten, keine externen Chefkoch-Bildlinks speichern.
            image_url = uploaded_image_url or (existing_image if existing_image.startswith("/api/uploads/") or existing_image.startswith("/uploads/") else "")
        else:
            image_url = uploaded_image_url or data.get("image_url") or existing_image

    conn.execute(
        """
        UPDATE rezepte
        SET titel = ?, dauer = ?, kategorie = ?, zutaten = ?, anleitung = ?, portionen = ?, is_public = ?, image_url = ?
        WHERE id = ?
        """,
        (data["titel"], data["dauer"], data["kategorie"], data["zutaten"], data["anleitung"], data["portionen"], is_public, image_url, rezept_id),
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
    if not can_manage_recipe(owner_name, existing["owner_name"]):
        conn.close()
        raise HTTPException(status_code=403, detail="Du kannst nur eigene Rezepte löschen")

    title = existing["titel"]
    conn.execute("DELETE FROM rezepte WHERE id = ?", (rezept_id,))
    conn.execute("DELETE FROM rezept_favoriten WHERE rezept_id = ?", (rezept_id,))
    conn.execute(
        "DELETE FROM einkaufsliste WHERE owner_name = ? AND (rezept_titel = ? OR titel = ? OR rezept_id = ?)",
        (owner_name, title, title, rezept_id),
    )
    conn.commit()
    conn.close()
    return {"success": True, "ok": True}


@app.delete("/api/admin/rezepte")
def admin_delete_all_rezepte(request: Request) -> Dict[str, Any]:
    root_name = require_root_user(request)
    conn = get_db_connection()
    count = conn.execute("SELECT COUNT(*) AS count FROM rezepte").fetchone()["count"]
    conn.execute("DELETE FROM einkaufsliste")
    conn.execute("DELETE FROM wochenplan")
    conn.execute("DELETE FROM rezept_favoriten")
    conn.execute("DELETE FROM rezepte")
    conn.commit()
    conn.close()
    return {"success": True, "ok": True, "deleted": int(count or 0), "root": root_name}


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
    if not can_manage_recipe(owner_name, existing["owner_name"]):
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

KNOWN_UNITS = {
    "g", "gramm", "kg", "mg", "ml", "l", "liter", "cl", "dl",
    "tl", "tsp", "teelöffel", "teeloeffel", "el", "tbsp", "esslöffel", "essloeffel",
    "stk", "stück", "stueck", "dose", "dosen", "packung", "packungen", "päckchen", "paeckchen",
    "becher", "tasse", "tassen", "cup", "cups", "prise", "prisen", "bund", "scheibe", "scheiben"
}

UNIT_ALIASES = {
    "gramm": "g", "gr": "g", "kilogramm": "kg", "kilo": "kg",
    "milliliter": "ml", "liter": "l", "ltr": "l",
    "teelöffel": "TL", "teeloeffel": "TL", "tl": "TL", "tsp": "TL",
    "esslöffel": "EL", "essloeffel": "EL", "el": "EL", "tbsp": "EL",
    "stück": "Stk", "stueck": "Stk", "stk": "Stk", "st": "Stk",
    "dosen": "Dose", "dose": "Dose",
    "packungen": "Packung", "packung": "Packung",
    "päckchen": "Päckchen", "paeckchen": "Päckchen",
    "tassen": "Tasse", "tasse": "Tasse", "cups": "Cup", "cup": "Cup",
    "prisen": "Prise", "prise": "Prise",
    "scheiben": "Scheibe", "scheibe": "Scheibe",
}


def normalize_unit(value: Any) -> str:
    raw = str(value or "").strip().rstrip(".")
    if not raw:
        return ""
    return UNIT_ALIASES.get(raw.lower(), raw)

UNICODE_FRACTIONS = {
    "½": 0.5,
    "¼": 0.25,
    "¾": 0.75,
    "⅓": 1 / 3,
    "⅔": 2 / 3,
    "⅛": 0.125,
    "⅜": 0.375,
    "⅝": 0.625,
    "⅞": 0.875,
}


def parse_amount_number(value: Any) -> Optional[float]:
    text = str(value or "").strip().replace(",", ".")
    if not text:
        return None
    if text in UNICODE_FRACTIONS:
        return UNICODE_FRACTIONS[text]
    if " " in text:
        parts = [part for part in text.split() if part]
        if len(parts) == 2 and "/" in parts[1]:
            whole = parse_amount_number(parts[0])
            frac = parse_amount_number(parts[1])
            if whole is not None and frac is not None:
                return whole + frac
    if "/" in text:
        try:
            a, b = text.split("/", 1)
            denominator = float(b)
            if denominator == 0:
                return None
            return float(a) / denominator
        except Exception:
            return None
    try:
        return float(text)
    except Exception:
        return None


def format_amount_number(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.2f}".rstrip("0").rstrip(".").replace(".", ",")


def scale_amount_text(amount: Any, multiplier: int = 1) -> str:
    text = str(amount or "").strip()
    multiplier = max(1, safe_int(multiplier, 1))
    if multiplier <= 1:
        return text
    if not text:
        return str(multiplier)
    number = parse_amount_number(text)
    if number is not None:
        return format_amount_number(number * multiplier)
    return f"{multiplier} x {text}"


def split_amount_and_unit(amount: str, unit: str = "") -> tuple[str, str]:
    amount_text = str(amount or "").strip()
    unit_text = normalize_unit(unit)
    if unit_text or not amount_text:
        return amount_text, unit_text
    match = re.match(r"^([0-9]+(?:[.,][0-9]+)?(?:\s+[0-9]+/[0-9]+)?|[0-9]+/[0-9]+|[¼½¾⅓⅔⅛⅜⅝⅞])\s+(.+)$", amount_text)
    if not match:
        return amount_text, unit_text
    number, rest = match.group(1).strip(), match.group(2).strip()
    first, _, _remainder = rest.partition(" ")
    if first.lower().rstrip(".") in KNOWN_UNITS:
        return number, normalize_unit(first)
    return amount_text, unit_text


def parse_ingredient_line(line: str) -> tuple[str, str, str]:
    text = str(line or "").strip()
    if not text:
        return "", "", ""
    parts = [part.strip() for part in text.split("|")]
    if len(parts) >= 3:
        return parts[0], parts[1], "|".join(parts[2:]).strip()

    match = re.match(r"^([0-9]+(?:[.,][0-9]+)?(?:\s+[0-9]+/[0-9]+)?|[0-9]+/[0-9]+|[¼½¾⅓⅔⅛⅜⅝⅞])\s+(.+)$", text)
    if not match:
        return "", "", text

    amount = match.group(1).strip()
    rest = match.group(2).strip()
    first, sep, remainder = rest.partition(" ")
    first_clean = first.lower().rstrip(".")
    if sep and first_clean in KNOWN_UNITS:
        return amount, normalize_unit(first), remainder.strip()
    return amount, "", rest


def normalize_ingredient_name(value: str) -> str:
    text = str(value or "").strip().lower()
    text = text.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"\b(frisch|frische|frischen|gehackt|gehackte|gewuerfelt|gewürfelt|klein|gross|groß|mittel|optional|nach geschmack)\b", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    words = []
    for word in text.split():
        if len(word) > 5 and word.endswith("chen"):
            pass
        elif len(word) > 4 and word.endswith("en"):
            word = word[:-2]
        elif len(word) > 4 and word.endswith("e"):
            word = word[:-1]
        elif len(word) > 4 and word.endswith("s"):
            word = word[:-1]
        words.append(word)
    return " ".join(words).strip()


def display_ingredient_name(value: str) -> str:
    text = str(value or "").strip()
    return text[:1].upper() + text[1:] if text else ""


def aggregate_shopping_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets: Dict[str, Dict[str, Any]] = {}
    for item in items:
        name = str(item.get("name") or item.get("text") or "").strip()
        amount = str(item.get("menge") or "").strip()
        unit = str(item.get("einheit") or "").strip()
        amount, unit = split_amount_and_unit(amount, unit)
        if not name:
            continue
        key = f"{normalize_ingredient_name(name)}|{unit.lower().rstrip('.')}"
        if key not in buckets:
            buckets[key] = {
                "name": display_ingredient_name(name),
                "einheit": unit,
                "menge_zahl": 0.0,
                "hat_zahl": False,
                "freie_mengen": [],
                "ids": [],
                "rezept_ids": [],
                "rezept_titel": [],
                "typen": set(),
            }
        bucket = buckets[key]
        if item.get("id") is not None:
            bucket["ids"].append(item.get("id"))
        if item.get("rezept_id") is not None and item.get("rezept_id") not in bucket["rezept_ids"]:
            bucket["rezept_ids"].append(item.get("rezept_id"))
        title = str(item.get("rezept_titel") or item.get("titel") or "").strip()
        if title and title.lower() != "manuell" and title not in bucket["rezept_titel"]:
            bucket["rezept_titel"].append(title)
        bucket["typen"].add(str(item.get("typ") or "rezept").lower())

        number = parse_amount_number(amount)
        if number is not None:
            bucket["menge_zahl"] += number
            bucket["hat_zahl"] = True
        elif amount:
            bucket["freie_mengen"].append(amount)

    result: List[Dict[str, Any]] = []
    for bucket in buckets.values():
        amount_display = ""
        if bucket["hat_zahl"]:
            amount_display = format_amount_number(bucket["menge_zahl"])
        if bucket["freie_mengen"]:
            extra = " + ".join(bucket["freie_mengen"])
            amount_display = f"{amount_display} + {extra}" if amount_display else extra
        typen = {value for value in bucket["typen"] if value}
        typ = "gemischt" if len(typen) > 1 else (next(iter(typen)) if typen else "rezept")
        result.append({
            "id": bucket["ids"][0] if bucket["ids"] else None,
            "ids": [int(value) for value in bucket["ids"] if value is not None],
            "rezept_ids": bucket["rezept_ids"],
            "rezept_titel": bucket["rezept_titel"],
            "name": bucket["name"],
            "einheit": bucket["einheit"],
            "menge": amount_display,
            "typ": typ,
        })
    return sorted(result, key=lambda item: normalize_ingredient_name(item["name"]))


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
    recipe_items: List[Dict[str, Any]] = []
    all_items: List[Dict[str, Any]] = []

    for row in rows:
        item = dict(row)
        typ = (item.get("typ") or "").strip().lower()
        recipe_title = (item.get("rezept_titel") or item.get("titel") or "").strip()
        unit = (item.get("einheit") or "").strip()
        amount = (item.get("menge") or "").strip()
        amount, unit = split_amount_and_unit(amount, unit)
        is_manual = typ == "manual" or typ == "manuell" or recipe_title.lower() == "manuell"

        if recipe_title and typ in {"rezept_marker", "recipe_marker"}:
            recipe_entry = recipes_by_title.setdefault(
                recipe_title,
                {"titel": recipe_title, "title": recipe_title, "id": item.get("rezept_id"), "anzahl": 1},
            )
            if item.get("rezept_id") and not recipe_entry.get("id"):
                recipe_entry["id"] = item.get("rezept_id")
            recipe_entry["anzahl"] = max(safe_int(recipe_entry.get("anzahl"), 1), safe_int(amount, 1))
            continue

        name = (item.get("name") or "").strip()

        item_for_aggregation = {
            "id": item.get("id"),
            "name": name,
            "menge": amount,
            "einheit": unit,
            "typ": "manual" if is_manual else "rezept",
            "rezept_id": item.get("rezept_id"),
            "rezept_titel": recipe_title,
            "titel": recipe_title,
        }

        if is_manual:
            manual_text = " ".join(part for part in [amount, unit, name] if part).strip() or name
            manual_item = {
                "id": item.get("id"),
                "name": name,
                "text": manual_text,
                "menge": amount,
                "einheit": unit,
                "typ": "manual",
                "ids": [item.get("id")] if item.get("id") is not None else [],
            }
            manual.append(manual_item)
            all_items.append(item_for_aggregation)
            continue

        if recipe_title:
            recipe_entry = recipes_by_title.setdefault(
                recipe_title,
                {"titel": recipe_title, "title": recipe_title, "id": item.get("rezept_id"), "anzahl": 1},
            )
            if item.get("rezept_id") and not recipe_entry.get("id"):
                recipe_entry["id"] = item.get("rezept_id")
        if not name:
            continue
        recipe_items.append(item_for_aggregation)
        all_items.append(item_for_aggregation)

    return {
        "success": True,
        "ok": True,
        "owner_name": owner_name,
        "rezepte": sorted(recipes_by_title.values(), key=lambda item: item["titel"]),
        "zutaten": aggregate_shopping_items(recipe_items),
        "manuell": sorted(manual, key=lambda item: item.get("id") or 0),
        "gesamt": aggregate_shopping_items(all_items),
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


@app.delete("/api/einkaufsliste")
def clear_einkaufsliste(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    conn.execute("DELETE FROM einkaufsliste WHERE owner_name = ?", (owner_name,))
    conn.commit()
    conn.close()
    return {"success": True, "ok": True}


@app.post("/api/einkaufsliste/entfernen_zutat")
async def remove_zutat_from_einkaufsliste(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    data = await get_request_data(request)
    raw_ids = []
    if hasattr(data, "get"):
        maybe_ids = data.get("ids")
        if isinstance(maybe_ids, list):
            raw_ids.extend(maybe_ids)
        elif maybe_ids is not None:
            raw_ids.append(maybe_ids)
        item_id = data.get("id")
        if item_id is not None:
            raw_ids.append(item_id)
    ids = sorted({safe_int(value, 0) for value in raw_ids if safe_int(value, 0) > 0})
    if not ids:
        raise HTTPException(status_code=400, detail="Zutaten-ID fehlt")

    placeholders = ",".join("?" for _ in ids)
    conn = get_db_connection()
    conn.execute(
        f"DELETE FROM einkaufsliste WHERE owner_name = ? AND id IN ({placeholders})",
        (owner_name, *ids),
    )
    conn.commit()
    conn.close()
    return {"success": True, "ok": True}


@app.post("/api/einkaufsliste/manuell")
async def add_manual_item(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    data = await get_request_data(request)
    amount = get_single_value(data, "menge").strip() or get_single_value(data, "amount").strip()
    unit = get_single_value(data, "einheit").strip() or get_single_value(data, "unit").strip()
    name = get_single_value(data, "name").strip() or get_single_value(data, "item").strip()
    raw_text = get_single_value(data, "text").strip()

    if not name and raw_text:
        parsed_amount, parsed_unit, parsed_name = parse_ingredient_line(raw_text)
        amount = amount or parsed_amount
        unit = unit or parsed_unit
        name = parsed_name or raw_text

    if not name:
        raise HTTPException(status_code=400, detail="Zutat fehlt")

    display_text = " ".join(part for part in [amount, unit, name] if part).strip()

    conn = get_db_connection()
    cursor = conn.execute(
        """
        INSERT INTO einkaufsliste (rezept_titel, menge, einheit, name, owner_name, typ, rezept_id, titel, text, created_at)
        VALUES ('Manuell', ?, ?, ?, ?, 'manual', NULL, 'Manuell', ?, CURRENT_TIMESTAMP)
        """,
        (amount, unit, name, owner_name, display_text),
    )
    conn.commit()
    item_id = cursor.lastrowid
    conn.close()
    return {"success": True, "ok": True, "id": item_id, "text": display_text, "menge": amount, "einheit": unit, "name": name}


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


def insert_recipe_into_shopping_list(conn: sqlite3.Connection, owner_name: str, rezept_id: int, multiplier: int = 1) -> Dict[str, Any]:
    rezept = conn.execute("SELECT id, titel, zutaten, owner_name, is_public FROM rezepte WHERE id = ?", (rezept_id,)).fetchone()
    if rezept is None:
        raise HTTPException(status_code=404, detail="Rezept nicht gefunden")
    if rezept["owner_name"] != owner_name and int(rezept["is_public"] or 0) != 1:
        raise HTTPException(status_code=403, detail="Nur eigene oder öffentliche Rezepte können hinzugefügt werden")

    title = rezept["titel"]
    recipe_multiplier = max(1, safe_int(multiplier, 1))
    conn.execute(
        "DELETE FROM einkaufsliste WHERE owner_name = ? AND (rezept_titel = ? OR titel = ? OR rezept_id = ?)",
        (owner_name, title, title, rezept_id),
    )

    if recipe_multiplier > 1:
        conn.execute(
            """
            INSERT INTO einkaufsliste (rezept_titel, menge, einheit, name, owner_name, typ, rezept_id, titel, text, created_at)
            VALUES (?, ?, '', '', ?, 'rezept_marker', ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (title, str(recipe_multiplier), owner_name, rezept_id, title, f"{recipe_multiplier} x {title}"),
        )

    inserted = 0
    for raw_line in ingredients_to_storage(rezept["zutaten"]).splitlines():
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        amount, unit, name = parse_ingredient_line(raw_line)
        if name:
            scaled_amount = scale_amount_text(amount, recipe_multiplier)
            display_text = " ".join(part for part in [scaled_amount, unit, name] if part).strip()
            conn.execute(
                """
                INSERT INTO einkaufsliste (rezept_titel, menge, einheit, name, owner_name, typ, rezept_id, titel, text, created_at)
                VALUES (?, ?, ?, ?, ?, 'rezept', ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (title, scaled_amount, unit, name, owner_name, rezept_id, title, display_text),
            )
            inserted += 1
    return {"titel": title, "rezept_id": rezept_id, "zutaten": inserted, "anzahl": recipe_multiplier}


@app.post("/api/einkaufsliste/{rezept_id}")
def add_rezept_to_einkaufsliste(rezept_id: int, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    result = insert_recipe_into_shopping_list(conn, owner_name, rezept_id)
    conn.commit()
    conn.close()
    return {"success": True, "ok": True, **result}


# ==========================================
# API: WOCHENPLAN
# ==========================================

WOCHENPLAN_DAYS = ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"]
WOCHENPLAN_DAY_LABELS = {
    "montag": "Montag",
    "dienstag": "Dienstag",
    "mittwoch": "Mittwoch",
    "donnerstag": "Donnerstag",
    "freitag": "Freitag",
    "samstag": "Samstag",
    "sonntag": "Sonntag",
}


def normalize_weekday(value: Any) -> str:
    text = str(value or "").strip().lower()
    aliases = {
        "mo": "montag", "montag": "montag",
        "di": "dienstag", "dienstag": "dienstag",
        "mi": "mittwoch", "mittwoch": "mittwoch",
        "do": "donnerstag", "donnerstag": "donnerstag",
        "fr": "freitag", "freitag": "freitag",
        "sa": "samstag", "samstag": "samstag",
        "so": "sonntag", "sonntag": "sonntag",
    }
    day = aliases.get(text)
    if not day:
        raise HTTPException(status_code=400, detail="Ungültiger Wochentag")
    return day


@app.get("/api/wochenplan")
def get_wochenplan(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    rows = conn.execute(
        """
        SELECT w.id, w.tag, w.slot, w.rezept_id, w.notiz, w.created_at, w.updated_at,
               r.titel, r.dauer, r.kategorie, r.owner_name AS rezept_owner, r.is_public, r.source, r.image_url
        FROM wochenplan w
        LEFT JOIN rezepte r ON r.id = w.rezept_id
        WHERE w.owner_name = ?
        ORDER BY w.id ASC
        """,
        (owner_name,),
    ).fetchall()
    conn.close()
    entries = []
    for row in rows:
        item = dict(row)
        entries.append({
            "id": item.get("id"),
            "tag": item.get("tag"),
            "tag_label": WOCHENPLAN_DAY_LABELS.get(item.get("tag"), item.get("tag")),
            "slot": item.get("slot") or "mittag",
            "rezept_id": item.get("rezept_id"),
            "notiz": item.get("notiz") or "",
            "titel": item.get("titel") or "",
            "dauer": item.get("dauer") or 0,
            "kategorie": item.get("kategorie") or "",
            "owner_name": item.get("rezept_owner") or "",
            "is_public": int(item.get("is_public") or 0),
            "source": item.get("source") or "manual",
            "image_url": clean_recipe_image_url(item.get("image_url") or ""),
        })
    return {"success": True, "ok": True, "tage": WOCHENPLAN_DAYS, "eintraege": entries}


@app.post("/api/wochenplan")
async def save_wochenplan_entry(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    data = await get_request_data(request)
    tag = normalize_weekday(get_single_value(data, "tag"))
    slot = (get_single_value(data, "slot", "mittag").strip().lower() or "mittag")[:40]
    rezept_id = safe_int(get_single_value(data, "rezept_id", "0"), 0)
    notiz = get_single_value(data, "notiz").strip()[:300]

    conn = get_db_connection()
    if rezept_id:
        recipe = conn.execute("SELECT id, owner_name, is_public FROM rezepte WHERE id = ?", (rezept_id,)).fetchone()
        if recipe is None:
            conn.close()
            raise HTTPException(status_code=404, detail="Rezept nicht gefunden")
        if recipe["owner_name"] != owner_name and int(recipe["is_public"] or 0) != 1:
            conn.close()
            raise HTTPException(status_code=403, detail="Nur eigene oder öffentliche Rezepte können geplant werden")

    conn.execute("DELETE FROM wochenplan WHERE owner_name = ? AND tag = ? AND slot = ?", (owner_name, tag, slot))
    if rezept_id or notiz:
        cursor = conn.execute(
            """
            INSERT INTO wochenplan (owner_name, tag, slot, rezept_id, notiz, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (owner_name, tag, slot, rezept_id or None, notiz),
        )
        entry_id = cursor.lastrowid
    else:
        entry_id = None
    conn.commit()
    conn.close()
    return {"success": True, "ok": True, "id": entry_id}


@app.delete("/api/wochenplan/{entry_id}")
def delete_wochenplan_entry(entry_id: int, request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    conn.execute("DELETE FROM wochenplan WHERE owner_name = ? AND id = ?", (owner_name, entry_id))
    conn.commit()
    conn.close()
    return {"success": True, "ok": True}


@app.delete("/api/wochenplan")
def clear_wochenplan(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    conn.execute("DELETE FROM wochenplan WHERE owner_name = ?", (owner_name,))
    conn.commit()
    conn.close()
    return {"success": True, "ok": True}


@app.post("/api/wochenplan/einkaufsliste")
def add_wochenplan_to_einkaufsliste(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    conn = get_db_connection()
    rows = conn.execute(
        """
        SELECT rezept_id, COUNT(*) AS anzahl
        FROM wochenplan
        WHERE owner_name = ? AND rezept_id IS NOT NULL
        GROUP BY rezept_id
        """,
        (owner_name,),
    ).fetchall()
    added = []
    for row in rows:
        rezept_id = safe_int(row["rezept_id"], 0)
        count = max(1, safe_int(row["anzahl"], 1))
        if rezept_id:
            added.append(insert_recipe_into_shopping_list(conn, owner_name, rezept_id, multiplier=count))
    conn.commit()
    conn.close()
    return {"success": True, "ok": True, "rezepte": added, "count": len(added)}


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
        "image_url": clean_recipe_image_url(result.get("image_url") or result.get("bild_url") or result.get("image") or result.get("strMealThumb") or ""),
    }


@app.post("/api/import_chefkoch")
async def import_chefkoch(request: Request) -> Dict[str, Any]:
    owner_name = get_current_user(request, required=True)
    data = await get_request_data(request)
    url = get_single_value(data, "url").strip()
    if not url or "chefkoch.de" not in url:
        return {"success": False, "ok": False, "error": "Bitte gib einen gültigen Link von www.chefkoch.de ein."}
    try:
        recipe_url = normalize_chefkoch_url(url)
    except HTTPException:
        recipe_url = url

    try:
        from chefkoch_import import importiere_rezept
        result = importiere_rezept(recipe_url)
    except Exception as exc:
        return {"success": False, "ok": False, "error": f"Import-Skript Fehler: {exc}"}

    if not result.get("erfolg", result.get("success", False)):
        return {"success": False, "ok": False, "error": result.get("fehler") or result.get("error") or "Import fehlgeschlagen"}

    recipe = imported_recipe_from_result(result)
    recipe["image_url"] = recipe.get("image_url") or chefkoch_recipe_image(recipe_url)
    recipe["source"] = "chefkoch"
    recipe["is_public"] = 0
    if get_bool_value(data, "preview", False):
        return {"success": True, "ok": True, "draft": recipe, **recipe}

    conn = get_db_connection()
    cursor = conn.execute(
        """
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, image_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'chefkoch', ?, CURRENT_TIMESTAMP)
        """,
        (recipe["titel"], recipe["dauer"], recipe["kategorie"], recipe["zutaten"], recipe["anleitung"], recipe["portionen"], owner_name, recipe.get("image_url", "")),
    )
    conn.commit()
    rid = cursor.lastrowid
    row = conn.execute("SELECT * FROM rezepte WHERE id = ?", (rid,)).fetchone()
    conn.close()
    return {"success": True, "ok": True, "id": rid, **serialize_recipe(row)}


CHEFKOCH_HEADERS = {
    "User-Agent": "KochFlow/1.0 (+https://robots-compliance.cc; recipe discovery)",
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.6",
}


def normalize_chefkoch_url(url: str) -> str:
    value = html_lib.unescape(str(url or "").strip())
    if value.startswith("//"):
        value = "https:" + value
    if value.startswith("/"):
        value = "https://www.chefkoch.de" + value
    value = value.split("#", 1)[0]
    if not re.match(r"^https://www\.chefkoch\.de/rezepte/\d+/.+\.html$", value):
        raise HTTPException(status_code=400, detail="Bitte gib einen gültigen Chefkoch-Rezeptlink ein.")
    return value


def title_from_chefkoch_url(url: str) -> str:
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    slug = re.sub(r"\.html(?:\?.*)?$", "", slug, flags=re.IGNORECASE)
    slug = unquote(slug).replace("-", " ").replace("_", " ")
    slug = re.sub(r"\s+", " ", slug).strip()
    return slug or "Chefkoch-Rezept"


def first_attr_value(snippet: str, *attrs: str) -> str:
    for attr in attrs:
        match = re.search(rf"{attr}=[\"']([^\"']+)[\"']", snippet, flags=re.IGNORECASE)
        if match:
            return html_lib.unescape(match.group(1)).strip()
    return ""


def image_from_chefkoch_snippet(snippet: str) -> str:
    candidates = re.findall(r"(?:src|data-src|srcset|data-srcset)=[\"']([^\"']+)[\"']", snippet, flags=re.IGNORECASE)
    for candidate in candidates:
        value = html_lib.unescape(candidate).strip().split(",", 1)[0].strip().split(" ", 1)[0]
        if value.startswith("//"):
            value = "https:" + value
        if value.startswith("/"):
            value = "https://www.chefkoch.de" + value
        if re.search(r"\.(jpg|jpeg|png|webp)(\?|$)", value, flags=re.IGNORECASE) and ("chefkoch" in value or "img" in value):
            return value
    return ""


CHEFKOCH_META_CACHE: Dict[str, Dict[str, Any]] = {}


def normalize_image_url(value: str) -> str:
    url = html_lib.unescape(str(value or "").strip())
    if not url:
        return ""
    if url.startswith("//"):
        url = "https:" + url
    if url.startswith("/"):
        url = "https://www.chefkoch.de" + url
    if re.search(r"\.(jpg|jpeg|png|webp)(\?|$)", url, flags=re.IGNORECASE):
        return url
    return ""


def clean_html_text(value: str) -> str:
    text = html_lib.unescape(str(value or ""))
    text = re.sub(r"<script[^>]*>.*?</script>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" -–—\t\n\r")
    return text


def normalize_recipe_description(value: Any) -> str:
    text = clean_html_text(str(value or ""))
    text = re.sub(r"^Chefkoch\s*[-–:]\s*", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\s*\|\s*Chefkoch(?:\.de)?\s*$", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\s*-\s*Wir haben\s+\d+\s+.*$", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\bÜber\s+[0-9.]+\s+Bewertungen?[^.?!]*(?:[.?!]|$)", " ", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\b[0-9]+(?:,[0-9]+)?\s*Sterne[^.?!]*(?:[.?!]|$)", " ", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\s+", " ", text).strip(" -–—:;,.\t\n\r")
    if len(text) < 20:
        return ""
    if len(text) > 320:
        text = text[:317].rsplit(" ", 1)[0].rstrip(" .,;:-") + "..."
    return text


def json_text_values(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        cleaned = clean_html_text(value)
        return [cleaned] if cleaned else []
    if isinstance(value, (int, float)):
        return [str(value)]
    if isinstance(value, list):
        values: List[str] = []
        for item in value:
            values.extend(json_text_values(item))
        return values
    if isinstance(value, dict):
        for key in ("name", "text", "description", "url"):
            if key in value:
                found = json_text_values(value.get(key))
                if found:
                    return found
    return []


def iter_json_ld_nodes(value: Any) -> List[Dict[str, Any]]:
    nodes: List[Dict[str, Any]] = []
    if isinstance(value, list):
        for item in value:
            nodes.extend(iter_json_ld_nodes(item))
    elif isinstance(value, dict):
        nodes.append(value)
        for key in ("@graph", "mainEntity", "item", "hasPart"):
            if key in value:
                nodes.extend(iter_json_ld_nodes(value.get(key)))
    return nodes


def json_ld_types(value: Dict[str, Any]) -> set[str]:
    raw = value.get("@type")
    if isinstance(raw, list):
        return {str(item).lower() for item in raw}
    if raw:
        return {str(raw).lower()}
    return set()


def is_recipe_json_ld(value: Dict[str, Any]) -> bool:
    types = json_ld_types(value)
    return any("recipe" in item for item in types) or any(key in value for key in ("recipeIngredient", "recipeInstructions"))


def extract_instruction_texts(value: Any) -> List[str]:
    texts: List[str] = []
    if isinstance(value, str):
        cleaned = clean_html_text(value)
        if cleaned:
            texts.append(cleaned)
    elif isinstance(value, list):
        for item in value:
            texts.extend(extract_instruction_texts(item))
    elif isinstance(value, dict):
        for key in ("text", "name", "description"):
            if value.get(key):
                cleaned = clean_html_text(str(value.get(key)))
                if cleaned:
                    texts.append(cleaned)
                    break
        for key in ("itemListElement", "steps"):
            if key in value:
                texts.extend(extract_instruction_texts(value.get(key)))
    seen: set[str] = set()
    unique: List[str] = []
    for text in texts:
        compact = re.sub(r"\s+", " ", text).strip()
        key = compact.lower()
        if compact and key not in seen:
            seen.add(key)
            unique.append(compact)
    return unique


def description_from_instructions(value: Any) -> str:
    steps = extract_instruction_texts(value)
    if not steps:
        return ""
    joined = " ".join(steps[:2])
    return normalize_recipe_description(joined)


def strip_title_prefix(text: str, title: str) -> str:
    cleaned = clean_html_text(text)
    title_clean = clean_html_text(title)
    if not cleaned or not title_clean:
        return cleaned
    escaped = re.escape(title_clean)
    cleaned = re.sub(rf"^{escaped}\s*[-–—:]\s*", "", cleaned, flags=re.IGNORECASE).strip()
    title_words = re.escape(title_clean.replace("-", " "))
    cleaned = re.sub(rf"^{title_words}\s*[-–—:]\s*", "", cleaned, flags=re.IGNORECASE).strip()
    return cleaned


def clean_discovery_description_text(text: Any, title: str = "") -> str:
    cleaned = normalize_recipe_description(text)
    if not cleaned:
        return ""
    cleaned = strip_title_prefix(cleaned, title)
    # Chefkoch-Suchergebnisse enthalten häufig reine Navigations-/SEO-Fragmente.
    cleaned = re.sub(r"\s*[►>]+\s*(?:Portionsrechner|Kochbuch|Video[- ]?Tipps?|Kommentare?|Bewertungen?|Zutaten|Zubereitung).*$", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"\bMit\s*[►>]+.*$", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"\b(?:Portionsrechner|Kochbuch|Video[- ]?Tipps?|Kommentare?|Bewertungen?)\b.*$", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -–—:;,.")
    if len(cleaned) < 18:
        return ""
    if len(cleaned) > 260:
        cleaned = cleaned[:257].rsplit(" ", 1)[0].rstrip(" .,;:-") + "..."
    return cleaned


def recipe_ingredients_from_json_ld(value: Any) -> List[str]:
    ingredients: List[str] = []
    nodes = iter_json_ld_nodes(value)
    recipe_nodes = [node for node in nodes if is_recipe_json_ld(node)] or nodes
    for node in recipe_nodes:
        if not isinstance(node, dict):
            continue
        raw = node.get("recipeIngredient") or node.get("ingredients")
        for item in json_text_values(raw):
            cleaned = ingredient_preview_name(item)
            if cleaned and cleaned.lower() not in {x.lower() for x in ingredients}:
                ingredients.append(cleaned)
            if len(ingredients) >= 5:
                return ingredients
    return ingredients


def ingredient_preview_name(value: Any) -> str:
    text = clean_html_text(str(value or ""))
    if not text:
        return ""
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"^\s*(?:\d+[\d\s.,/]*|[¼½¾⅓⅔⅛⅜⅝⅞]+)\s*", "", text)
    text = re.sub(
        r"^\s*(?:g|kg|mg|ml|l|liter|el|tl|esslöffel|teelöffel|prise[n]?|pck\.?|packung(?:en)?|dose[n]?|glas|gläser|bund|stück|stk\.?|zehe[n]?|becher|scheibe[n]?|blatt|blätter)\s+",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\s+", " ", text).strip(" -–—,.;:")
    text = re.sub(r"\b(?:nach Geschmack|optional|n\.?\s*B\.?)\b", "", text, flags=re.IGNORECASE).strip(" -–—,.;:")
    if not text or len(text) < 3:
        return ""
    if len(text) > 34:
        text = text[:31].rsplit(" ", 1)[0].rstrip(" .,;:-") + "..."
    return text[:1].upper() + text[1:]


def first_instruction_preview_from_json_ld(value: Any) -> str:
    nodes = iter_json_ld_nodes(value)
    recipe_nodes = [node for node in nodes if is_recipe_json_ld(node)] or nodes
    for node in recipe_nodes:
        if not isinstance(node, dict):
            continue
        for step in extract_instruction_texts(node.get("recipeInstructions")):
            cleaned = clean_discovery_description_text(step)
            if cleaned and len(cleaned) >= 35:
                if len(cleaned) > 155:
                    cleaned = cleaned[:152].rsplit(" ", 1)[0].rstrip(" .,;:-") + "..."
                return cleaned
    return ""


def join_german_list(items: List[str]) -> str:
    clean_items = [item for item in items if item]
    if not clean_items:
        return ""
    if len(clean_items) == 1:
        return clean_items[0]
    if len(clean_items) == 2:
        return f"{clean_items[0]} und {clean_items[1]}"
    return f"{', '.join(clean_items[:-1])} und {clean_items[-1]}"


def low_value_description(text: str, title: str = "") -> bool:
    cleaned = clean_discovery_description_text(text, title)
    if not cleaned:
        return True
    lowered = cleaned.lower()
    if any(word in lowered for word in ("portionsrechner", "kochbuch", "video-tipps", "video tipps", "bewertung", "sterne")):
        return True
    # Sehr kurze Werbezeilen wie „wie beim Italiener“ tragen auf Karten wenig Nutzen.
    return len(cleaned) < 45


def build_discovery_description(title: str, raw_description: str = "", ingredients: Optional[List[str]] = None, instruction: str = "") -> str:
    cleaned_description = clean_discovery_description_text(raw_description, title)
    ingredients = ingredients or []
    instruction = clean_discovery_description_text(instruction)

    # Wenn die Beschreibung bereits aus diesem Builder kommt, darf sie beim
    # erneuten Aufruf nicht noch einmal um dieselben Blöcke ergänzt werden.
    has_ingredient_block = bool(re.search(r"\bHauptzutaten\s*:", cleaned_description, flags=re.IGNORECASE))
    has_instruction_block = bool(re.search(r"\b(?:Erster Schritt|Zubereitung)\s*:", cleaned_description, flags=re.IGNORECASE))

    parts: List[str] = []
    if cleaned_description and not low_value_description(cleaned_description, title):
        parts.append(cleaned_description)

    # Die Karten sollen kurz erklären, worum es geht. Hauptzutaten werden nur
    # einmal ergänzt und nicht erneut an bereits aufgebaute Texte angehängt.
    ingredient_text = join_german_list(ingredients[:4])
    if ingredient_text and not has_ingredient_block:
        parts.append(f"Hauptzutaten: {ingredient_text}.")

    if instruction and not has_instruction_block:
        intro = "Zubereitung" if ingredient_text or cleaned_description else "Erster Schritt"
        parts.append(f"{intro}: {instruction}")

    if not parts and cleaned_description:
        parts.append(cleaned_description)

    result = " ".join(parts).strip()
    # Doppelte technische Fragmente entfernen, falls eine Quelle schon denselben
    # Abschnitt geliefert hat.
    result = re.sub(
        r"(Hauptzutaten:\s*[^.]+\.)\s+Hauptzutaten:\s*[^.]+\.",
        r"\1",
        result,
        flags=re.IGNORECASE,
    )
    if not result:
        result = f"{title}: Details, Zutaten und Schritte werden beim Import als bearbeitbarer Entwurf geladen."
    if len(result) > 300:
        result = result[:297].rsplit(" ", 1)[0].rstrip(" .,;:-") + "..."
    return result


def clean_recipe_tag(value: Any) -> str:
    raw = clean_html_text(str(value or ""))
    raw = re.sub(r"https?://\S+", "", raw).strip(" #,;:.|-–—")
    if not raw:
        return ""
    replacements = {
        "http://schema.org/vegandiet": "Vegan",
        "https://schema.org/vegandiet": "Vegan",
        "vegandiet": "Vegan",
        "vegetariandiet": "Vegetarisch",
        "http://schema.org/vegetariandiet": "Vegetarisch",
        "https://schema.org/vegetariandiet": "Vegetarisch",
        "glutenfreediet": "Glutenfrei",
        "lowcaloriediet": "Kalorienarm",
    }
    key = raw.lower().replace(" ", "")
    raw = replacements.get(key, raw)
    raw = re.sub(r"^(rezept|gerichte?|rezepte)\s*[:/-]\s*", "", raw, flags=re.IGNORECASE).strip()
    if raw.lower() in {"chefkoch", "deutsch", "deutschland", "recipe", "rezepte", "rezept"}:
        return ""
    if len(raw) > 22:
        raw = raw[:22].rsplit(" ", 1)[0].strip() or raw[:22].strip()
    return raw[:1].upper() + raw[1:]


def split_keyword_tags(value: Any) -> List[str]:
    tags: List[str] = []
    for text in json_text_values(value):
        for part in re.split(r"[,;|#/]+", text):
            tag = clean_recipe_tag(part)
            if tag:
                tags.append(tag)
    return tags


def add_unique_tag(tags: List[str], value: Any) -> None:
    tag = clean_recipe_tag(value)
    if not tag:
        return
    existing = {item.lower() for item in tags}
    if tag.lower() not in existing:
        tags.append(tag)


def infer_tags_from_text(title: str, description: str = "") -> List[str]:
    haystack = f"{title} {description}".lower()
    rules = [
        (r"\b(vegan|pflanzlich)\b", "Vegan"),
        (r"vegetar", "Vegetarisch"),
        (r"lasagne|spaghetti|pasta|nudel|tagliatelle|rigatoni|maccheroni", "Pasta"),
        (r"salat", "Salat"),
        (r"suppe|eintopf|chili", "Eintopf"),
        (r"kuchen|torte|muffin|brownie|waffel|plätzchen|keks", "Backen"),
        (r"dessert|flan|creme|pudding|eis", "Dessert"),
        (r"hähnchen|chicken|puten|pute|geflügel", "Geflügel"),
        (r"hackfleisch|rind|steak|schwein|fleisch", "Fleisch"),
        (r"fisch|lachs|garnelen|meeresfr", "Fisch"),
        (r"kartoffel", "Kartoffel"),
        (r"reis|risotto|paella", "Reis"),
        (r"italien|bolognese|carbonara|pesto|pizza", "Italienisch"),
        (r"asiatisch|korean|thai|curry|tofu|soja", "Asiatisch"),
        (r"schnell|einfach", "Einfach"),
    ]
    tags: List[str] = []
    for pattern, tag in rules:
        if re.search(pattern, haystack, flags=re.IGNORECASE):
            add_unique_tag(tags, tag)
        if len(tags) >= 3:
            break
    return tags


def tags_from_json_ld(value: Any) -> List[str]:
    tags: List[str] = []
    nodes = iter_json_ld_nodes(value)
    recipe_nodes = [node for node in nodes if is_recipe_json_ld(node)] or nodes
    for node in recipe_nodes:
        for key in ("recipeCategory", "recipeCuisine", "suitableForDiet"):
            for part in json_text_values(node.get(key)):
                add_unique_tag(tags, part)
        for part in split_keyword_tags(node.get("keywords")):
            add_unique_tag(tags, part)
        if len(tags) >= 3:
            break
    return tags[:3]


def normalize_rating(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().replace(",", ".")
    match = re.search(r"\d+(?:\.\d+)?", text)
    if not match:
        return ""
    try:
        number = float(match.group(0))
    except ValueError:
        return ""
    if number <= 0:
        return ""
    return f"{min(number, 5.0):.1f}"


def normalize_count(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().replace(".", "")
    match = re.search(r"\d+", text)
    return match.group(0) if match else ""


def rating_from_json_ld(value: Any) -> Dict[str, str]:
    nodes = iter_json_ld_nodes(value)
    recipe_nodes = [node for node in nodes if is_recipe_json_ld(node)] or nodes
    for node in recipe_nodes:
        rating = node.get("aggregateRating") if isinstance(node, dict) else None
        if isinstance(rating, list):
            rating = rating[0] if rating else None
        if isinstance(rating, dict):
            value_text = normalize_rating(rating.get("ratingValue") or rating.get("value"))
            count_text = normalize_count(rating.get("reviewCount") or rating.get("ratingCount") or rating.get("count"))
            if value_text:
                return {"rating_value": value_text, "rating_count": count_text}
    return {"rating_value": "", "rating_count": ""}


def rating_from_html(page: str) -> Dict[str, str]:
    rating_value = ""
    rating_count = ""
    for pattern in (r'"ratingValue"\s*:\s*"?([0-9]+(?:[,.][0-9]+)?)', r'ratingValue["\']?\s*[:=]\s*["\']?([0-9]+(?:[,.][0-9]+)?)'):
        match = re.search(pattern, page, flags=re.IGNORECASE)
        if match:
            rating_value = normalize_rating(match.group(1))
            break
    for pattern in (r'"(?:reviewCount|ratingCount)"\s*:\s*"?([0-9.]+)', r'Über\s+([0-9.]+)\s+Bewertungen'):
        match = re.search(pattern, page, flags=re.IGNORECASE)
        if match:
            rating_count = normalize_count(match.group(1))
            break
    return {"rating_value": rating_value, "rating_count": rating_count}


def best_json_ld_description(value: Any) -> str:
    nodes = iter_json_ld_nodes(value)
    recipe_nodes = [node for node in nodes if is_recipe_json_ld(node)] or nodes
    fallback = ""
    for node in recipe_nodes:
        description = normalize_recipe_description(node.get("description"))
        if description and not fallback:
            fallback = description
        instruction_description = description_from_instructions(node.get("recipeInstructions"))
        if instruction_description:
            return description if description and len(description) > 45 else instruction_description
    return fallback


def image_from_json_ld(value: Any) -> str:
    if isinstance(value, list):
        for item in value:
            found = image_from_json_ld(item)
            if found:
                return found
    if isinstance(value, dict):
        image = value.get("image")
        if isinstance(image, str):
            return normalize_image_url(image)
        if isinstance(image, list):
            for item in image:
                found = image_from_json_ld(item)
                if found:
                    return found
        if isinstance(image, dict):
            return normalize_image_url(image.get("url") or image.get("contentUrl") or "")
        for key in ("@graph", "mainEntity", "item"):
            found = image_from_json_ld(value.get(key))
            if found:
                return found
    return ""


def description_from_json_ld(value: Any) -> str:
    if isinstance(value, list):
        for item in value:
            found = description_from_json_ld(item)
            if found:
                return found
    if isinstance(value, dict):
        for key in ("description", "abstract"):
            found = normalize_recipe_description(value.get(key))
            if found:
                return found
        for key in ("@graph", "mainEntity", "item"):
            found = description_from_json_ld(value.get(key))
            if found:
                return found
    return ""


def chefkoch_recipe_meta(recipe_url: str) -> Dict[str, Any]:
    if recipe_url in CHEFKOCH_META_CACHE:
        return CHEFKOCH_META_CACHE[recipe_url]

    meta: Dict[str, Any] = {"image": "", "description": "", "tags": [], "rating_value": "", "rating_count": "", "ingredients_preview": [], "instruction_preview": ""}
    try:
        response = requests.get(
            recipe_url,
            headers={**CHEFKOCH_HEADERS, "Referer": "https://www.chefkoch.de/"},
            timeout=12,
        )
        response.raise_for_status()
        page = response.text

        for pattern in (
            r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        ):
            match = re.search(pattern, page, flags=re.IGNORECASE)
            if match:
                meta["image"] = normalize_image_url(match.group(1))
                if meta["image"]:
                    break

        for pattern in (
            r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+name=["\']twitter:description["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:description["\']',
        ):
            match = re.search(pattern, page, flags=re.IGNORECASE)
            if match:
                meta["description"] = clean_discovery_description_text(match.group(1), title_from_chefkoch_url(recipe_url))
                if meta["description"]:
                    break

        for script in re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', page, flags=re.IGNORECASE | re.DOTALL):
            try:
                data = json.loads(html_lib.unescape(script.strip()))
            except Exception:
                continue
            if not meta["image"]:
                meta["image"] = image_from_json_ld(data)
            json_description = clean_discovery_description_text(best_json_ld_description(data), title_from_chefkoch_url(recipe_url))
            json_ingredients = recipe_ingredients_from_json_ld(data)
            json_instruction = first_instruction_preview_from_json_ld(data)
            if json_ingredients and not meta.get("ingredients_preview"):
                meta["ingredients_preview"] = json_ingredients
            if json_instruction and not meta.get("instruction_preview"):
                meta["instruction_preview"] = json_instruction
            candidate_description = build_discovery_description(
                title_from_chefkoch_url(recipe_url),
                json_description or str(meta.get("description", "")),
                list(meta.get("ingredients_preview") or []),
                str(meta.get("instruction_preview") or ""),
            )
            if candidate_description and (not meta["description"] or len(candidate_description) > len(str(meta["description"])) or low_value_description(str(meta["description"]), title_from_chefkoch_url(recipe_url))):
                meta["description"] = candidate_description
            if not meta["tags"]:
                meta["tags"] = tags_from_json_ld(data)
            if not meta["rating_value"]:
                rating = rating_from_json_ld(data)
                meta["rating_value"] = rating.get("rating_value", "")
                meta["rating_count"] = rating.get("rating_count", "")
            if meta["image"] and meta["description"] and meta["tags"] and meta["rating_value"] and meta.get("ingredients_preview"):
                break

        if not meta["rating_value"]:
            rating = rating_from_html(page)
            meta["rating_value"] = rating.get("rating_value", "")
            meta["rating_count"] = rating.get("rating_count", "")

        if not meta["image"]:
            match = re.search(r'https?://img\.chefkoch-cdn\.de/[^"\'<>\s]+\.(?:jpg|jpeg|png|webp)(?:\?[^"\'<>\s]*)?', page, flags=re.IGNORECASE)
            if match:
                meta["image"] = normalize_image_url(match.group(0))

        if not meta["description"]:
            teaser_match = re.search(r'<p[^>]+class=["\'][^"\']*(?:teaser|summary|description)[^"\']*["\'][^>]*>(.*?)</p>', page, flags=re.IGNORECASE | re.DOTALL)
            if teaser_match:
                meta["description"] = clean_discovery_description_text(teaser_match.group(1), title_from_chefkoch_url(recipe_url))
    except Exception:
        pass

    meta["description"] = build_discovery_description(
        title_from_chefkoch_url(recipe_url),
        str(meta.get("description", "")),
        list(meta.get("ingredients_preview") or []),
        str(meta.get("instruction_preview") or ""),
    )

    if not meta.get("tags"):
        meta["tags"] = infer_tags_from_text(title_from_chefkoch_url(recipe_url), str(meta.get("description", "")))
    if not meta.get("tags"):
        meta["tags"] = ["Rezept"]

    CHEFKOCH_META_CACHE[recipe_url] = meta
    return meta


def chefkoch_recipe_image(recipe_url: str) -> str:
    return chefkoch_recipe_meta(recipe_url).get("image", "")


def chefkoch_recipe_description(recipe_url: str) -> str:
    return chefkoch_recipe_meta(recipe_url).get("description", "")


@app.get("/api/image")
def proxy_image(url: str) -> Response:
    image_url = normalize_image_url(url)
    if not image_url:
        raise HTTPException(status_code=400, detail="Ungültige Bild-URL")
    if not re.match(r"^https://([^/]+\.)?(chefkoch\.de|chefkoch-cdn\.de)/", image_url, flags=re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Bildquelle nicht erlaubt")
    try:
        response = requests.get(
            image_url,
            headers={**CHEFKOCH_HEADERS, "Referer": "https://www.chefkoch.de/"},
            timeout=15,
        )
        response.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Bild konnte nicht geladen werden: {exc}")
    content_type = response.headers.get("content-type") or "image/jpeg"
    if not content_type.startswith("image/"):
        content_type = "image/jpeg"
    return Response(content=response.content, media_type=content_type)


def chefkoch_discovery_search(search: str, limit: int = 6) -> List[Dict[str, Any]]:
    url = f"https://www.chefkoch.de/rs/s0/{quote_plus(search)}/Rezepte.html"
    response = requests.get(url, headers=CHEFKOCH_HEADERS, timeout=15)
    response.raise_for_status()
    html = response.text

    recipe_pattern = re.compile(r'(?:https?:)?//www\.chefkoch\.de/rezepte/\d+/[^"\'<>\s]+?\.html|/rezepte/\d+/[^"\'<>\s]+?\.html', re.IGNORECASE)
    results: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for match in recipe_pattern.finditer(html):
        try:
            recipe_url = normalize_chefkoch_url(match.group(0))
        except HTTPException:
            continue
        if recipe_url in seen:
            continue
        seen.add(recipe_url)

        start = max(0, match.start() - 1800)
        end = min(len(html), match.end() + 2200)
        snippet = html[start:end]

        title = first_attr_value(snippet, "aria-label", "title", "alt") or title_from_chefkoch_url(recipe_url)
        title = re.sub(r"\s+", " ", re.sub(r"^(Rezept|Bild von)\s*:?\s*", "", title, flags=re.IGNORECASE)).strip() or title_from_chefkoch_url(recipe_url)
        meta = chefkoch_recipe_meta(recipe_url)
        image = image_from_chefkoch_snippet(snippet) or meta.get("image", "")
        description = build_discovery_description(
            title,
            str(meta.get("description", "") or "").strip(),
            list(meta.get("ingredients_preview") or []),
            str(meta.get("instruction_preview") or ""),
        )
        minutes = ""
        minute_match = re.search(r"(\d{1,3})\s*Min\.", html_lib.unescape(snippet), flags=re.IGNORECASE)
        if minute_match:
            minutes = f"{minute_match.group(1)} Min."

        tags = list(meta.get("tags") or [])
        for tag in infer_tags_from_text(title, description):
            add_unique_tag(tags, tag)
        tags = [tag for tag in tags if clean_recipe_tag(tag)][:3] or ["Rezept"]

        results.append({
            "idMeal": recipe_url,
            "id": recipe_url,
            "url": recipe_url,
            "source": "chefkoch",
            "strMeal": title,
            "titel": title,
            "strMealThumb": image,
            "strCategory": tags[0] if tags else "Rezept",
            "strArea": tags[1] if len(tags) > 1 else "",
            "tags": tags,
            "dauer": minutes,
            "rating_value": meta.get("rating_value", ""),
            "rating_count": meta.get("rating_count", ""),
            "description": description,
            "summary": description,
            "strInstructions": description,
        })
        if len(results) >= limit:
            break

    return results


@app.get("/api/entdecken")
def entdecken(request: Request, query: str = "") -> Dict[str, Any]:
    get_current_user(request, required=True)
    search = query.strip()
    if not search:
        return {"success": True, "ok": True, "source": "chefkoch", "meals": []}
    try:
        meals = chefkoch_discovery_search(search, limit=6)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Chefkoch-Suche konnte nicht geladen werden: {exc}")
    return {"success": True, "ok": True, "source": "chefkoch", "meals": meals}


@app.post("/api/import_entdecken")
async def import_entdecken(request: Request) -> Dict[str, Any]:
    get_current_user(request, required=True)
    data = await get_request_data(request)
    url = normalize_chefkoch_url(get_single_value(data, "url").strip() or get_single_value(data, "id").strip())

    try:
        from chefkoch_import import importiere_rezept
        result = importiere_rezept(url)
    except Exception as exc:
        return {"success": False, "ok": False, "error": f"Chefkoch-Import konnte nicht geladen werden: {exc}"}

    if not result.get("erfolg", result.get("success", False)):
        return {"success": False, "ok": False, "error": result.get("fehler") or result.get("error") or "Import fehlgeschlagen"}

    recipe = imported_recipe_from_result(result)
    # Chefkoch-Bilder werden in der Entdecken-Suche angezeigt, aber aus rechtlichen Gründen nicht in eigene Rezepte übernommen.
    recipe["image_url"] = ""
    recipe["source"] = "chefkoch"
    recipe["is_public"] = 0
    return {"success": True, "ok": True, "draft": recipe, **recipe}


@app.post("/api/import_apimeal/{api_id}")
async def import_mealdb(api_id: str, request: Request, preview: bool = False) -> Dict[str, Any]:
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

    recipe = {
        "titel": title,
        "dauer": 30,
        "kategorie": category,
        "zutaten": "\n".join(ingredients),
        "anleitung": steps_text,
        "portionen": 1,
        "source": "mealdb",
        "is_public": 0,
        "image_url": clean_recipe_image_url(meal.get("strMealThumb") or ""),
    }
    if preview:
        return {"success": True, "ok": True, "draft": recipe, **recipe}

    conn = get_db_connection()
    cursor = conn.execute(
        """
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, image_url, created_at)
        VALUES (?, 30, ?, ?, ?, 1, ?, 0, 'mealdb', ?, CURRENT_TIMESTAMP)
        """,
        (title, category, "\n".join(ingredients), steps_text, owner_name, recipe.get("image_url", "")),
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
    recipe["source"] = "text"
    recipe["is_public"] = 0
    if get_bool_value(data, "preview", False):
        return {"success": True, "ok": True, "draft": recipe, **recipe}

    conn = get_db_connection()
    cursor = conn.execute(
        """
        INSERT INTO rezepte (titel, dauer, kategorie, zutaten, anleitung, portionen, owner_name, is_public, source, image_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'text', '', CURRENT_TIMESTAMP)
        """,
        (recipe["titel"], recipe["dauer"], recipe["kategorie"], recipe["zutaten"], recipe["anleitung"], recipe["portionen"], owner_name),
    )
    conn.commit()
    rid = cursor.lastrowid
    row = conn.execute("SELECT * FROM rezepte WHERE id = ?", (rid,)).fetchone()
    conn.close()
    return {"success": True, "ok": True, "id": rid, **serialize_recipe(row)}
