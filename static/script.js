// ==========================================
// KONFIGURATION
// ==========================================
const API_BASE_URL = "https://api.robots-compliance.cc";

// ==========================================
// ALLGEMEINE HELFER
// ==========================================
function getQueryParam(param) {
  return new URLSearchParams(window.location.search).get(param);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getRecipeTitle(rezept) {
  return rezept?.titel || rezept?.title || "Unbenanntes Rezept";
}

function getCurrentUser() {
  return localStorage.getItem("kochflow_user") || "";
}

function getAuthToken() {
  return localStorage.getItem("kochflow_token") || "";
}

function setAuth(username, token) {
  localStorage.setItem("kochflow_user", username);
  localStorage.setItem("kochflow_token", token);
  localStorage.removeItem("kochapp_user");
}

function logout() {
  localStorage.removeItem("kochflow_user");
  localStorage.removeItem("kochflow_token");
  window.location.href = "./login.html";
}

function safeNextUrl(next) {
  if (!next) return "./index.html";
  if (next.startsWith("http://") || next.startsWith("https://")) return "./index.html";
  return `./${next.replace(/^\.?\//, "")}`;
}

function requireAuth() {
  if (getAuthToken()) return true;

  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const next = `${currentPage}${window.location.search || ""}`;
  window.location.href = `./login.html?next=${encodeURIComponent(next)}`;
  return false;
}

function authHeaders(extra = {}) {
  const token = getAuthToken();
  const headers = { ...extra };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function apiFetch(path, options = {}) {
  const optionsCopy = { ...options };
  const existingHeaders = optionsCopy.headers || {};
  optionsCopy.headers = authHeaders(existingHeaders);

  const response = await fetch(`${API_BASE_URL}${path}`, optionsCopy);

  if (response.status === 401) {
    localStorage.removeItem("kochflow_user");
    localStorage.removeItem("kochflow_token");

    const currentPage = window.location.pathname.split("/").pop() || "index.html";
    const next = `${currentPage}${window.location.search || ""}`;
    window.location.href = `./login.html?next=${encodeURIComponent(next)}`;
  }

  return response;
}

function renderCurrentUserBadge() {
  const el = document.getElementById("current-user");
  if (!el) return;

  const user = getCurrentUser();
  const token = getAuthToken();

  if (!user || !token) {
    el.innerHTML = `
      <span class="user-chip">Nicht angemeldet</span>
      <a class="small-action" href="./login.html">Anmelden</a>
    `;
    return;
  }

  el.innerHTML = `
    <span class="user-chip">Angemeldet als <strong>${escapeHTML(user)}</strong></span>
    <button type="button" class="small-action" onclick="logout()">Abmelden</button>
  `;
}

function showMessage(elementId, message, type = "info") {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.textContent = message;
  el.className = `message ${type}`;
  el.hidden = false;
}

function setButtonLoading(button, loadingText) {
  if (!button) return;
  button.dataset.originalText = button.textContent;
  button.disabled = true;
  button.textContent = loadingText;
}

function resetButton(button) {
  if (!button) return;
  button.disabled = false;
  button.textContent = button.dataset.originalText || button.textContent;
}

function extractErrorMessage(result, fallback = "Aktion fehlgeschlagen") {
  if (!result) return fallback;

  if (typeof result.detail === "string") return result.detail;
  if (typeof result.error === "string") return result.error;

  if (Array.isArray(result.detail)) {
    return result.detail.map((item) => item.msg || JSON.stringify(item)).join(", ");
  }

  if (result.detail) return JSON.stringify(result.detail);
  return fallback;
}

// ==========================================
// REZEPT-KARTEN
// ==========================================
function renderRecipeCard(rezept, options = {}) {
  const id = rezept.id;
  const title = getRecipeTitle(rezept);
  const isPublic = Number(rezept.is_public || 0) === 1;
  const owner = rezept.owner_name || "Unbekannt";
  const duration = rezept.dauer || 0;
  const source = rezept.source || "manual";

  const categories = (rezept.kategorie || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 4);

  const catHTML = categories.length
    ? categories.map((k) => `<span class="pill">${escapeHTML(k)}</span>`).join("")
    : `<span class="pill muted">Ohne Kategorie</span>`;

  const visibilityBadge = isPublic
    ? `<span class="pill public">Öffentlich</span>`
    : `<span class="pill private">Privat</span>`;

  const sourceBadge = source && source !== "manual"
    ? `<span class="pill imported">Importiert</span>`
    : `<span class="pill muted">Eigenes Rezept</span>`;

  const showOwner = options.showOwner !== false;
  const showEdit = options.showEdit === true;

  return `
    <article class="recipe-card">
      <a class="recipe-card-main" href="./rezepte_detail.html?id=${encodeURIComponent(id)}">
        <div class="recipe-card-header">
          <h3>${escapeHTML(title)}</h3>
          <div class="recipe-card-badges">
            ${catHTML}
            ${visibilityBadge}
            ${sourceBadge}
          </div>
        </div>

        <div class="recipe-card-meta">
          <span>${duration} Min.</span>
          ${showOwner ? `<span>Von ${escapeHTML(owner)}</span>` : ""}
        </div>
      </a>

      <div class="recipe-card-actions">
        <a class="button secondary" href="./rezepte_detail.html?id=${encodeURIComponent(id)}">Kochen</a>
        ${showEdit ? `<a class="button ghost" href="./bearbeiten.html?id=${encodeURIComponent(id)}">Bearbeiten</a>` : ""}
      </div>
    </article>
  `;
}

// ==========================================
// AUTH / LOGIN
// ==========================================
function showAuthTab(mode) {
  const loginForm = document.getElementById("form-login");
  const registerForm = document.getElementById("form-register");
  const loginTab = document.getElementById("tab-login");
  const registerTab = document.getElementById("tab-register");

  if (!loginForm || !registerForm) return;

  loginForm.hidden = mode !== "login";
  registerForm.hidden = mode !== "register";

  loginTab?.classList.toggle("secondary", mode !== "login");
  registerTab?.classList.toggle("secondary", mode !== "register");
}

function initAuthForms() {
  const loginForm = document.getElementById("form-login");
  const registerForm = document.getElementById("form-register");

  if (!loginForm && !registerForm) return;

  const next = getQueryParam("next") || "index.html";

  document.getElementById("tab-login")?.addEventListener("click", () => showAuthTab("login"));
  document.getElementById("tab-register")?.addEventListener("click", () => showAuthTab("register"));

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const msg = document.getElementById("auth-message");
    const btn = e.submitter;

    const payload = {
      username: document.getElementById("login-username")?.value.trim() || "",
      password: document.getElementById("login-password")?.value || "",
    };

    if (!payload.username || !payload.password) {
      showMessage("auth-message", "Bitte Benutzername und Passwort eingeben.", "error");
      return;
    }

    setButtonLoading(btn, "Melde an...");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(extractErrorMessage(result, "Anmeldung fehlgeschlagen"));
      }

      setAuth(result.username, result.token);
      window.location.href = safeNextUrl(next);
    } catch (err) {
      if (msg) {
        msg.textContent = err.message;
        msg.hidden = false;
      }
      resetButton(btn);
    }
  });

  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const msg = document.getElementById("auth-message");
    const btn = e.submitter;

    const password = document.getElementById("register-password")?.value || "";
    const repeat = document.getElementById("register-password-repeat")?.value || "";

    if (password !== repeat) {
      showMessage("auth-message", "Die Passwörter stimmen nicht überein.", "error");
      return;
    }

    const payload = {
      username: document.getElementById("register-username")?.value.trim() || "",
      password,
    };

    if (!payload.username || !payload.password) {
      showMessage("auth-message", "Bitte Benutzername und Passwort eingeben.", "error");
      return;
    }

    setButtonLoading(btn, "Erstelle Konto...");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(extractErrorMessage(result, "Registrierung fehlgeschlagen"));
      }

      setAuth(result.username, result.token);
      window.location.href = safeNextUrl(next);
    } catch (err) {
      if (msg) {
        msg.textContent = err.message;
        msg.hidden = false;
      }
      resetButton(btn);
    }
  });
}

// ==========================================
// HOME / STARTSEITE
// ==========================================
async function loadHomeDashboard() {
  const myContainer = document.getElementById("home-my-recipes");
  const publicContainer = document.getElementById("home-public-recipes");

  if (myContainer) {
    if (!getAuthToken()) {
      myContainer.innerHTML = `
        <article class="empty-card">
          <h3>Private Rezepte</h3>
          <p>Melde dich an, um deine eigenen Rezepte zu sehen und neue Rezepte zu speichern.</p>
          <a class="button" href="./login.html">Anmelden</a>
        </article>
      `;
    } else {
      try {
        const response = await apiFetch("/api/rezepte?scope=mine");
        const data = await response.json();
        const items = (data.rezepte || []).slice(0, 3);

        myContainer.innerHTML = items.length
          ? items.map((r) => renderRecipeCard(r, { showOwner: false, showEdit: true })).join("")
          : `
            <article class="empty-card">
              <h3>Noch keine eigenen Rezepte</h3>
              <p>Erstelle dein erstes Rezept oder importiere eines.</p>
              <a class="button" href="./neues_rezept.html">Rezept erstellen</a>
            </article>
          `;
      } catch (error) {
        myContainer.innerHTML = `<p>Eigene Rezepte konnten nicht geladen werden.</p>`;
      }
    }
  }

  if (publicContainer) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/rezepte?scope=public`);
      const data = await response.json();
      const items = (data.rezepte || []).slice(0, 3);

      publicContainer.innerHTML = items.length
        ? items.map((r) => renderRecipeCard(r, { showOwner: true, showEdit: false })).join("")
        : `
          <article class="empty-card">
            <h3>Noch keine öffentlichen Rezepte</h3>
            <p>Geteilte Rezepte erscheinen später hier.</p>
          </article>
        `;
    } catch (error) {
      publicContainer.innerHTML = `<p>Öffentliche Rezepte konnten nicht geladen werden.</p>`;
    }
  }
}

// ==========================================
// MEINE REZEPTE
// ==========================================
async function loadRezepte() {
  const container = document.getElementById("recipe-list-container");
  if (!container) return;
  if (!requireAuth()) return;

  const suche = getQueryParam("suche") || "";
  const kategorie = getQueryParam("kategorie") || "";

  try {
    const response = await apiFetch(
      `/api/rezepte?scope=mine&suche=${encodeURIComponent(suche)}&kategorie=${encodeURIComponent(kategorie)}`
    );

    if (!response.ok) {
      throw new Error("Rezepte konnten nicht geladen werden");
    }

    const data = await response.json();

    const searchInput = document.getElementById("suche-input");
    if (searchInput) searchInput.value = suche;

    const catSelect = document.getElementById("kategorie-select");
    if (catSelect) {
      catSelect.innerHTML = `<option value="">Alle Kategorien</option>`;

      (data.kategorien || []).forEach((kat) => {
        const selected = kat.toLowerCase() === kategorie.toLowerCase() ? "selected" : "";
        catSelect.innerHTML += `<option value="${escapeHTML(kat)}" ${selected}>${escapeHTML(kat)}</option>`;
      });
    }

    const rezepte = data.rezepte || [];

    container.innerHTML = rezepte.length
      ? rezepte.map((r) => renderRecipeCard(r, { showOwner: false, showEdit: true })).join("")
      : `
        <article class="empty-card">
          <h3>Noch keine eigenen Rezepte gefunden</h3>
          <p>Erstelle ein neues Rezept oder importiere eines.</p>
          <a class="button" href="./neues_rezept.html">Rezept erstellen</a>
        </article>
      `;
  } catch (error) {
    container.innerHTML = `<p>Fehler beim Laden der Rezepte.</p>`;
    console.error(error);
  }
}

// ==========================================
// ÖFFENTLICHE REZEPTE
// ==========================================
async function loadPublicRezepte() {
  const container = document.getElementById("public-recipe-list-container");
  if (!container) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/rezepte?scope=public`);

    if (!response.ok) {
      throw new Error("Öffentliche Rezepte konnten nicht geladen werden");
    }

    const data = await response.json();
    const rezepte = data.rezepte || [];

    container.innerHTML = rezepte.length
      ? rezepte.map((r) => renderRecipeCard(r, { showOwner: true, showEdit: false })).join("")
      : `
        <article class="empty-card">
          <h3>Noch keine öffentlichen Rezepte</h3>
          <p>Wenn Nutzer Rezepte teilen, erscheinen sie hier.</p>
        </article>
      `;
  } catch (error) {
    container.innerHTML = `<p>Fehler beim Laden der öffentlichen Rezepte.</p>`;
    console.error(error);
  }
}

// ==========================================
// REZEPTDETAIL / KOCHMODUS
// ==========================================
let kochSchritte = [];
let aktuellerKochSchritt = 0;
let aktuellesRezept = null;
let geparsteZutaten = [];

async function loadRezeptDetail() {
  const container =
    document.getElementById("standard-ansicht") ||
    document.getElementById("detail-container");

  if (!container) return;

  const id = getQueryParam("id");

  if (!id) {
    container.innerHTML = `<p>Keine Rezept-ID angegeben.</p>`;
    return;
  }

  try {
    const response = await apiFetch(`/api/rezepte/${id}`);

    if (!response.ok) {
      throw new Error("Rezept nicht gefunden oder privat");
    }

    const rezept = await response.json();
    aktuellesRezept = rezept;

    document.title = `${getRecipeTitle(rezept)} · KochFlow`;

    const titleEl = document.getElementById("detail-titel");
    if (titleEl) titleEl.textContent = getRecipeTitle(rezept);

    const ownerEl = document.getElementById("detail-owner");
    if (ownerEl) {
      ownerEl.innerHTML = `
        Von <strong>${escapeHTML(rezept.owner_name || "Unbekannt")}</strong>
        · ${Number(rezept.is_public || 0) === 1 ? "Öffentlich" : "Privat"}
      `;
    }

    const tagsEl = document.getElementById("detail-tags");
    if (tagsEl) {
      let tagsHTML = "";

      if (rezept.kategorie) {
        rezept.kategorie.split(",").forEach((k) => {
          if (k.trim()) tagsHTML += `<span class="pill">${escapeHTML(k.trim())}</span>`;
        });
      }

      tagsHTML += Number(rezept.is_public || 0) === 1
        ? `<span class="pill public">Öffentlich</span>`
        : `<span class="pill private">Privat</span>`;

      tagsEl.innerHTML = tagsHTML;
    }

    const portionenInput = document.getElementById("portionen-rechner");
    if (portionenInput) {
      portionenInput.value = rezept.portionen || 1;
      portionenInput.dataset.standard = rezept.portionen || 1;
    }

    const zutatenList = document.getElementById("detail-zutaten");
    geparsteZutaten = [];

    if (zutatenList) {
      zutatenList.innerHTML = "";

      if (rezept.zutaten) {
        rezept.zutaten.split("\n").forEach((zeile) => {
          if (!zeile.trim()) return;

          const teile = zeile.split("|");

          if (teile.length === 3) {
            const menge = teile[0].trim();
            const einheit = teile[1].trim();
            const name = teile[2].trim();

            zutatenList.innerHTML += `
              <li>
                <strong>
                  <span class="zutat-menge" data-grundmenge="${escapeHTML(menge)}">${escapeHTML(menge)}</span>
                  ${escapeHTML(einheit)}
                </strong>
                ${escapeHTML(name)}
              </li>
            `;

            geparsteZutaten.push({ menge, einheit, name });
          } else {
            zutatenList.innerHTML += `<li>${escapeHTML(zeile)}</li>`;
            geparsteZutaten.push({ menge: "", einheit: "", name: zeile });
          }
        });
      } else {
        zutatenList.innerHTML = `<li>Keine Zutaten angegeben.</li>`;
      }
    }

    kochSchritte = rezept.anleitung
      ? rezept.anleitung.split("|||").filter((s) => s.trim())
      : [];

    const standardSchritteContainer = document.getElementById("standard-schritte-liste");

    if (standardSchritteContainer) {
      standardSchritteContainer.innerHTML = "";

      if (kochSchritte.length > 0) {
        kochSchritte.forEach((schritt, index) => {
          const teile = schritt.split(":::");
          const zeit = teile.length === 2 ? teile[0] : "";
          const text = teile.length === 2 ? teile[1] : teile[0];

          standardSchritteContainer.innerHTML += `
            <article class="step-card">
              <div class="step-number">Schritt ${index + 1}</div>
              ${zeit ? `<div class="step-time">${escapeHTML(zeit)} Min.</div>` : ""}
              <p>${escapeHTML(text)}</p>
            </article>
          `;
        });
      } else {
        standardSchritteContainer.innerHTML = `<p>Keine Anleitung vorhanden.</p>`;
      }
    }

    const isOwner = rezept.owner_name === getCurrentUser();

    const ownerControls = document.getElementById("owner-controls");
    if (ownerControls) ownerControls.style.display = isOwner ? "flex" : "none";

    const visibilityBtn = document.getElementById("btn-visibility");
    if (visibilityBtn) {
      visibilityBtn.textContent =
        Number(rezept.is_public || 0) === 1 ? "Wieder privat machen" : "Öffentlich teilen";
    }
  } catch (error) {
    container.innerHTML = `<p>Fehler beim Laden des Rezepts.</p>`;
    console.error(error);
  }
}

function portionenUmrechnen() {
  const input = document.getElementById("portionen-rechner");
  if (!input) return;

  const neuePortionen = Number(input.value);
  const standardPortionen = Number(input.dataset.standard || 1);

  if (!neuePortionen || !standardPortionen) return;

  document.querySelectorAll(".zutat-menge").forEach((feld) => {
    const grundMenge = Number(String(feld.dataset.grundmenge || "").replace(",", "."));
    if (Number.isNaN(grundMenge)) return;

    const neueMenge = (grundMenge / standardPortionen) * neuePortionen;
    feld.textContent = Number.isInteger(neueMenge)
      ? String(neueMenge)
      : neueMenge.toFixed(1).replace(".", ",");
  });
}

function startKochmodus() {
  if (kochSchritte.length === 0) {
    alert("Dieses Rezept hat keine Anleitungsschritte.");
    return;
  }

  const standardAnsicht = document.getElementById("standard-ansicht");
  if (standardAnsicht) standardAnsicht.style.display = "none";

  const pageHeader = document.querySelector(".page-header");
  if (pageHeader) pageHeader.style.display = "none";

  const nav = document.querySelector(".app-nav");
  if (nav) nav.style.display = "none";

  const overlay = document.getElementById("kochmodus-overlay");
  if (overlay) overlay.style.display = "flex";

  aktuellerKochSchritt = 0;
  renderAktuellenKochSchritt();
}

function beendeKochmodus() {
  const overlay = document.getElementById("kochmodus-overlay");
  if (overlay) overlay.style.display = "none";

  const standardAnsicht = document.getElementById("standard-ansicht");
  if (standardAnsicht) standardAnsicht.style.display = "";

  const pageHeader = document.querySelector(".page-header");
  if (pageHeader) pageHeader.style.display = "";

  const nav = document.querySelector(".app-nav");
  if (nav) nav.style.display = "";
}

function renderAktuellenKochSchritt() {
  const schritt = kochSchritte[aktuellerKochSchritt];
  if (!schritt) return;

  const teile = schritt.split(":::");
  const zeit = teile.length === 2 ? teile[0] : "";
  const text = teile.length === 2 ? teile[1] : teile[0];

  const textEl = document.getElementById("koch-schritt-text");
  if (textEl) textEl.textContent = text;

  const progressEl = document.getElementById("koch-fortschritt");
  if (progressEl) progressEl.textContent = `${aktuellerKochSchritt + 1} / ${kochSchritte.length}`;

  const textLower = text.toLowerCase();

  const erkannteZutaten = geparsteZutaten.filter((zutat) => {
    if (!zutat.name) return false;

    const nameLower = zutat.name.toLowerCase();
    const worte = nameLower.split(" ").filter((wort) => wort.length > 3);

    if (worte.length === 0) {
      return textLower.includes(nameLower);
    }

    return worte.some((wort) => textLower.includes(wort));
  });

  const zeitHtml = zeit ? `<span class="pill">${escapeHTML(zeit)} Min.</span>` : "";

  const zutatenHtml = erkannteZutaten
    .map((z) => `<span class="pill">${escapeHTML(z.menge)} ${escapeHTML(z.einheit)} ${escapeHTML(z.name)}</span>`)
    .join("");

  const hinweisEl = document.getElementById("koch-zutaten-hinweis");
  if (hinweisEl) hinweisEl.innerHTML = `${zeitHtml}${zutatenHtml}`;

  const btnZurueck = document.getElementById("btn-koch-zurueck");
  if (btnZurueck) btnZurueck.disabled = aktuellerKochSchritt === 0;

  const btnWeiter = document.getElementById("btn-koch-weiter");

  if (btnWeiter) {
    if (aktuellerKochSchritt >= kochSchritte.length - 1) {
      btnWeiter.textContent = "Fertig";
      btnWeiter.onclick = beendeKochmodus;
    } else {
      btnWeiter.textContent = "Weiter";
      btnWeiter.onclick = naechsterSchritt;
    }
  }
}

function naechsterSchritt() {
  if (aktuellerKochSchritt < kochSchritte.length - 1) {
    aktuellerKochSchritt++;
    renderAktuellenKochSchritt();
  }
}

function vorherigerSchritt() {
  if (aktuellerKochSchritt > 0) {
    aktuellerKochSchritt--;
    renderAktuellenKochSchritt();
  }
}

async function toggleRezeptVisibility() {
  const id = getQueryParam("id");
  if (!id || !aktuellesRezept) return;

  const nextPublic = Number(aktuellesRezept.is_public || 0) !== 1;

  try {
    const response = await apiFetch(`/api/rezepte/${id}/visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_public: nextPublic }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(extractErrorMessage(result, "Sichtbarkeit konnte nicht geändert werden"));
    }

    location.reload();
  } catch (error) {
    alert("Fehler: " + error.message);
  }
}

async function rezeptLoeschen() {
  const id = getQueryParam("id");
  if (!id) return alert("Keine Rezept-ID gefunden.");

  if (!confirm("Möchtest du dieses Rezept wirklich löschen?")) return;

  try {
    const response = await apiFetch(`/api/rezepte/${id}`, {
      method: "DELETE",
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
      throw new Error(extractErrorMessage(result, "Löschen fehlgeschlagen"));
    }

    window.location.href = "./rezepte.html";
  } catch (error) {
    alert("Fehler beim Löschen: " + error.message);
  }
}

// ==========================================
// EINKAUFSLISTE
// ==========================================
async function loadEinkaufsliste() {
  const listRezepte = document.getElementById("einkauf-rezepte");
  const listZutaten = document.getElementById("einkauf-zutaten");
  const listManuell = document.getElementById("einkauf-manuell");
  const manuellHeader = document.getElementById("manuell-header");

  if (!listRezepte && !listZutaten && !listManuell) return;
  if (!requireAuth()) return;

  try {
    const response = await apiFetch("/api/einkaufsliste");

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(extractErrorMessage(result, "Einkaufsliste konnte nicht geladen werden"));
    }

    const data = result;

    if (listRezepte) {
      listRezepte.innerHTML = "";

      if (data.rezepte && data.rezepte.length > 0) {
        const rezepteBox = document.createElement("div");
        rezepteBox.className = "shopping-recipe-tags";

        data.rezepte.forEach((titel) => {
          const badge = document.createElement("span");
          badge.className = "pill shopping-recipe-pill";

          const titleSpan = document.createElement("span");
          titleSpan.textContent = titel;

          const removeButton = document.createElement("button");
          removeButton.type = "button";
          removeButton.className = "small-action danger";
          removeButton.textContent = "×";
          removeButton.setAttribute("aria-label", `${titel} entfernen`);
          removeButton.addEventListener("click", () => removeRezeptFromEinkaufsliste(titel));

          badge.appendChild(titleSpan);
          badge.appendChild(removeButton);
          rezepteBox.appendChild(badge);
        });

        listRezepte.appendChild(rezepteBox);
      } else {
        listRezepte.innerHTML = `<p class="empty-note">Keine Rezepte auf der Einkaufsliste.</p>`;
      }
    }

    if (listZutaten || listRezepte) {
      const targetList = listZutaten || listRezepte;

      if (listZutaten) {
        listZutaten.innerHTML = "";
      }

      if (data.zutaten && data.zutaten.length > 0) {
        data.zutaten.forEach((z) => {
          const li = document.createElement("li");
          li.className = "shopping-ingredient-item";

          const einheit = z.einheit ? ` ${z.einheit}` : "";
          const menge = z.menge ? `${z.menge}${einheit} ` : "";

          li.innerHTML = `
            <label class="shopping-check">
              <input type="checkbox">
              <span><strong>${escapeHTML(menge)}</strong>${escapeHTML(z.name)}</span>
            </label>
          `;

          targetList.appendChild(li);
        });
      } else if (listZutaten) {
        listZutaten.innerHTML = `<li>Die Zutatenliste ist leer.</li>`;
      }
    }

    if (listManuell) {
      listManuell.innerHTML = "";

      if (data.manuell && data.manuell.length > 0) {
        if (manuellHeader) manuellHeader.style.display = "block";

        data.manuell.forEach((item) => {
          const li = document.createElement("li");
          li.className = "shopping-recipe-item";

          const label = document.createElement("label");
          label.className = "shopping-check";
          label.innerHTML = `
            <input type="checkbox">
            <span>${escapeHTML(item.name)}</span>
          `;

          const removeButton = document.createElement("button");
          removeButton.type = "button";
          removeButton.className = "small-action danger";
          removeButton.textContent = "Entfernen";
          removeButton.addEventListener("click", () => removeManuellFromEinkaufsliste(item.id));

          li.appendChild(label);
          li.appendChild(removeButton);
          listManuell.appendChild(li);
        });
      } else {
        if (manuellHeader) manuellHeader.style.display = "none";
      }
    }
  } catch (error) {
    console.error(error);

    if (listRezepte) {
      listRezepte.innerHTML = `<li>Fehler beim Laden der Einkaufsliste.</li>`;
    }
  }
}

async function addToEinkaufsliste(rezeptId) {
  if (!requireAuth()) return;

  try {
    const response = await apiFetch(`/api/einkaufsliste/${encodeURIComponent(rezeptId)}`, {
      method: "POST",
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
      throw new Error(extractErrorMessage(result, "Fehler beim Hinzufügen"));
    }

    alert("Zutaten wurden zur Einkaufsliste hinzugefügt.");
  } catch (error) {
    alert("Fehler beim Hinzufügen zur Einkaufsliste: " + error.message);
  }
}

async function addRezeptToEinkaufsliste() {
  const id = getQueryParam("id");
  if (!id) return alert("Keine Rezept-ID gefunden.");
  await addToEinkaufsliste(id);
}

async function removeRezeptFromEinkaufsliste(titel) {
  try {
    const response = await apiFetch("/api/einkaufsliste/entfernen_rezept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titel }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
      throw new Error(extractErrorMessage(result, "Entfernen fehlgeschlagen"));
    }

    await loadEinkaufsliste();
  } catch (error) {
    console.error("Fehler beim Entfernen des Rezepts:", error);
    alert("Fehler beim Entfernen des Rezepts: " + error.message);
  }
}

async function removeManuellFromEinkaufsliste(id) {
  try {
    const itemId = Number(id);

    if (!Number.isInteger(itemId)) {
      throw new Error("Manueller Eintrag hat keine gültige ID.");
    }

    const response = await apiFetch(`/api/einkaufsliste/manuell/${itemId}`, {
      method: "DELETE",
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
      throw new Error(extractErrorMessage(result, "Löschen fehlgeschlagen"));
    }

    await loadEinkaufsliste();
  } catch (error) {
    console.error("Fehler beim Löschen des manuellen Eintrags:", error);
    alert("Fehler beim Löschen: " + error.message);
  }
}

function initManualShoppingForm() {
  const formManuell = document.getElementById("form-einkauf-manuell");
  if (!formManuell) return;

  formManuell.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireAuth()) return;

    const input = document.getElementById("manuell-input");
    const name = input?.value.trim() || "";

    if (!name) return;

    try {
      const response = await apiFetch("/api/einkaufsliste/manuell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success === false) {
        throw new Error(extractErrorMessage(result, "Eintrag konnte nicht hinzugefügt werden"));
      }

      input.value = "";
      await loadEinkaufsliste();
    } catch (error) {
      alert("Fehler beim Hinzufügen: " + error.message);
    }
  });
}

// ==========================================
// FORMULAR-HELFER
// ==========================================
function clearInputs(element) {
  element.querySelectorAll("input, textarea").forEach((input) => {
    if (input.type === "checkbox") {
      input.checked = false;
    } else {
      input.value = "";
    }
  });
}

function cloneFirstRow(containerId, fallbackHTML) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (container.firstElementChild) {
    const neueZeile = container.firstElementChild.cloneNode(true);
    clearInputs(neueZeile);
    container.appendChild(neueZeile);
    return;
  }

  container.insertAdjacentHTML("beforeend", fallbackHTML);
}

function addZutatZeile() {
  cloneFirstRow(
    "zutaten-container",
    `
      <div class="form-row">
        <input type="text" name="zutaten_menge[]" placeholder="Menge">
        <input type="text" name="zutaten_einheit[]" placeholder="Einheit">
        <input type="text" name="zutaten_name[]" placeholder="Zutat" required>
        <button type="button" class="ghost" onclick="removeZeile(this)">Entfernen</button>
      </div>
    `
  );
}

function addSchrittZeile() {
  cloneFirstRow(
    "schritte-container",
    `
      <div class="form-row">
        <input type="number" name="anleitung_dauer[]" placeholder="Min.">
        <textarea name="anleitung_schritt[]" placeholder="Was ist zu tun?" required></textarea>
        <button type="button" class="ghost" onclick="removeZeile(this)">Entfernen</button>
      </div>
    `
  );
}

function addKategorieZeile() {
  cloneFirstRow(
    "kategorie-container",
    `
      <div class="form-row">
        <input type="text" name="kategorie[]" placeholder="z. B. Vegetarisch">
        <button type="button" class="ghost" onclick="removeZeile(this)">Entfernen</button>
      </div>
    `
  );
}

function removeZeile(element) {
  const zeile = element.closest(".form-row") || element.parentElement;
  if (!zeile) return;

  const container = zeile.parentElement;

  if (container && container.children.length > 1) {
    zeile.remove();
  } else {
    clearInputs(zeile);
  }
}

// ==========================================
// NEUES REZEPT
// ==========================================
function initCreateForm() {
  const form = document.getElementById("form-neues-rezept");
  if (!form) return;
  if (!requireAuth()) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = e.submitter;
    const formData = new FormData(form);

    setButtonLoading(btn, "Speichere...");

    try {
      const response = await apiFetch("/api/rezepte", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(extractErrorMessage(result, "Speichern fehlgeschlagen"));
      }

      window.location.href = `./rezepte_detail.html?id=${encodeURIComponent(result.id)}`;
    } catch (error) {
      alert("Fehler beim Speichern: " + error.message);
      resetButton(btn);
    }
  });
}

// ==========================================
// REZEPT BEARBEITEN
// ==========================================
async function loadBearbeitenForm() {
  const form = document.getElementById("form-bearbeiten");
  if (!form) return;
  if (!requireAuth()) return;

  const id = getQueryParam("id");

  if (!id) {
    alert("Keine Rezept-ID gefunden.");
    return;
  }

  try {
    const response = await apiFetch(`/api/rezepte/${id}`);

    if (!response.ok) {
      throw new Error("Rezept konnte nicht geladen werden");
    }

    const rezept = await response.json();

    const titelInput = document.getElementById("titel");
    if (titelInput) titelInput.value = getRecipeTitle(rezept);

    const portionenInput = document.getElementById("portionen");
    if (portionenInput) portionenInput.value = rezept.portionen || 1;

    const publicInput = form.querySelector('input[name="is_public"]');
    if (publicInput) publicInput.checked = Number(rezept.is_public || 0) === 1;

    const katContainer = document.getElementById("kategorie-container");
    if (katContainer) {
      katContainer.innerHTML = "";

      const kats = (rezept.kategorie || "").split(",").map((k) => k.trim()).filter(Boolean);

      if (kats.length) {
        kats.forEach((k) => {
          katContainer.insertAdjacentHTML(
            "beforeend",
            `
              <div class="form-row">
                <input type="text" name="kategorie[]" value="${escapeHTML(k)}" placeholder="z. B. Vegetarisch">
                <button type="button" class="ghost" onclick="removeZeile(this)">Entfernen</button>
              </div>
            `
          );
        });
      } else {
        addKategorieZeile();
      }
    }

    const zutatenContainer = document.getElementById("zutaten-container");
    if (zutatenContainer) {
      zutatenContainer.innerHTML = "";

      const zutaten = (rezept.zutaten || "").split("\n").filter((z) => z.trim());

      if (zutaten.length) {
        zutaten.forEach((zeile) => {
          const teile = zeile.split("|");
          const menge = teile.length === 3 ? teile[0] : "";
          const einheit = teile.length === 3 ? teile[1] : "";
          const name = teile.length === 3 ? teile[2] : zeile;

          zutatenContainer.insertAdjacentHTML(
            "beforeend",
            `
              <div class="form-row">
                <input type="text" name="zutaten_menge[]" value="${escapeHTML(menge)}" placeholder="Menge">
                <input type="text" name="zutaten_einheit[]" value="${escapeHTML(einheit)}" placeholder="Einheit">
                <input type="text" name="zutaten_name[]" value="${escapeHTML(name)}" placeholder="Zutat" required>
                <button type="button" class="ghost" onclick="removeZeile(this)">Entfernen</button>
              </div>
            `
          );
        });
      } else {
        addZutatZeile();
      }
    }

    const schritteContainer = document.getElementById("schritte-container");
    if (schritteContainer) {
      schritteContainer.innerHTML = "";

      const schritte = (rezept.anleitung || "").split("|||").filter((s) => s.trim());

      if (schritte.length) {
        schritte.forEach((schritt) => {
          const teile = schritt.split(":::");
          const zeit = teile.length === 2 ? teile[0] : "";
          const text = teile.length === 2 ? teile[1] : teile[0];

          schritteContainer.insertAdjacentHTML(
            "beforeend",
            `
              <div class="form-row">
                <input type="number" name="anleitung_dauer[]" value="${escapeHTML(zeit)}" placeholder="Min.">
                <textarea name="anleitung_schritt[]" placeholder="Was ist zu tun?" required>${escapeHTML(text)}</textarea>
                <button type="button" class="ghost" onclick="removeZeile(this)">Entfernen</button>
              </div>
            `
          );
        });
      } else {
        addSchrittZeile();
      }
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const btn = e.submitter;
      const formData = new FormData(form);

      setButtonLoading(btn, "Aktualisiere...");

      try {
        const updateResponse = await apiFetch(`/api/rezepte/${id}`, {
          method: "PUT",
          body: formData,
        });

        const result = await updateResponse.json();

        if (!updateResponse.ok || !result.success) {
          throw new Error(extractErrorMessage(result, "Aktualisieren fehlgeschlagen"));
        }

        window.location.href = `./rezepte_detail.html?id=${encodeURIComponent(id)}`;
      } catch (error) {
        alert("Fehler beim Aktualisieren: " + error.message);
        resetButton(btn);
      }
    });
  } catch (error) {
    alert("Fehler beim Laden der Bearbeitungsdaten: " + error.message);
    console.error(error);
  }
}

// ==========================================
// IMPORT / ENTDECKEN
// ==========================================
function initImportForms() {
  const formChefkoch = document.getElementById("form-import-chefkoch");
  if (!formChefkoch) return;
  if (!requireAuth()) return;

  formChefkoch.addEventListener("submit", async (e) => {
    e.preventDefault();

    const url = document.getElementById("url")?.value.trim() || "";
    const btn = e.submitter;
    const msgBox = document.getElementById("import-message");

    if (!url) {
      showMessage("import-message", "Bitte einen Chefkoch-Link eingeben.", "error");
      return;
    }

    setButtonLoading(btn, "Importiere...");

    try {
      const response = await apiFetch("/api/import_chefkoch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(extractErrorMessage(result, "Import fehlgeschlagen"));
      }

      window.location.href = `./bearbeiten.html?id=${encodeURIComponent(result.id)}`;
    } catch (error) {
      if (msgBox) {
        msgBox.textContent = `Fehler: ${error.message}`;
        msgBox.hidden = false;
        msgBox.style.display = "block";
      }
      resetButton(btn);
    }
  });
}

async function apiRezeptImportieren(apiId, btnElement) {
  if (!requireAuth()) return;

  setButtonLoading(btnElement, "Importiere...");

  try {
    const response = await apiFetch(`/api/import_apimeal/${encodeURIComponent(apiId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(extractErrorMessage(result, "Import fehlgeschlagen"));
    }

    window.location.href = `./bearbeiten.html?id=${encodeURIComponent(result.id)}`;
  } catch (error) {
    alert("Fehler beim Import: " + error.message);
    resetButton(btnElement);
  }
}

async function loadEntdecken() {
  const container = document.getElementById("entdecken-container");
  if (!container) return;

  const suche = getQueryParam("suche") || "pasta";
  const input = document.getElementById("entdecken-suche-input");
  if (input) input.value = suche;

  try {
    const response = await fetch(
      `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(suche)}`
    );

    const data = await response.json();

    container.innerHTML = "";

    if (data.meals && data.meals.length > 0) {
      data.meals.forEach((rezept) => {
        container.innerHTML += `
          <article class="recipe-card external-recipe-card">
            <img src="${escapeHTML(rezept.strMealThumb)}" alt="${escapeHTML(rezept.strMeal)}" class="recipe-thumb">
            <div class="recipe-card-header">
              <h3>${escapeHTML(rezept.strMeal)}</h3>
              <div class="recipe-card-badges">
                <span class="pill">${escapeHTML(rezept.strCategory || "Kategorie")}</span>
                <span class="pill muted">${escapeHTML(rezept.strArea || "International")}</span>
              </div>
            </div>
            <div class="recipe-card-actions">
              <button type="button" onclick="apiRezeptImportieren('${escapeHTML(rezept.idMeal)}', this)">
                In meine App importieren
              </button>
            </div>
          </article>
        `;
      });
    } else {
      container.innerHTML = `
        <article class="empty-card">
          <h3>Keine Treffer gefunden</h3>
          <p>Tipp: Die externe Datenbank nutzt englische Suchbegriffe.</p>
        </article>
      `;
    }
  } catch (error) {
    container.innerHTML = `<p>Fehler beim Abrufen der Rezeptdaten.</p>`;
    console.error(error);
  }
}

// ==========================================
// INITIALISIERUNG
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  renderCurrentUserBadge();

  initAuthForms();

  loadHomeDashboard();
  loadRezepte();
  loadPublicRezepte();
  loadRezeptDetail();
  loadBearbeitenForm();
  loadEinkaufsliste();
  loadEntdecken();

  initCreateForm();
  initImportForms();
  initManualShoppingForm();
});
