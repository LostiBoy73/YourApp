const API_BASE_URL = "https://api.robots-compliance.cc";

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getRecipeTitle(recipe) {
  return recipe?.titel ?? recipe?.title ?? recipe?.strMeal ?? "Unbenanntes Rezept";
}

function parseStoredUser(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return { username: parsed };
    if (parsed && typeof parsed === "object") return parsed;
  } catch (_error) {
    return { username: raw };
  }
  return null;
}

function getCurrentUser() {
  return parseStoredUser(localStorage.getItem("kochflow_user"));
}

function getCurrentUsername() {
  const user = getCurrentUser();
  return user?.username || user?.name || "";
}

function isRootUser() {
  const user = getCurrentUser();
  const username = getCurrentUsername().toLowerCase();
  return user?.is_root === true || username === "root";
}

function getAuthToken() {
  return localStorage.getItem("kochflow_token") || "";
}

function setAuth(userOrUsername, token) {
  const username = typeof userOrUsername === "string"
    ? userOrUsername
    : (userOrUsername?.username || userOrUsername?.name || "");
  const isRoot = typeof userOrUsername === "object" && userOrUsername
    ? Boolean(userOrUsername.is_root || userOrUsername.root)
    : username.toLowerCase() === "root";
  localStorage.setItem("kochflow_user", JSON.stringify({ username, is_root: isRoot }));
  localStorage.setItem("kochflow_token", token || "");
  localStorage.removeItem("kochapp_user");
}

function clearAuth() {
  localStorage.removeItem("kochflow_user");
  localStorage.removeItem("kochflow_token");
}

function logout() {
  clearAuth();
  window.location.href = "index.html";
}

function safeNextUrl() {
  const current = window.location.pathname.split("/").pop() + window.location.search;
  return encodeURIComponent(current || "index.html");
}

function safeRedirectTarget(value) {
  if (!value) return "index.html";
  if (value.startsWith("http://") || value.startsWith("https://")) return "index.html";
  return value.replace(/^\.\//, "");
}

function requireAuth() {
  if (!getAuthToken()) {
    window.location.href = `login.html?next=${safeNextUrl()}`;
    return false;
  }
  return true;
}

function authHeaders(extraHeaders = {}) {
  const token = getAuthToken();
  return {
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function apiFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: authHeaders(options.headers || {})
    });
  } catch (error) {
    const rawMessage = String(error?.message || error || "");
    const looksLikeNetworkError = /failed to fetch|networkerror|load failed|cors|err_failed/i.test(rawMessage);
    if (looksLikeNetworkError || error instanceof TypeError) {
      throw new Error("API nicht erreichbar. Prüfe Backend-Neustart, CORS-Freigabe und ob du die App über die richtige Domain öffnest.");
    }
    throw error;
  }

  let payload = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try { payload = await response.json(); } catch (_error) { payload = null; }
  } else if (response.status !== 204) {
    try { payload = await response.text(); } catch (_error) { payload = null; }
  }

  if (response.status === 401) {
    clearAuth();
    throw new Error("Nicht angemeldet oder Sitzung abgelaufen.");
  }

  if (!response.ok) {
    const message = payload?.detail || payload?.error || (typeof payload === "string" ? payload : `Fehler ${response.status}`);
    throw new Error(message);
  }

  if (payload && typeof payload === "object" && (payload.success === false || payload.ok === false)) {
    throw new Error(payload.detail || payload.error || "Aktion fehlgeschlagen.");
  }

  return payload;
}

function renderCurrentUserBadge() {
  const target = document.getElementById("current-user");
  if (!target) return;

  const username = getCurrentUsername();
  const token = getAuthToken();
  if (!username || !token) {
    target.innerHTML = `
      <small class="auth-status">
        <span>Nicht angemeldet</span>
        <a class="tiny-btn" href="login.html?next=${safeNextUrl()}">Anmelden</a>
      </small>
    `;
    return;
  }

  target.innerHTML = `
    <small class="auth-status">
      <span>Angemeldet als <strong>${escapeHTML(username)}</strong></span>
      <button type="button" class="tiny-btn" onclick="logout()">Abmelden</button>
    </small>
  `;
}

function replaceBrandMarks() {
  document.querySelectorAll(".brand-mark").forEach((mark) => {
    if (mark.querySelector("img")) return;
    mark.innerHTML = '<img src="./static/icon-192.png" alt="KochFlow" class="brand-logo">';
    mark.classList.add("brand-mark-image");
  });
}

function showMessage(element, text, type = "info") {
  if (!element) return;
  element.textContent = text;
  element.className = `message ${type}`;
  element.hidden = false;
}

function setButtonLoading(button, text = "Lädt...") {
  if (!button) return;
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.textContent = text;
  button.disabled = true;
}

function resetButton(button) {
  if (!button) return;
  button.textContent = button.dataset.originalText || button.textContent;
  button.disabled = false;
}

function extractErrorMessage(error) {
  return error?.message || "Unbekannter Fehler";
}

function getImportDraft() {
  const raw = sessionStorage.getItem("kochflow_import_draft");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function setImportDraft(recipe, source) {
  const draft = {
    ...(recipe?.draft || recipe || {}),
    source: source || recipe?.source || recipe?.draft?.source || "external",
    is_public: false
  };
  sessionStorage.setItem("kochflow_import_draft", JSON.stringify(draft));
}

function clearImportDraft() {
  sessionStorage.removeItem("kochflow_import_draft");
}


function showToast(message, type = "success") {
  const oldToast = document.querySelector(".app-toast");
  if (oldToast) oldToast.remove();

  const toast = document.createElement("div");
  toast.className = `app-toast ${type}`;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("is-visible"));
  window.setTimeout(() => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => toast.remove(), 220);
  }, 2600);
}

function normalizeShoppingValue(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function shoppingCheckedKey(type, value) {
  return `kochflow_shopping_checked:${type}:${normalizeShoppingValue(value).toLowerCase()}`;
}

function isShoppingChecked(type, value) {
  return localStorage.getItem(shoppingCheckedKey(type, value)) === "1";
}

function bindShoppingCheckboxes(root) {
  if (!root) return;
  root.querySelectorAll(".shopping-check[data-shopping-type][data-shopping-value]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const key = shoppingCheckedKey(checkbox.dataset.shoppingType, checkbox.dataset.shoppingValue);
      if (checkbox.checked) localStorage.setItem(key, "1");
      else localStorage.removeItem(key);
    });
  });
}

function renderTrashButton(onclick, label = "Entfernen") {
  return `
    <button type="button" class="icon-action icon-action-danger icon-trash" onclick="${onclick}" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM7 9h10l-1 11H8L7 9Z"></path>
      </svg>
    </button>
  `;
}

function renderShoppingIngredientRow(item, type, index) {
  const isManual = type === "manual";
  const isCombined = type === "combined";
  const textPlain = normalizeShoppingValue([
    item?.menge || "",
    item?.einheit || "",
    item?.name || item?.text || item?.zutat || item || ""
  ].filter(Boolean).join(" "));
  const textHTML = renderShoppingIngredientText(item);
  const keyValue = isManual && item?.id ? String(item.id) : `${type}:${textPlain}:${index}`;
  const checked = isShoppingChecked(type, keyValue) ? "checked" : "";
  const checkboxId = `shopping-${type}-${String(keyValue).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const ids = Array.isArray(item?.ids) ? item.ids.filter((value) => Number(value) > 0).map(Number) : [];
  const removeButton = isManual && item?.id
    ? renderTrashButton(`removeManuellFromEinkaufsliste(${Number(item.id)})`, "Manuellen Eintrag entfernen")
    : ((isCombined || !isManual) && ids.length
      ? renderTrashButton(`removeRecipeIngredientFromEinkaufsliste(${JSON.stringify(ids)})`, "Zutat aus Einkaufsliste entfernen")
      : "");

  return `
    <li class="shopping-check-row ${isManual ? "is-manual" : (isCombined ? "is-combined" : "is-recipe")}">
      <label class="shopping-check-label" for="${escapeHTML(checkboxId)}">
        <input
          type="checkbox"
          class="shopping-check"
          id="${escapeHTML(checkboxId)}"
          data-shopping-type="${escapeHTML(type)}"
          data-shopping-value="${escapeHTML(keyValue)}"
          ${checked}
        >
        <span class="shopping-check-text">${textHTML}</span>
      </label>
      ${removeButton ? `<span class="shopping-item-actions">${removeButton}</span>` : ""}
    </li>
  `;
}

function isExternallyImported(source) {
  const normalized = String(source || "").toLowerCase();
  return ["chefkoch", "chefkoch_search", "mealdb", "themealdb", "external", "external_api", "api", "text"].includes(normalized);
}

function formatDate(value) {
  if (!value) return "unbekannt";
  const raw = String(value);
  const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) return "unbekannt";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function tryJSON(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (!((text.startsWith("[") && text.endsWith("]")) || (text.startsWith("{") && text.endsWith("}")))) return null;
  try { return JSON.parse(text); } catch (_error) { return null; }
}

function parseCategories(value) {
  const parsed = tryJSON(value);
  const source = Array.isArray(parsed) ? parsed : value;
  if (Array.isArray(source)) return source.map((item) => String(item).trim()).filter(Boolean);
  return String(source || "").split(/[,;/]/).map((item) => item.trim()).filter(Boolean);
}

function parseIngredientLine(line) {
  const text = String(line || "").trim();
  if (!text) return null;
  const parts = text.split("|").map((part) => part.trim());
  if (parts.length >= 3) {
    return { menge: parts[0], einheit: parts[1], name: parts.slice(2).join("|") };
  }
  return { menge: "", einheit: "", name: text };
}

function parseIngredients(value) {
  const parsed = tryJSON(value);
  const source = Array.isArray(parsed) ? parsed : value;
  if (Array.isArray(source)) {
    return source.map((item) => {
      if (typeof item === "string") return parseIngredientLine(item);
      return {
        menge: item?.menge ?? "",
        einheit: item?.einheit ?? "",
        name: item?.name ?? item?.zutat ?? item?.text ?? ""
      };
    }).filter((item) => item && item.name);
  }
  return String(source || "").split(/\n+/).map(parseIngredientLine).filter((item) => item && item.name);
}

function parseStepLine(line) {
  const text = String(line || "").trim();
  if (!text) return null;
  const [duration, ...rest] = text.split(":::");
  if (rest.length) return { dauer: Number(duration) || 0, schritt: rest.join(":::").trim() };
  return { dauer: 0, schritt: text };
}

function parseSteps(value) {
  const parsed = tryJSON(value);
  const source = Array.isArray(parsed) ? parsed : value;
  if (Array.isArray(source)) {
    return source.map((item) => {
      if (typeof item === "string") return parseStepLine(item);
      return {
        dauer: Number(item?.dauer || 0),
        schritt: item?.schritt ?? item?.text ?? ""
      };
    }).filter((item) => item && item.schritt);
  }
  return String(source || "").split("|||").map(parseStepLine).filter((item) => item && item.schritt);
}

function normalizeRecipe(recipe) {
  if (!recipe || typeof recipe !== "object") return recipe;
  return {
    ...recipe,
    kategorie: parseCategories(recipe.kategorie),
    zutaten: parseIngredients(recipe.zutaten),
    anleitung: parseSteps(recipe.anleitung),
    is_public: recipe.is_public === true || Number(recipe.is_public || 0) === 1,
    favorited: recipe.favorited === true || Number(recipe.favorited || 0) === 1,
    source: recipe.source || "manual"
  };
}

function recipeArray(data) {
  const items = Array.isArray(data) ? data : (data?.rezepte || data?.recipes || data?.items || []);
  return items.map(normalizeRecipe);
}

function iconSVG(name) {
  const icons = {
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.1 0-7 2.1-7 5v1h14v-1c0-2.9-2.9-5-7-5Z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10.01 10.01 0 0 0 12 2Zm1 10.1 3.5 2.1-.9 1.5L11 13V6h2Z"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v2h6V2h2v2h3v18H4V4h3Zm11 8H6v10h12ZM6 8h12V6H6Z"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 2.9 6.1 6.7.9-4.9 4.7 1.2 6.6L12 17.1l-5.9 3.2 1.2-6.6L2.4 9l6.7-.9L12 2Z"/></svg>'
  };
  return icons[name] || "";
}

function renderMetaItem(iconName, label, value) {
  return `
    <span class="recipe-meta-item" title="${escapeHTML(label)}">
      ${iconSVG(iconName)}
      <span><strong>${escapeHTML(label)}:</strong> ${escapeHTML(value)}</span>
    </span>
  `;
}

function recipeImageSrc(recipe) {
  const raw = String(recipe?.image_url || recipe?.bild_url || recipe?.image || recipe?.strMealThumb || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/api/uploads/") || raw.startsWith("/uploads/")) return `${API_BASE_URL}${raw}`;
  if (raw.startsWith("/")) return `${API_BASE_URL}${raw}`;
  if (/chefkoch(?:-cdn)?\.de/i.test(raw)) return `${API_BASE_URL}/api/image?url=${encodeURIComponent(raw)}`;
  return raw;
}

function renderRecipeImage(recipe, title, id) {
  const src = recipeImageSrc(recipe);
  if (!src) {
    return `
      <div class="recipe-card-image recipe-card-placeholder" aria-hidden="true">
        <span>KochFlow</span>
      </div>
    `;
  }
  return `
    <div class="recipe-card-image" aria-hidden="true">
      <img src="${escapeHTML(src)}" alt="${escapeHTML(title)}" loading="lazy" referrerpolicy="no-referrer" onerror="replaceBrokenRecipeImage(this)">
    </div>
  `;
}

function openRecipeCard(event, id) {
  if (!id) return;
  const interactive = event?.target?.closest?.('a, button, input, select, textarea, label, [data-stop-card-click]');
  if (interactive) return;
  window.location.href = `rezepte_detail.html?id=${encodeURIComponent(id)}`;
}

function handleRecipeCardKeydown(event, id) {
  if (!id) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openRecipeCard(event, id);
  }
}

function replaceBrokenRecipeImage(img) {
  const wrapper = img.closest(".recipe-card-image") || img.parentElement;
  if (!wrapper) return;
  wrapper.classList.add("recipe-card-placeholder");
  wrapper.innerHTML = "<span>KochFlow</span>";
}

function renderRecipeCard(rawRecipe, options = {}) {
  const recipe = normalizeRecipe(rawRecipe);
  const id = recipe.id;
  const title = getRecipeTitle(recipe);
  const owner = recipe.owner_name || recipe.owner || "unbekannt";
  const dauer = recipe.dauer ? `${recipe.dauer} Min.` : "keine Angabe";
  const created = formatDate(recipe.created_at);
  const source = recipe.source || "manual";
  const external = isExternallyImported(source);

  const badges = [
    ...(recipe.kategorie.length ? recipe.kategorie.map((category) => `<span class="badge">${escapeHTML(category)}</span>`) : []),
    recipe.is_public ? '<span class="badge badge-public">Öffentlich</span>' : '<span class="badge badge-private">Privat</span>',
    external ? `<span class="badge badge-muted">Import: ${escapeHTML(source)}</span>` : '<span class="badge badge-muted">Eigenes Rezept</span>'
  ].join("");

  const safeId = Number(id) || 0;
  const detailHref = `rezepte_detail.html?id=${encodeURIComponent(id || "")}`;
  const cookHref = `rezepte_detail.html?id=${encodeURIComponent(id || "")}&cook=1`;
  const canFavorite = Boolean(options.showFavorite && getAuthToken() && recipe.is_public && recipe.owner_name !== getCurrentUsername());
  const favoriteButton = canFavorite ? `
    <button type="button" class="card-action card-favorite-action ${recipe.favorited ? "is-favorited" : ""}" data-stop-card-click onclick="toggleFavorite(event, ${safeId}, ${recipe.favorited ? "false" : "true"})" aria-pressed="${recipe.favorited ? "true" : "false"}">
      ${iconSVG("star")}<span>${recipe.favorited ? "Gemerkt" : "Merken"}</span>
    </button>` : "";

  return `
    <article class="recipe-card recipe-card-with-image recipe-card-clickable"
      role="link"
      tabindex="0"
      aria-label="${escapeHTML(title)} öffnen"
      data-href="${escapeHTML(detailHref)}"
      onclick="openRecipeCard(event, ${safeId})"
      onkeydown="handleRecipeCardKeydown(event, ${safeId})">
      ${renderRecipeImage(recipe, title, id)}
      <div class="recipe-card-content">
        <div class="recipe-main">
          <h3 class="recipe-title">${escapeHTML(title)}</h3>
          <div class="recipe-badges">${badges}</div>
          <div class="recipe-meta">
            ${renderMetaItem("clock", "Kochzeit", dauer)}
            ${renderMetaItem("user", "Von", owner)}
            ${renderMetaItem("calendar", "Hochgeladen", created)}
          </div>
        </div>
        <div class="recipe-card-footer">
          <a class="card-action card-cook-action" href="${escapeHTML(cookHref)}" data-stop-card-click onclick="event.stopPropagation()">Direkt kochen</a>
          ${favoriteButton}
          <span class="recipe-card-open-hint" aria-hidden="true">Details</span>
        </div>
      </div>
    </article>
  `;
}

let cachedOwnRecipes = [];
let cachedPublicRecipes = [];
let currentDetailRecipe = null;
let currentStepIndex = 0;

function renderRecipeCollection(container, recipes, options) {
  if (!container) return;
  container.innerHTML = recipes.map((recipe) => renderRecipeCard(recipe, options)).join("") || '<div class="empty-note">Keine passenden Rezepte gefunden.</div>';
}

function ensureRootRecipeAdminControls() {
  if (!isRootUser()) return;
  const container = document.getElementById("recipe-list-container");
  if (!container) return;
  const panel = container.closest("section, .panel, .form-panel, main") || document.querySelector("main");
  if (!panel || document.getElementById("root-admin-recipe-controls")) return;
  const wrapper = document.createElement("div");
  wrapper.id = "root-admin-recipe-controls";
  wrapper.className = "root-admin-controls";
  wrapper.innerHTML = `
    <div>
      <strong>Root-Verwaltung</strong>
      <span>Alle Rezepte inklusive Wochenplan, Favoriten und Einkaufsliste löschen.</span>
    </div>
    <button type="button" class="danger-action" onclick="rootDeleteAllRecipes()">Alle Rezepte löschen</button>
  `;
  panel.insertBefore(wrapper, container);
}

async function rootDeleteAllRecipes() {
  if (!isRootUser()) return;
  const phrase = prompt('Zum Löschen aller Rezepte bitte exakt "ALLE LÖSCHEN" eingeben.');
  if (phrase !== "ALLE LÖSCHEN") return;
  try {
    const result = await apiFetch("/api/admin/rezepte", { method: "DELETE" });
    showToast(`${result?.deleted || 0} Rezepte wurden gelöscht.`);
    await loadRezepte();
    await loadPublicRezepte();
  } catch (error) {
    showToast(extractErrorMessage(error), "error");
  }
}

function updateCachedFavoriteState(recipeId, favorited) {
  [cachedPublicRecipes, cachedOwnRecipes].forEach((list) => {
    list.forEach((recipe) => {
      if (Number(recipe?.id || 0) === Number(recipeId)) recipe.favorited = favorited;
    });
  });
  if (currentDetailRecipe && Number(currentDetailRecipe.id || 0) === Number(recipeId)) {
    currentDetailRecipe.favorited = favorited;
  }
}

async function toggleFavorite(event, recipeId, shouldFavorite = true) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (!requireAuth()) return;
  if (!recipeId) return;
  const button = event?.currentTarget || null;
  if (button) button.disabled = true;
  try {
    await apiFetch(`/api/favoriten/${encodeURIComponent(recipeId)}`, {
      method: shouldFavorite ? "POST" : "DELETE"
    });
    updateCachedFavoriteState(recipeId, shouldFavorite);
    showToast(shouldFavorite
      ? "Rezept wurde für den Wochenplan gemerkt."
      : "Rezept wurde aus den Favoriten entfernt.");

    const publicContainer = document.getElementById("public-recipe-list-container");
    if (publicContainer) renderRecipeCollection(publicContainer, filterRecipes(cachedPublicRecipes), { showFavorite: true });

    const homePublic = document.getElementById("home-public-recipes");
    if (homePublic && cachedPublicRecipes.length) {
      homePublic.innerHTML = cachedPublicRecipes.slice(0, 3).map((recipe) => renderRecipeCard(recipe, { showFavorite: true })).join("");
    }

    if (document.getElementById("detail-favorite-button")) {
      await loadRezeptDetail();
    }
  } catch (error) {
    showToast(extractErrorMessage(error), "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function filterRecipes(recipes) {
  const searchElement = document.getElementById("search") || document.getElementById("suche-input");
  const categoryElement = document.getElementById("filter-kategorie") || document.getElementById("kategorie-select");
  const search = (searchElement?.value || "").trim().toLowerCase();
  const category = (categoryElement?.value || "").trim().toLowerCase();

  return recipes.filter((rawRecipe) => {
    const recipe = normalizeRecipe(rawRecipe);
    const searchableText = [
      getRecipeTitle(recipe),
      recipe.kategorie.join(" "),
      recipe.zutaten.map((item) => renderIngredientText(item)).join(" "),
      recipe.anleitung.map((step) => normalizeStepForDisplay(step).text).join(" ")
    ].join(" ").toLowerCase();
    const textMatches = !search || searchableText.includes(search);
    const categoryMatches = !category || recipe.kategorie.some((item) => item.toLowerCase().includes(category));
    return textMatches && categoryMatches;
  });
}

function populateCategorySelect(recipes) {
  const select = document.getElementById("kategorie-select");
  if (!select) return;
  const current = select.value;
  const categories = new Set();
  recipes.forEach((rawRecipe) => normalizeRecipe(rawRecipe).kategorie.forEach((category) => categories.add(category)));
  select.innerHTML = '<option value="">Alle Kategorien</option>' + Array.from(categories).sort((a, b) => a.localeCompare(b, "de")).map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join("");
  if (current) select.value = current;
}

async function loadHomeDashboard() {
  const myContainer = document.getElementById("home-my-recipes");
  const publicContainer = document.getElementById("home-public-recipes");
  if (!myContainer && !publicContainer) return;

  try {
    if (myContainer) {
      if (getAuthToken()) {
        const data = await apiFetch("/api/rezepte?scope=mine");
        const myRecipes = recipeArray(data);
        myContainer.innerHTML = myRecipes.slice(0, 3).map((recipe) => renderRecipeCard(recipe, { showEdit: true })).join("") || '<div class="empty-note">Noch keine eigenen Rezepte.</div>';
      } else {
        myContainer.innerHTML = '<div class="empty-note">Melde dich an, um eigene Rezepte zu sehen.</div>';
      }
    }

    if (publicContainer) {
      const data = await apiFetch("/api/rezepte/public");
      const publicRecipes = recipeArray(data);
      cachedPublicRecipes = publicRecipes;
      publicContainer.innerHTML = publicRecipes.slice(0, 3).map((recipe) => renderRecipeCard(recipe, { showFavorite: true })).join("") || '<div class="empty-note">Noch keine öffentlichen Rezepte.</div>';
    }
  } catch (error) {
    const message = `<div class="empty-note">${escapeHTML(extractErrorMessage(error))}</div>`;
    if (myContainer) myContainer.innerHTML = message;
    if (publicContainer) publicContainer.innerHTML = message;
  }
}

async function loadRezepte() {
  const container = document.getElementById("recipe-list-container");
  if (!container) return;
  if (!requireAuth()) return;

  try {
    cachedOwnRecipes = recipeArray(await apiFetch("/api/rezepte?scope=mine"));
    populateCategorySelect(cachedOwnRecipes);
    ensureRootRecipeAdminControls();
    renderRecipeCollection(container, filterRecipes(cachedOwnRecipes), { showEdit: true, showDelete: true });
  } catch (error) {
    container.innerHTML = `<div class="empty-note">${escapeHTML(extractErrorMessage(error))}</div>`;
  }
}

async function loadPublicRezepte() {
  const container = document.getElementById("public-recipe-list-container");
  if (!container) return;

  try {
    cachedPublicRecipes = recipeArray(await apiFetch("/api/rezepte/public"));
    populateCategorySelect(cachedPublicRecipes);
    renderRecipeCollection(container, filterRecipes(cachedPublicRecipes), { showFavorite: true });
  } catch (error) {
    container.innerHTML = `<div class="empty-note">${escapeHTML(extractErrorMessage(error))}</div>`;
  }
}

function bindRecipeFilters() {
  const search = document.getElementById("search") || document.getElementById("suche-input");
  const category = document.getElementById("filter-kategorie") || document.getElementById("kategorie-select");
  const filterForm = search?.closest("form") || category?.closest("form");
  if (!search && !category) return;

  const params = new URLSearchParams(window.location.search);
  if (search && params.has("suche")) search.value = params.get("suche") || "";
  if (category && params.has("kategorie")) category.value = params.get("kategorie") || "";

  const rerender = () => {
    renderRecipeCollection(document.getElementById("recipe-list-container"), filterRecipes(cachedOwnRecipes), { showEdit: true, showDelete: true });
    renderRecipeCollection(document.getElementById("public-recipe-list-container"), filterRecipes(cachedPublicRecipes), { showFavorite: true });
  };

  filterForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    rerender();
  });
  search?.addEventListener("input", rerender);
  category?.addEventListener("input", rerender);
}

function renderIngredientText(zutat, factor = 1) {
  const item = typeof zutat === "string" ? parseIngredientLine(zutat) : zutat;
  if (!item) return "";
  const number = Number(String(item.menge ?? "").replace(",", "."));
  const mengeText = Number.isFinite(number) && String(item.menge ?? "").trim() !== ""
    ? Number((number * factor).toFixed(2)).toString().replace(".", ",")
    : String(item.menge ?? "");
  return [mengeText, item.einheit || "", item.name || item.zutat || item.text || ""].filter(Boolean).join(" ");
}

function normalizeIngredientForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getIngredientName(value) {
  if (typeof value === "string") return parseIngredientLine(value)?.name || value;
  return value?.name || value?.zutat || value?.text || "";
}

function ingredientMentionedInStep(ingredient, stepText) {
  const name = normalizeIngredientForMatch(getIngredientName(ingredient));
  const text = normalizeIngredientForMatch(stepText);
  if (!name || name.length < 3 || !text) return false;

  const candidates = new Set([name]);
  name.split(" ").forEach((part) => {
    if (part.length >= 4) candidates.add(part);
    if (part.endsWith("en") && part.length >= 6) candidates.add(part.slice(0, -2));
    if ((part.endsWith("e") || part.endsWith("n") || part.endsWith("s")) && part.length >= 5) candidates.add(part.slice(0, -1));
  });

  for (const candidate of candidates) {
    if (candidate.length < 3) continue;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|\\s)${escaped}($|\\s)`, "i").test(text)) return true;
  }
  return false;
}

function explicitStepIngredients(step) {
  if (!step || typeof step === "string") return [];
  const raw = step.zutaten || step.ingredients || step.step_ingredients || step.zutatenliste || step.items || "";
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((item) => renderIngredientText(item)).filter(Boolean);
  return String(raw).split(/[;,\n]+/).map((item) => item.trim()).filter(Boolean);
}

function currentPortionFactor() {
  const input = document.getElementById("portionen-input") || document.getElementById("portionen-rechner");
  const original = Number(input?.dataset?.original || currentDetailRecipe?.portionen || 1) || 1;
  const requested = Number(input?.value || original) || original;
  return requested > 0 && original > 0 ? requested / original : 1;
}

function inferStepIngredients(step, stepText) {
  const explicit = explicitStepIngredients(step);
  if (explicit.length) return explicit;

  const factor = currentPortionFactor();
  const ingredients = currentDetailRecipe?.zutaten || [];
  const found = [];
  const seen = new Set();
  ingredients.forEach((ingredient) => {
    if (!ingredientMentionedInStep(ingredient, stepText)) return;
    const label = renderIngredientText(ingredient, factor).trim() || getIngredientName(ingredient);
    const key = normalizeIngredientForMatch(label);
    if (!label || seen.has(key)) return;
    seen.add(key);
    found.push(label);
  });
  return found.slice(0, 6);
}

function renderStepIngredientChips(step, stepText, chipClass = "koch-step-ingredient") {
  const ingredients = inferStepIngredients(step, stepText);
  if (!ingredients.length) return "";
  return `
    <div class="koch-step-ingredients" aria-label="Zutaten für diesen Schritt">
      <span class="koch-step-chip-label">Zutaten</span>
      ${ingredients.map((ingredient) => `<span class="${chipClass}">${escapeHTML(ingredient)}</span>`).join("")}
    </div>
  `;
}

function normalizeStepForDisplay(step) {
  if (typeof step === "string") step = parseStepLine(step);
  return {
    dauer: Number(step?.dauer || 0),
    text: step?.schritt || step?.text || "",
    raw: step
  };
}

function renderStepText(step) {
  const normalized = normalizeStepForDisplay(step);
  const duration = normalized.dauer ? `${normalized.dauer} Min.` : "";
  return [duration, normalized.text].filter(Boolean).join(" ").trim();
}

function renderDetailStepItem(step, index) {
  const normalized = normalizeStepForDisplay(step);
  const duration = normalized.dauer ? `${normalized.dauer} Min.` : "ohne Zeit";
  const text = normalized.text || "Kein Arbeitsschritt angegeben.";

  return `
    <li class="prep-step">
      <span class="prep-step-number" aria-label="Schritt ${index + 1}">${index + 1}</span>
      <span class="prep-step-duration">${escapeHTML(duration)}</span>
      <span class="prep-step-text">${escapeHTML(text)}</span>
    </li>
  `;
}

function renderKochStepContent(step, index, total) {
  const normalized = normalizeStepForDisplay(step);
  const duration = normalized.dauer ? `<span class="koch-step-duration">${escapeHTML(`${normalized.dauer} Min.`)}</span>` : "";
  const text = normalized.text || "Kein Arbeitsschritt angegeben.";
  const ingredientChips = renderStepIngredientChips(normalized.raw, text);

  return `
    <div class="koch-step-display">
      <div class="koch-step-kicker">Schritt ${index + 1} von ${total}</div>
      <div class="koch-step-info">
        ${duration ? `<div class="koch-step-time-row">${duration}</div>` : ""}
        ${ingredientChips ? `<div class="koch-step-chip-divider" aria-hidden="true"></div>${ingredientChips}` : ""}
      </div>
      <div class="koch-step-text">${escapeHTML(text)}</div>
    </div>
  `;
}

function adaptKochStepTypography() {
  const overlay = document.getElementById("kochmodus-overlay");
  if (!overlay || overlay.hidden) return;
  const area = overlay.querySelector(".koch-inhalt");
  if (!area) return;

  overlay.classList.remove("koch-text-compact", "koch-text-ultra-compact");

  requestAnimationFrame(() => {
    const needsCompact = area.scrollHeight > area.clientHeight + 6;
    if (!needsCompact) return;
    overlay.classList.add("koch-text-compact");

    requestAnimationFrame(() => {
      if (area.scrollHeight > area.clientHeight + 6) {
        overlay.classList.add("koch-text-ultra-compact");
      }
    });
  });
}

async function loadRezeptDetail() {
  const title = document.getElementById("detail-titel");
  if (!title) return;

  const id = getQueryParam("id");
  if (!id) {
    title.textContent = "Rezept nicht gefunden";
    return;
  }

  try {
    const recipe = normalizeRecipe(await apiFetch(`/api/rezepte/${id}`));
    currentDetailRecipe = recipe;

    const currentUsername = getCurrentUsername();
    const isOwner = currentUsername && recipe.owner_name === currentUsername;
    const source = recipe.source || "manual";
    const external = isExternallyImported(source);

    title.textContent = getRecipeTitle(recipe);
    const categoryContainer = document.getElementById("detail-kategorie") || document.getElementById("detail-tags");
    if (categoryContainer) {
      categoryContainer.innerHTML = [
        ...recipe.kategorie.map((category) => `<span class="badge">${escapeHTML(category)}</span>`),
        recipe.is_public ? '<span class="badge badge-public">Öffentlich</span>' : '<span class="badge badge-private">Privat</span>',
        external ? `<span class="badge badge-muted">Import: ${escapeHTML(source)}</span>` : '<span class="badge badge-muted">Eigenes Rezept</span>'
      ].join("");
    }

    const meta = document.getElementById("detail-meta") || document.getElementById("detail-owner");
    if (meta) {
      meta.innerHTML = `
        ${renderMetaItem("clock", "Kochzeit", recipe.dauer ? `${recipe.dauer} Min.` : "keine Angabe")}
        ${renderMetaItem("user", "Von", recipe.owner_name || "unbekannt")}
        ${renderMetaItem("calendar", "Hochgeladen", formatDate(recipe.created_at))}
      `;
    }

    const portionen = Number(recipe.portionen || 1);
    const portionInput = document.getElementById("portionen-input") || document.getElementById("portionen-rechner");
    if (portionInput) {
      portionInput.value = portionen;
      portionInput.dataset.original = String(portionen);
    }

    renderDetailIngredients(1);
    renderDetailSteps();
    renderDetailRecipeImage(recipe);

    const ownerControls = document.getElementById("owner-controls");
    if (ownerControls) {
      ownerControls.hidden = !isOwner;
      ownerControls.style.display = isOwner ? "flex" : "none";
    }

    const editLink = document.getElementById("edit-rezept-link");
    if (editLink) editLink.href = `bearbeiten.html?id=${id}`;

    const visibilityButton = document.getElementById("btn-visibility");
    if (visibilityButton) {
      visibilityButton.textContent = recipe.is_public ? "Privat machen" : "Öffentlich machen";
      visibilityButton.disabled = external;
      visibilityButton.title = external ? "Importierte Rezepte bleiben privat." : "";
    }

    ensureDetailRecipeActions(recipe, isOwner, external);
    maybeStartDetailCookMode();
  } catch (error) {
    title.textContent = "Rezept konnte nicht geladen werden";
    const detail = document.getElementById("standard-ansicht");
    if (detail) detail.innerHTML = `<div class="empty-note">${escapeHTML(extractErrorMessage(error))}</div>`;
  }
}

function renderDetailIngredients(factor = 1) {
  const list = document.getElementById("detail-zutaten");
  if (!list || !currentDetailRecipe) return;
  list.innerHTML = currentDetailRecipe.zutaten.map((zutat) => `<li>${escapeHTML(renderIngredientText(zutat, factor))}</li>`).join("") || '<li>Keine Zutaten angegeben.</li>';
}

function renderDetailSteps() {
  const list = document.getElementById("standard-schritte-liste");
  if (!list || !currentDetailRecipe) return;
  list.innerHTML = currentDetailRecipe.anleitung.map(renderDetailStepItem).join("") || '<li class="empty-note">Keine Schritte angegeben.</li>';
}

function portionenUmrechnen() {
  const input = document.getElementById("portionen-input") || document.getElementById("portionen-rechner");
  if (!input) return;
  const original = Number(input.dataset.original || currentDetailRecipe?.portionen || 1) || 1;
  const requested = Number(input.value || original) || original;
  renderDetailIngredients(requested / original);
}

function startKochmodus() {
  if (!currentDetailRecipe) return;
  currentStepIndex = 0;
  document.getElementById("standard-ansicht")?.setAttribute("hidden", "hidden");
  const overlay = document.getElementById("kochmodus-overlay");
  if (overlay) {
    overlay.hidden = false;
    overlay.style.display = "flex";
  }
  renderKochStep();
}

function closeKochmodus() {
  const overlay = document.getElementById("kochmodus-overlay");
  if (overlay) {
    overlay.hidden = true;
    overlay.style.display = "none";
  }
  document.getElementById("standard-ansicht")?.removeAttribute("hidden");
}

function renderKochStep() {
  if (!currentDetailRecipe) return;
  const steps = currentDetailRecipe.anleitung;
  const text = document.getElementById("koch-schritt-text");
  const progress = document.getElementById("koch-fortschritt");
  const prev = document.getElementById("btn-prev-step") || document.getElementById("btn-koch-zurueck");
  const next = document.getElementById("btn-next-step") || document.getElementById("btn-koch-weiter");

  if (text) {
    if (steps.length) {
      text.innerHTML = renderKochStepContent(steps[currentStepIndex], currentStepIndex, steps.length);
    } else {
      text.textContent = "Keine Schritte angegeben.";
    }
  }
  if (progress) progress.textContent = steps.length ? `${currentStepIndex + 1} / ${steps.length}` : "0 / 0";
  if (prev) prev.disabled = currentStepIndex <= 0;
  if (next) next.textContent = currentStepIndex >= steps.length - 1 ? "Fertig" : "Weiter";
  adaptKochStepTypography();
}

function nextStep() {
  const steps = currentDetailRecipe?.anleitung || [];
  if (!steps.length || currentStepIndex >= steps.length - 1) {
    closeKochmodus();
    return;
  }
  currentStepIndex += 1;
  renderKochStep();
}

function prevStep() {
  if (currentStepIndex > 0) {
    currentStepIndex -= 1;
    renderKochStep();
  }
}

async function toggleRezeptVisibility() {
  if (!currentDetailRecipe) return;
  if (isExternallyImported(currentDetailRecipe.source)) {
    alert("Importierte Rezepte bleiben privat und können nicht öffentlich markiert werden.");
    return;
  }

  const newValue = !currentDetailRecipe.is_public;
  try {
    await apiFetch(`/api/rezepte/${currentDetailRecipe.id}/visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_public: newValue })
    });
    currentDetailRecipe.is_public = newValue;
    await loadRezeptDetail();
  } catch (error) {
    alert(extractErrorMessage(error));
  }
}

async function rezeptLoeschen(id = null) {
  const recipeId = id || currentDetailRecipe?.id || getQueryParam("id");
  if (!recipeId) return;
  if (!confirm("Dieses Rezept wirklich löschen?")) return;

  try {
    await apiFetch(`/api/rezepte/${recipeId}`, { method: "DELETE" });
    window.location.href = "rezepte.html";
  } catch (error) {
    alert(extractErrorMessage(error));
  }
}

function getShoppingViewMode() {
  return localStorage.getItem("kochflow_shopping_view") || "split";
}

function setShoppingViewMode(mode) {
  localStorage.setItem("kochflow_shopping_view", mode === "combined" ? "combined" : "split");
}

function shoppingItemTextParts(item) {
  const amount = normalizeShoppingValue(item?.menge || item?.amount || "");
  const unit = normalizeShoppingValue(item?.einheit || item?.unit || "");
  const name = normalizeShoppingValue(item?.name || item?.zutat || item?.item || item?.text || item || "");
  return { amount, unit, name };
}

function renderShoppingIngredientText(item) {
  const { amount, unit, name } = shoppingItemTextParts(item);
  const amountText = [amount, unit].filter(Boolean).join(" ");
  if (!amountText) return escapeHTML(name);
  return `<span class="shopping-amount">${escapeHTML(amountText)}</span> ${escapeHTML(name)}`;
}

function discoverImageSrc(imageUrl) {
  const image = String(imageUrl || "").trim();
  if (!image) return "";
  if (/chefkoch(?:-cdn)?\.de/i.test(image)) {
    return `${API_BASE_URL}/api/image?url=${encodeURIComponent(image)}`;
  }
  return image;
}

function normalizeDiscoverTags(meal) {
  const rawTags = Array.isArray(meal?.tags)
    ? meal.tags
    : [meal?.strCategory, meal?.strArea, meal?.category, meal?.area, meal?.kategorie].filter(Boolean);
  const blocked = new Set(["chefkoch", "deutsch", "german", "rezept", "recipe", "external"]);
  const tags = [];
  rawTags.forEach((raw) => {
    String(raw || "")
      .split(/[,;|#/]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .forEach((tag) => {
        const key = tag.toLowerCase();
        if (blocked.has(key)) return;
        if (!tags.some((existing) => existing.toLowerCase() === key)) tags.push(tag);
      });
  });
  return tags.slice(0, 3);
}

function formatGermanNumber(value, digits = 1) {
  const number = Number(String(value || "").replace(",", "."));
  if (!Number.isFinite(number) || number <= 0) return "";
  return number.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatGermanCount(value) {
  const number = Number(String(value || "").replace(/\./g, ""));
  if (!Number.isFinite(number) || number <= 0) return "";
  return number.toLocaleString("de-DE");
}

function renderDiscoverRating(meal) {
  const rawValue = meal?.rating_value || meal?.ratingValue || meal?.rating || meal?.bewertung || "";
  const value = Number(String(rawValue).replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) {
    return `
      <div class="discover-rating discover-rating-empty" aria-label="Keine Bewertungen vorhanden">
        <span class="discover-stars is-muted" aria-hidden="true">☆☆☆☆☆</span>
        <span class="discover-rating-text">Keine Bewertungen</span>
      </div>
    `;
  }
  const normalizedValue = Math.max(0, Math.min(5, value));
  const filled = Math.max(0, Math.min(5, Math.round(normalizedValue)));
  const stars = `${"★".repeat(filled)}${"☆".repeat(5 - filled)}`;
  const count = formatGermanCount(meal?.rating_count || meal?.ratingCount || meal?.reviewCount || meal?.bewertung_count || "");
  const ratingText = `${formatGermanNumber(normalizedValue, 1)} / 5${count ? ` · ${count} Bewertungen` : ""}`;
  return `
    <div class="discover-rating" aria-label="Bewertung ${escapeHTML(ratingText)}">
      <span class="discover-stars" aria-hidden="true">${stars}</span>
      <span class="discover-rating-text">${escapeHTML(formatGermanNumber(normalizedValue, 1))} / 5${count ? ` · <span class="discover-rating-count">${escapeHTML(count)}&nbsp;Bewertungen</span>` : ""}</span>
    </div>
  `;
}

function replaceBrokenDiscoveryImage(img) {
  const placeholder = document.createElement("div");
  placeholder.className = "api-card-placeholder";
  placeholder.textContent = "KochFlow";
  img.replaceWith(placeholder);
}

function renderDetailRecipeImage(recipe) {
  const title = document.getElementById("detail-titel") || document.getElementById("recipe-title") || document.querySelector("h1");
  const panel = document.getElementById("standard-ansicht")?.querySelector(".recipe-detail-main")
    || title?.closest(".detail-panel, article, section")
    || document.querySelector(".detail-panel");
  if (!panel) return;
  panel.querySelector(".recipe-detail-image")?.remove();
  const src = recipeImageSrc(recipe);
  if (!src) return;
  const image = document.createElement("div");
  image.className = "recipe-detail-image";
  image.innerHTML = `<img src="${escapeHTML(src)}" alt="${escapeHTML(getRecipeTitle(recipe))}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.recipe-detail-image')?.remove()">`;
  panel.prepend(image);
}

function ensureDetailRecipeActions(recipe, isOwner, external) {
  const recipeId = Number(recipe?.id || getQueryParam("id") || 0);
  const header = document.getElementById("detail-titel")?.closest(".page-header, .recipe-detail-header, header")
    || document.getElementById("standard-ansicht")
    || document.querySelector("main.container");
  if (!header || !recipeId) return;

  let actionBar = document.getElementById("detail-action-bar");
  if (!actionBar) {
    actionBar = document.createElement("div");
    actionBar.id = "detail-action-bar";
    actionBar.className = "detail-action-bar";
    header.appendChild(actionBar);
  }

  const favoriteAction = (!isOwner && recipe?.is_public && getAuthToken()) ? `
    <button type="button" id="detail-favorite-button" class="secondary favorite-detail-button ${recipe.favorited ? "is-favorited" : ""}" onclick="toggleFavorite(event, ${recipeId}, ${recipe.favorited ? "false" : "true"})" aria-pressed="${recipe.favorited ? "true" : "false"}">
      ${iconSVG("star")}<span>${recipe.favorited ? "Favorit entfernen" : "Für Wochenplan merken"}</span>
    </button>` : "";

  actionBar.innerHTML = `
    <button type="button" class="primary-action" onclick="startKochmodus()">Rezept kochen</button>
    <button type="button" class="secondary" onclick="addRezeptToEinkaufsliste()">Zur Einkaufsliste</button>
    ${favoriteAction}
  `;

  const ingredientList = document.getElementById("detail-zutaten");
  const ingredientPanel = ingredientList?.closest?.(".detail-panel, article, section");
  let management = document.getElementById("detail-management-actions");
  if (!management && ingredientPanel) {
    management = document.createElement("div");
    management.id = "detail-management-actions";
    management.className = "detail-management-actions";
    ingredientPanel.appendChild(management);
  }

  if (management) {
    if (isOwner) {
      const visibilityLabel = recipe?.is_public ? "Privat machen" : "Öffentlich machen";
      management.hidden = false;
      management.innerHTML = `
        <div class="detail-management-title">Rezept verwalten</div>
        <div class="detail-management-buttons">
          <a id="edit-rezept-link" class="secondary" role="button" href="bearbeiten.html?id=${recipeId}">Bearbeiten</a>
          <button type="button" id="btn-visibility" class="secondary" onclick="toggleRezeptVisibility()" ${external ? "disabled" : ""} title="${external ? "Importierte Rezepte bleiben privat." : ""}">${escapeHTML(visibilityLabel)}</button>
          <button type="button" class="danger-action" onclick="rezeptLoeschen(${recipeId})">Löschen</button>
        </div>
      `;
    } else {
      management.hidden = true;
      management.innerHTML = "";
    }
  }

  const legacyOwnerControls = document.getElementById("owner-controls");
  if (legacyOwnerControls && legacyOwnerControls !== actionBar) {
    legacyOwnerControls.hidden = true;
    legacyOwnerControls.style.display = "none";
  }
}

function ensureShoppingListControls(hasEntries = false) {
  const targetList = document.getElementById("einkauf-zutaten");
  if (!targetList) return;
  const panel = targetList.closest(".form-panel, .detail-panel, .panel, section, article") || targetList.parentElement;
  if (!panel) return;

  let wrapper = document.getElementById("shopping-panel-head");
  if (!wrapper) {
    const header = panel.querySelector("h2") || panel.firstElementChild;
    wrapper = document.createElement("div");
    wrapper.id = "shopping-panel-head";
    wrapper.className = "shopping-panel-head";
    wrapper.innerHTML = `
      <div class="shopping-panel-title"></div>
      <div class="shopping-panel-actions">
        <div class="shopping-view-toggle" aria-label="Ansicht der Einkaufsliste">
          <button type="button" id="shopping-view-split" class="small-action" data-shopping-view="split">Abschnitte</button>
          <button type="button" id="shopping-view-combined" class="small-action" data-shopping-view="combined">Gesamtliste</button>
        </div>
        <button type="button" id="btn-einkauf-leeren" class="icon-action icon-action-danger icon-trash" aria-label="Einkaufsliste leeren" title="Einkaufsliste leeren">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM7 9h10l-1 11H8L7 9Z"></path>
          </svg>
          <span class="shopping-clear-text">Liste leeren</span>
        </button>
      </div>
    `;

    if (header && header.tagName?.toLowerCase() === "h2") {
      wrapper.querySelector(".shopping-panel-title").replaceWith(header.cloneNode(true));
      header.replaceWith(wrapper);
    } else {
      panel.prepend(wrapper);
    }

    wrapper.querySelector("#btn-einkauf-leeren")?.addEventListener("click", clearEinkaufsliste);
    wrapper.querySelectorAll("[data-shopping-view]").forEach((button) => {
      button.addEventListener("click", async () => {
        setShoppingViewMode(button.dataset.shoppingView);
        await loadEinkaufsliste();
      });
    });
  }

  const clearButton = document.getElementById("btn-einkauf-leeren");
  if (clearButton) clearButton.hidden = !hasEntries;

  const mode = getShoppingViewMode();
  document.querySelectorAll("[data-shopping-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.shoppingView === mode);
  });
}

async function clearEinkaufsliste() {
  if (!requireAuth()) return;
  if (!confirm("Gesamte Einkaufsliste wirklich leeren?")) return;
  try {
    await apiFetch("/api/einkaufsliste", { method: "DELETE" });
    await loadEinkaufsliste();
    showToast("Einkaufsliste wurde geleert.");
  } catch (error) {
    showToast(extractErrorMessage(error), "error");
  }
}

function renderShoppingSection(title, items, type) {
  if (!items.length) return "";
  return `
    <li class="shopping-section">
      <h3><span>${escapeHTML(title)}</span></h3>
      <ul class="shopping-list shopping-list-clean">
        ${items.map((item, index) => renderShoppingIngredientRow(item, type, index)).join("")}
      </ul>
    </li>
  `;
}

async function loadEinkaufsliste() {
  const listRezepte = document.getElementById("einkauf-rezepte");
  const listZutaten = document.getElementById("einkauf-zutaten");
  const listManuell = document.getElementById("einkauf-manuell");
  if (!listRezepte && !listZutaten && !listManuell) return;
  if (!requireAuth()) return;

  try {
    const data = await apiFetch("/api/einkaufsliste");
    const recipes = data?.rezepte || [];
    const recipeIngredients = data?.zutaten || [];
    const manualIngredients = data?.manuell || [];
    const combinedIngredients = data?.gesamt || [];
    const hasEntries = Boolean(recipes.length || recipeIngredients.length || manualIngredients.length || combinedIngredients.length);

    ensureShoppingListControls(hasEntries);

    if (listRezepte) {
      listRezepte.innerHTML = recipes.map((recipe) => {
        const title = recipe.titel || recipe.title || recipe;
        const removeArg = recipe.id
          ? String(Number(recipe.id))
          : JSON.stringify(String(title)).replaceAll('"', "&quot;");
        return `
          <li class="shopping-recipe-item">
            <span>${escapeHTML(title)}</span>
            ${renderTrashButton(`removeRezeptFromEinkaufsliste(${removeArg})`, "Rezept aus Einkaufsliste entfernen")}
          </li>
        `;
      }).join("") || '<li class="empty-note">Noch keine Rezepte in der Einkaufsliste.</li>';
    }

    if (listZutaten) {
      const mode = getShoppingViewMode();
      if (mode === "combined") {
        listZutaten.innerHTML = combinedIngredients.length
          ? `<li class="shopping-section shopping-section-combined">
              <h3><span>Gesamtliste</span></h3>
              <ul class="shopping-list shopping-list-clean">
                ${combinedIngredients.map((item, index) => renderShoppingIngredientRow(item, "combined", index)).join("")}
              </ul>
            </li>`
          : '<li class="empty-note">Keine Zutaten vorhanden.</li>';
      } else {
        const recipeSection = renderShoppingSection("Aus Rezepten", recipeIngredients, "recipe");
        const manualSection = renderShoppingSection("Manuell", manualIngredients, "manual");
        listZutaten.innerHTML = (recipeSection || manualSection)
          ? `${recipeSection}${manualSection}`
          : '<li class="empty-note">Keine Zutaten vorhanden.</li>';
      }
      bindShoppingCheckboxes(listZutaten);
    }

    if (listManuell) {
      listManuell.innerHTML = "";
      listManuell.hidden = true;
    }
  } catch (error) {
    const message = `<li class="empty-note">${escapeHTML(extractErrorMessage(error))}</li>`;
    if (listRezepte) listRezepte.innerHTML = message;
    if (listZutaten) listZutaten.innerHTML = message;
    if (listManuell) { listManuell.hidden = false; listManuell.innerHTML = message; }
  }
}

async function addToEinkaufsliste(rezeptId) {
  if (!requireAuth()) return;
  try {
    await apiFetch(`/api/einkaufsliste/${rezeptId}`, { method: "POST" });
    await loadEinkaufsliste();
    showToast("Rezept wurde zur Einkaufsliste hinzugefügt.");
  } catch (error) {
    showToast(extractErrorMessage(error), "error");
  }
}

async function addRezeptToEinkaufsliste() {
  const input = document.getElementById("rezept-id");
  const rezeptId = input?.value || currentDetailRecipe?.id || getQueryParam("id");
  if (!rezeptId) return;
  await addToEinkaufsliste(rezeptId);
}

async function removeRezeptFromEinkaufsliste(rezeptIdOrTitle) {
  if (!requireAuth()) return;
  const payload = typeof rezeptIdOrTitle === "number" ? { rezept_id: rezeptIdOrTitle } : { titel: String(rezeptIdOrTitle || "") };
  try {
    await apiFetch("/api/einkaufsliste/entfernen_rezept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    await loadEinkaufsliste();
    showToast("Rezept wurde aus der Einkaufsliste entfernt.");
  } catch (error) {
    showToast(extractErrorMessage(error), "error");
  }
}

async function removeRecipeIngredientFromEinkaufsliste(ids) {
  if (!requireAuth()) return;
  const cleanIds = (Array.isArray(ids) ? ids : [ids]).map(Number).filter((value) => value > 0);
  if (!cleanIds.length) return;

  try {
    await apiFetch("/api/einkaufsliste/entfernen_zutat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: cleanIds })
    });
    await loadEinkaufsliste();
    showToast("Zutat wurde aus der Einkaufsliste entfernt.");
  } catch (error) {
    showToast(extractErrorMessage(error), "error");
  }
}

async function removeManuellFromEinkaufsliste(id) {
  if (!requireAuth()) return;
  try {
    await apiFetch(`/api/einkaufsliste/manuell/${id}`, { method: "DELETE" });
    await loadEinkaufsliste();
    showToast("Manueller Eintrag wurde entfernt.");
  } catch (error) {
    showToast(extractErrorMessage(error), "error");
  }
}

function initManualShoppingForm() {
  const form = document.getElementById("form-einkauf-manuell");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!requireAuth()) return;

    const amountInput = document.getElementById("manuell-menge-input");
    const unitInput = document.getElementById("manuell-einheit-input");
    const nameInput = document.getElementById("manuell-name-input");
    const legacyInput = document.getElementById("manuell-input");

    const menge = (amountInput?.value || "").trim();
    const einheit = (unitInput?.value || "").trim();
    const name = (nameInput?.value || legacyInput?.value || "").trim();
    const text = [menge, einheit, name].filter(Boolean).join(" ").trim();
    if (!name) {
      showToast("Bitte eine Zutat angeben.", "error");
      nameInput?.focus();
      legacyInput?.focus();
      return;
    }

    try {
      await apiFetch("/api/einkaufsliste/manuell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menge, einheit, name, text })
      });
      if (amountInput) amountInput.value = "";
      if (unitInput) unitInput.value = "";
      if (nameInput) nameInput.value = "";
      if (legacyInput) legacyInput.value = "";
      await loadEinkaufsliste();
      showToast("Zutat wurde zur Einkaufsliste hinzugefügt.");
    } catch (error) {
      showToast(extractErrorMessage(error), "error");
    }
  });
}

function clearInputs(row) {
  row.querySelectorAll("input, textarea, select").forEach((field) => {
    if (field.type === "checkbox") field.checked = false;
    else field.value = "";
  });
}

function cloneFirstRow(containerId) {
  const container = document.getElementById(containerId);
  const first = container?.querySelector(".dynamic-row");
  if (!container || !first) return null;
  const clone = first.cloneNode(true);
  clearInputs(clone);
  container.appendChild(clone);
  return clone;
}

function addZutatZeile() { cloneFirstRow("zutaten-container"); }
function addSchrittZeile() { cloneFirstRow("schritte-container"); }
function addKategorieZeile() { cloneFirstRow("kategorie-container"); }

function removeZeile(button) {
  const row = button.closest(".dynamic-row");
  const container = row?.parentElement;
  if (!row || !container) return;
  if (container.querySelectorAll(".dynamic-row").length <= 1) {
    clearInputs(row);
    return;
  }
  row.remove();
}

function updateRecipeImagePreview(url) {
  const preview = document.getElementById("recipe-image-preview");
  if (!preview) return;
  const clean = String(url || "").trim();
  if (!clean) {
    preview.innerHTML = '<span>Kein Bild ausgewählt</span>';
    preview.classList.add("is-empty");
    return;
  }
  preview.classList.remove("is-empty");
  preview.innerHTML = `<img src="${escapeHTML(discoverImageSrc(clean))}" alt="Rezeptbild Vorschau" onerror="this.parentElement.classList.add('is-empty'); this.parentElement.innerHTML='<span>Bild konnte nicht geladen werden</span>'">`;
}

function setRecipeImageUrl(value) {
  const input = document.getElementById("image_url");
  if (input) input.value = value || "";
  updateRecipeImagePreview(value);
}

function initRecipeImageInputs() {
  const fileInput = document.getElementById("image_file");
  const urlInput = document.getElementById("image_url");
  const removeCheckbox = document.getElementById("image_remove");

  if (urlInput) updateRecipeImagePreview(urlInput.value);

  if (fileInput && !fileInput.dataset.bound) {
    fileInput.dataset.bound = "1";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) {
        updateRecipeImagePreview(urlInput?.value || "");
        return;
      }
      if (removeCheckbox) removeCheckbox.checked = false;
      const objectUrl = URL.createObjectURL(file);
      updateRecipeImagePreview(objectUrl);
    });
  }

  if (removeCheckbox && !removeCheckbox.dataset.bound) {
    removeCheckbox.dataset.bound = "1";
    removeCheckbox.addEventListener("change", () => {
      if (removeCheckbox.checked) {
        if (urlInput) urlInput.value = "";
        if (fileInput) fileInput.value = "";
        updateRecipeImagePreview("");
      } else {
        updateRecipeImagePreview(urlInput?.value || "");
      }
    });
  }
}

function collectRecipeFormData(form) {
  const data = new FormData(form);
  const externalNote = document.getElementById("import-public-note");
  const source = form?.dataset?.importSource || "";
  if (source) data.set("source", source);
  if ((externalNote && !externalNote.hidden) || isExternallyImported(source)) data.set("is_public", "0");
  if (form.querySelector('#image_remove')?.checked) data.set("image_remove", "1");
  return data;
}

function fillRecipeFormFromDraft(form, draft) {
  if (!form || !draft) return;
  const recipe = normalizeRecipe(draft);
  form.dataset.importSource = recipe.source || "external";

  const title = document.getElementById("titel");
  const portions = document.getElementById("portionen");
  if (title) title.value = recipe.titel || recipe.title || "";
  if (portions) portions.value = recipe.portionen || 1;
  setRecipeImageUrl(recipe.image_url || recipe.bild_url || recipe.image || recipe.strMealThumb || "");
  initRecipeImageInputs();

  fillRows("kategorie-container", recipe.kategorie, (row, category) => {
    const input = row.querySelector('input[name="kategorie[]"]');
    if (input) input.value = category || "";
  });

  fillRows("zutaten-container", recipe.zutaten, (row, zutat) => {
    const amount = row.querySelector('input[name="zutaten_menge[]"]');
    const unit = row.querySelector('input[name="zutaten_einheit[]"]');
    const name = row.querySelector('input[name="zutaten_name[]"]');
    if (amount) amount.value = zutat?.menge ?? "";
    if (unit) unit.value = zutat?.einheit ?? "";
    if (name) name.value = zutat?.name ?? zutat?.zutat ?? zutat ?? "";
  });

  fillRows("schritte-container", recipe.anleitung, (row, step) => {
    const duration = row.querySelector('input[name="anleitung_dauer[]"]');
    const text = row.querySelector('textarea[name="anleitung_schritt[]"]');
    if (duration) duration.value = step?.dauer ?? "";
    if (text) text.value = step?.schritt ?? step?.text ?? step ?? "";
  });

  const publicCheckbox = document.getElementById("is_public");
  if (publicCheckbox) {
    publicCheckbox.checked = false;
    publicCheckbox.disabled = isExternallyImported(recipe.source) || recipe.source === "text";
  }

  const visibilitySection = document.querySelector(".visibility-section");
  let note = document.getElementById("import-public-note");
  if (!note && visibilitySection) {
    note = document.createElement("p");
    note.id = "import-public-note";
    note.className = "message info";
    visibilitySection.appendChild(note);
  }
  if (note) {
    note.hidden = false;
    note.textContent = "Importiertes Rezept: Bitte prüfe die Daten. Gespeichert wird erst, wenn du unten auf Rezept speichern klickst.";
  }
}

function applyPendingImportDraft(form) {
  const draft = getImportDraft();
  if (!draft) return;
  fillRecipeFormFromDraft(form, draft);
}

function initCreateForm() {
  const form = document.getElementById("form-neu") || document.getElementById("form-neues-rezept");
  if (!form) return;
  if (!requireAuth()) return;
  initRecipeImageInputs();
  applyPendingImportDraft(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    setButtonLoading(submit, "Speichert...");

    try {
      const recipe = await apiFetch("/api/rezepte", {
        method: "POST",
        body: collectRecipeFormData(form)
      });
      clearImportDraft();
      window.location.href = `rezepte_detail.html?id=${recipe.id}`;
    } catch (error) {
      alert(extractErrorMessage(error));
      resetButton(submit);
    }
  });
}

async function loadBearbeitenForm() {
  const form = document.getElementById("form-bearbeiten");
  if (!form) return;
  if (!requireAuth()) return;

  const id = getQueryParam("id");
  if (!id) {
    alert("Keine Rezept-ID angegeben.");
    window.location.href = "rezepte.html";
    return;
  }

  const deleteButton = document.getElementById("btn-rezept-loeschen-edit");
  if (deleteButton) deleteButton.addEventListener("click", () => rezeptLoeschen(id));

  try {
    const recipe = normalizeRecipe(await apiFetch(`/api/rezepte/${id}`));
    currentDetailRecipe = recipe;
    document.getElementById("titel").value = recipe.titel || "";
    document.getElementById("portionen").value = recipe.portionen || 1;
    setRecipeImageUrl(recipe.image_url || recipe.bild_url || recipe.image || recipe.strMealThumb || "");
    initRecipeImageInputs();

    fillRows("kategorie-container", recipe.kategorie, (row, category) => {
      const input = row.querySelector('input[name="kategorie[]"]');
      if (input) input.value = category || "";
    });

    fillRows("zutaten-container", recipe.zutaten, (row, zutat) => {
      row.querySelector('input[name="zutaten_menge[]"]').value = zutat?.menge ?? "";
      row.querySelector('input[name="zutaten_einheit[]"]').value = zutat?.einheit ?? "";
      row.querySelector('input[name="zutaten_name[]"]').value = zutat?.name ?? zutat?.zutat ?? zutat ?? "";
    });

    fillRows("schritte-container", recipe.anleitung, (row, step) => {
      row.querySelector('input[name="anleitung_dauer[]"]').value = step?.dauer ?? "";
      row.querySelector('textarea[name="anleitung_schritt[]"]').value = step?.schritt ?? step?.text ?? step ?? "";
    });

    const publicCheckbox = document.getElementById("is_public");
    const publicNote = document.getElementById("import-public-note");
    const external = isExternallyImported(recipe.source);
    if (publicCheckbox) {
      publicCheckbox.checked = Boolean(recipe.is_public) && !external;
      publicCheckbox.disabled = external;
    }
    if (publicNote) {
      publicNote.hidden = !external;
      publicNote.textContent = "Importierte Rezepte bleiben privat und können nicht öffentlich markiert werden.";
    }
  } catch (error) {
    alert(extractErrorMessage(error));
    window.location.href = "rezepte.html";
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    setButtonLoading(submit, "Speichert...");

    try {
      const recipe = await apiFetch(`/api/rezepte/${id}`, {
        method: "PUT",
        body: collectRecipeFormData(form)
      });
      window.location.href = `rezepte_detail.html?id=${recipe.id}`;
    } catch (error) {
      alert(extractErrorMessage(error));
      resetButton(submit);
    }
  });
}

function fillRows(containerId, values, fillCallback) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const first = container.querySelector(".dynamic-row");
  if (!first) return;
  container.innerHTML = "";
  const sourceValues = Array.isArray(values) && values.length ? values : [null];
  sourceValues.forEach((value) => {
    const row = first.cloneNode(true);
    clearInputs(row);
    fillCallback(row, value);
    container.appendChild(row);
  });
}

function initImportForms() {
  const chefkochForm = document.getElementById("form-import-chefkoch");
  if (chefkochForm) {
    if (!requireAuth()) return;
    chefkochForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = chefkochForm.querySelector('button[type="submit"]');
      const message = document.getElementById("import-message");
      const url = document.getElementById("url")?.value || "";
      setButtonLoading(button, "Importiert...");
      try {
        const recipe = await apiFetch("/api/import_chefkoch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, preview: true })
        });
        const draft = { ...(recipe.draft || recipe), image_url: "", bild_url: "" };
    setImportDraft(draft, "chefkoch");
        showMessage(message, "Rezept wurde geladen. Prüfe es vor dem Speichern.", "success");
        window.location.href = "neues_rezept.html?import=chefkoch";
      } catch (error) {
        showMessage(message, extractErrorMessage(error), "error");
        resetButton(button);
      }
    });
  }

  const textForm = document.getElementById("form-import-text");
  if (textForm) {
    if (!requireAuth()) return;
    textForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = textForm.querySelector('button[type="submit"]');
      const message = document.getElementById("text-import-message");
      const text = document.getElementById("import-text")?.value || "";
      const titel = document.getElementById("text-titel")?.value || "";
      setButtonLoading(button, "Importiert...");
      try {
        const recipe = await apiFetch("/api/import_text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, titel, preview: true })
        });
        setImportDraft(recipe.draft || recipe, "text");
        showMessage(message, "Textrezept wurde gelesen. Prüfe es vor dem Speichern.", "success");
        window.location.href = "neues_rezept.html?import=text";
      } catch (error) {
        showMessage(message, extractErrorMessage(error), "error");
        resetButton(button);
      }
    });
  }
}

async function loadEntdecken() {
  const input = document.getElementById("suchbegriff") || document.getElementById("entdecken-suche-input");
  const form = document.getElementById("form-entdecken") || input?.closest("form");
  const results = document.getElementById("entdecken-results") || document.getElementById("entdecken-container");
  if (!form || !results || !input) return;
  if (!requireAuth()) return;

  const params = new URLSearchParams(window.location.search);
  if (!input.getAttribute("placeholder")) input.setAttribute("placeholder", "z. B. Lasagne, Curry, Kartoffelsalat");
  if (!input.value && params.has("suche")) input.value = params.get("suche") || "";
  if (!input.value.trim()) input.value = "Lasagne";

  const runSearch = async () => {
    const query = input.value.trim();
    if (!query) return;
    results.innerHTML = '<div class="empty-note">Suche läuft...</div>';

    try {
      const data = await apiFetch(`/api/entdecken?query=${encodeURIComponent(query)}`);
      const meals = data?.meals || data?.rezepte || data || [];
      results.innerHTML = meals.map((meal) => {
        const title = meal.strMeal || meal.titel || meal.title || "Unbekanntes Rezept";
        const image = discoverImageSrc(meal.strMealThumb || meal.image || "");
        const tags = normalizeDiscoverTags(meal);
        const description = meal.description || meal.summary || meal.strInstructions || "Beim Importieren wird das Rezept zuerst als bearbeitbarer Entwurf geladen.";
        const importValue = meal.url || meal.idMeal || meal.id || "";
        const importArg = escapeHTML(JSON.stringify(importValue));
        const ratingHTML = renderDiscoverRating(meal);
        return `
          <article class="api-card">
            ${image ? `<img src="${escapeHTML(image)}" alt="${escapeHTML(title)}" loading="lazy" referrerpolicy="no-referrer" onerror="replaceBrokenDiscoveryImage(this)">` : `<div class="api-card-placeholder">KochFlow</div>`}
            <div class="api-content">
              <h3>${escapeHTML(title)}</h3>
              <div class="recipe-badges discover-tags${tags.length ? "" : " discover-tags-empty"}">
                ${tags.length ? tags.slice(0, 3).map((tag, index) => `<span class="badge${index > 0 ? " badge-muted" : ""}">${escapeHTML(tag)}</span>`).join("") : `<span class="badge badge-muted">Keine Tags</span>`}
              </div>
              ${ratingHTML}
              <p class="discover-description">${escapeHTML(String(description))}</p>
              <button type="button" class="card-action" onclick="apiRezeptImportieren(${importArg}, this)">In meine App importieren</button>
            </div>
          </article>
        `;
      }).join("") || '<div class="empty-note">Keine Treffer gefunden.</div>';
    } catch (error) {
      results.innerHTML = `<div class="empty-note">${escapeHTML(extractErrorMessage(error))}</div>`;
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    runSearch();
  });

  if (input.value.trim()) runSearch();
}

async function apiRezeptImportieren(recipeUrl, button) {
  if (!requireAuth()) return;
  if (!recipeUrl) return;
  setButtonLoading(button, "Lade Entwurf...");
  try {
    const recipe = await apiFetch("/api/import_entdecken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: recipeUrl, preview: true })
    });
    const draft = { ...(recipe.draft || recipe), image_url: "", bild_url: "" };
    setImportDraft(draft, "chefkoch");
    window.location.href = "neues_rezept.html?import=chefkoch";
  } catch (error) {
    alert(extractErrorMessage(error));
    resetButton(button);
  }
}

const WEEK_DAYS = [
  ["montag", "Montag", "Mo"],
  ["dienstag", "Dienstag", "Di"],
  ["mittwoch", "Mittwoch", "Mi"],
  ["donnerstag", "Donnerstag", "Do"],
  ["freitag", "Freitag", "Fr"],
  ["samstag", "Samstag", "Sa"],
  ["sonntag", "Sonntag", "So"]
];

function weeklyEntryFor(entries, day) {
  return entries.find((entry) => entry.tag === day && (entry.slot || "mittag") === "mittag") || null;
}

function recipeByIdMap(recipes) {
  const map = new Map();
  recipes.forEach((recipe) => {
    const id = Number(recipe?.id || 0);
    if (id) map.set(id, recipe);
  });
  return map;
}

function uniqueRecipesById(recipes) {
  const map = new Map();
  recipes.forEach((recipe) => {
    const id = Number(recipe?.id || 0);
    if (id && !map.has(id)) map.set(id, recipe);
  });
  return Array.from(map.values());
}

function renderOptionGroup(label, recipes, selectedId) {
  const selected = String(selectedId || "");
  if (!recipes.length) return "";
  return `<optgroup label="${escapeHTML(label)}">` + recipes.map((recipe) => {
    const id = String(recipe.id || "");
    return `<option value="${escapeHTML(id)}" ${id === selected ? "selected" : ""}>${escapeHTML(getRecipeTitle(recipe))}</option>`;
  }).join("") + "</optgroup>";
}

function renderRecipeOptions(ownRecipes, selectedId, favoriteRecipes = []) {
  const ownIds = new Set(ownRecipes.map((recipe) => Number(recipe?.id || 0)).filter(Boolean));
  const visibleFavorites = favoriteRecipes.filter((recipe) => !ownIds.has(Number(recipe?.id || 0)));
  return '<option value="">Kein Rezept</option>'
    + renderOptionGroup("Eigene Rezepte", ownRecipes, selectedId)
    + renderOptionGroup("Gemerkte öffentliche Rezepte", visibleFavorites, selectedId);
}

function weekCardImageMarkup(recipe) {
  const src = recipe ? recipeImageSrc(recipe) : "";
  if (src) {
    return `<div class="week-card-image"><img src="${escapeHTML(src)}" alt="${escapeHTML(getRecipeTitle(recipe))}" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.week-card-image')?.classList.add('is-placeholder'); this.remove();"></div>`;
  }
  return '<div class="week-card-image is-placeholder"><span>KochFlow</span></div>';
}

function weekCardStatusMarkup(entry, recipe) {
  if (!entry?.rezept_id || !recipe) return '<span class="week-save-state is-empty">Nicht geplant</span>';
  return '<span class="week-save-state is-saved">Gespeichert</span>';
}

async function loadWochenplan() {
  const container = document.getElementById("wochenplan-grid");
  if (!container) return;
  if (!requireAuth()) return;

  try {
    const [planData, recipeData, favoriteData] = await Promise.all([
      apiFetch("/api/wochenplan"),
      apiFetch("/api/rezepte?scope=mine"),
      apiFetch("/api/favoriten").catch(() => ({ rezepte: [] }))
    ]);
    const entries = planData?.eintraege || [];
    const ownRecipes = recipeArray(recipeData);
    const favoriteRecipes = recipeArray(favoriteData);
    const recipes = uniqueRecipesById([...ownRecipes, ...favoriteRecipes]);
    const recipesById = recipeByIdMap(recipes);
    const plannedCount = entries.filter((entry) => entry.rezept_id).length;

    const summary = document.getElementById("week-plan-summary");
    if (summary) {
      summary.textContent = plannedCount
        ? `${plannedCount} von 7 Tagen geplant.`
        : "Noch kein Tag geplant.";
    }

    container.innerHTML = WEEK_DAYS.map(([day, label, shortLabel]) => {
      const entry = weeklyEntryFor(entries, day);
      const recipeId = Number(entry?.rezept_id || 0);
      const entryRecipe = recipeId && entry?.titel ? normalizeRecipe({
        id: recipeId,
        titel: entry.titel,
        dauer: entry.dauer,
        kategorie: entry.kategorie,
        owner_name: entry.owner_name,
        is_public: entry.is_public,
        source: entry.source,
        image_url: entry.image_url
      }) : null;
      const recipe = recipeId ? (recipesById.get(recipeId) || entryRecipe) : null;
      const recipeTitle = recipe ? getRecipeTitle(recipe) : "Noch nicht geplant";
      const cookHref = recipeId ? `rezepte_detail.html?id=${encodeURIComponent(recipeId)}&cook=1` : "#";
      const detailHref = recipeId ? `rezepte_detail.html?id=${encodeURIComponent(recipeId)}` : "#";
      return `
        <article class="week-card ${recipe ? "is-planned" : "is-empty"}" data-day="${escapeHTML(day)}" data-entry-id="${escapeHTML(entry?.id || "")}">
          <div class="week-card-topline">
            <span class="week-day-short">${escapeHTML(shortLabel)}</span>
            <div>
              <h3>${escapeHTML(label)}</h3>
              ${weekCardStatusMarkup(entry, recipe)}
            </div>
          </div>
          ${weekCardImageMarkup(recipe)}
          <div class="week-card-body">
            <p class="week-current">${escapeHTML(recipeTitle)}</p>
            <label class="week-select-label">
              <span>Rezept wählen</span>
              <select class="week-recipe-select" onchange="autoSaveWeekCard(this)">
                ${renderRecipeOptions(ownRecipes, entry?.rezept_id, favoriteRecipes)}
              </select>
            </label>
          </div>
          <div class="week-actions">
            <a class="primary-action week-cook-link ${recipeId ? "" : "is-disabled"}" href="${escapeHTML(cookHref)}" aria-disabled="${recipeId ? "false" : "true"}" ${recipeId ? "" : "tabindex=\"-1\""}>Kochen</a>
            <a class="small-action week-detail-link ${recipeId ? "" : "is-disabled"}" href="${escapeHTML(detailHref)}" aria-disabled="${recipeId ? "false" : "true"}" ${recipeId ? "" : "tabindex=\"-1\""}>Details</a>
            <button type="button" class="icon-action icon-action-danger icon-trash week-delete" onclick="deleteWeekCard(this)" ${entry?.id ? "" : "disabled"} title="Tag leeren" aria-label="${escapeHTML(label)} leeren">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM7 9h10l-1 11H8L7 9Z"></path>
              </svg>
            </button>
          </div>
        </article>
      `;
    }).join("");

    const addButton = document.getElementById("btn-wochenplan-einkauf");
    if (addButton) addButton.disabled = !entries.some((entry) => entry.rezept_id);
  } catch (error) {
    container.innerHTML = `<div class="empty-note">${escapeHTML(extractErrorMessage(error))}</div>`;
  }
}

async function autoSaveWeekCard(select) {
  if (!requireAuth()) return;
  const card = select.closest(".week-card");
  if (!card) return;
  const tag = card.dataset.day;
  const rezept_id = select.value || "";
  const previousValue = select.dataset.previousValue || "";
  select.disabled = true;
  card.classList.add("is-saving");
  try {
    await apiFetch("/api/wochenplan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag, slot: "mittag", rezept_id, notiz: "" })
    });
    select.dataset.previousValue = rezept_id;
    await loadWochenplan();
    showToast(rezept_id ? "Tag wurde gespeichert." : "Tag wurde geleert.");
  } catch (error) {
    select.value = previousValue;
    select.disabled = false;
    card.classList.remove("is-saving");
    showToast(extractErrorMessage(error), "error");
  }
}

async function saveWeekCard(button) {
  const card = button?.closest?.(".week-card");
  const select = card?.querySelector?.(".week-recipe-select");
  if (select) await autoSaveWeekCard(select);
}

async function deleteWeekCard(button) {
  if (!requireAuth()) return;
  const card = button.closest(".week-card");
  const entryId = card?.dataset.entryId;
  if (!entryId) return;
  try {
    button.disabled = true;
    await apiFetch(`/api/wochenplan/${entryId}`, { method: "DELETE" });
    await loadWochenplan();
    showToast("Tag wurde geleert.");
  } catch (error) {
    showToast(extractErrorMessage(error), "error");
    button.disabled = false;
  }
}

async function clearWochenplan() {
  if (!requireAuth()) return;
  if (!confirm("Wochenplan wirklich leeren?")) return;
  try {
    await apiFetch("/api/wochenplan", { method: "DELETE" });
    await loadWochenplan();
    showToast("Wochenplan wurde geleert.");
  } catch (error) {
    showToast(extractErrorMessage(error), "error");
  }
}

async function addWochenplanToShoppingList() {
  if (!requireAuth()) return;
  const button = document.getElementById("btn-wochenplan-einkauf");
  setButtonLoading(button, "Übernehme...");
  try {
    const result = await apiFetch("/api/wochenplan/einkaufsliste", { method: "POST" });
    showToast(`${result?.count || 0} geplante Rezepte wurden zur Einkaufsliste hinzugefügt.`);
    resetButton(button);
  } catch (error) {
    showToast(extractErrorMessage(error), "error");
    resetButton(button);
  }
}

function initWochenplanActions() {
  const clearButton = document.getElementById("btn-wochenplan-leeren");
  if (clearButton) clearButton.addEventListener("click", clearWochenplan);
  const shoppingButton = document.getElementById("btn-wochenplan-einkauf");
  if (shoppingButton) shoppingButton.addEventListener("click", addWochenplanToShoppingList);
}

function maybeStartDetailCookMode() {
  const shouldStart = ["1", "true", "yes", "ja"].includes(String(getQueryParam("cook") || "").toLowerCase());
  if (!shouldStart || !currentDetailRecipe) return;
  window.setTimeout(() => startKochmodus(), 80);
}

function initAuthForms() {
  const loginForm = document.getElementById("form-login");
  const registerForm = document.getElementById("form-register");
  const loginTab = document.getElementById("tab-login");
  const registerTab = document.getElementById("tab-register");
  const message = document.getElementById("auth-message");

  if (loginTab && registerTab && loginForm && registerForm) {
    loginTab.addEventListener("click", () => {
      loginForm.hidden = false;
      registerForm.hidden = true;
      loginTab.classList.add("primary-action");
      registerTab.classList.remove("primary-action");
    });
    registerTab.addEventListener("click", () => {
      loginForm.hidden = true;
      registerForm.hidden = false;
      registerTab.classList.add("primary-action");
      loginTab.classList.remove("primary-action");
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      const username = document.getElementById("login-username")?.value.trim() || "";
      const password = document.getElementById("login-password")?.value || "";
      setButtonLoading(button, "Melde an...");
      try {
        const data = await apiFetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password })
        });
        setAuth(data.user || { username: data.username, is_root: data.is_root }, data.token);
        window.location.href = safeRedirectTarget(getQueryParam("next"));
      } catch (error) {
        showMessage(message, extractErrorMessage(error), "error");
        resetButton(button);
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      const username = document.getElementById("register-username")?.value.trim() || "";
      const password = document.getElementById("register-password")?.value || "";
      const repeat = document.getElementById("register-password-repeat")?.value || "";
      if (password !== repeat) {
        showMessage(message, "Die Passwörter stimmen nicht überein.", "error");
        return;
      }
      setButtonLoading(button, "Erstelle Konto...");
      try {
        const data = await apiFetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password })
        });
        setAuth(data.user || { username: data.username, is_root: data.is_root }, data.token);
        window.location.href = safeRedirectTarget(getQueryParam("next"));
      } catch (error) {
        showMessage(message, extractErrorMessage(error), "error");
        resetButton(button);
      }
    });
  }
}

function beendeKochmodus() { closeKochmodus(); }
function naechsterSchritt() { nextStep(); }
function vorherigerSchritt() { prevStep(); }

window.addEventListener("resize", () => {
  if (!document.getElementById("kochmodus-overlay")?.hidden) adaptKochStepTypography();
});

window.addEventListener("DOMContentLoaded", () => {
  replaceBrandMarks();
  renderCurrentUserBadge();
  bindRecipeFilters();
  initAuthForms();
  initCreateForm();
  initImportForms();
  initManualShoppingForm();
  loadHomeDashboard();
  loadRezepte();
  loadPublicRezepte();
  loadRezeptDetail();
  loadBearbeitenForm();
  loadEinkaufsliste();
  loadEntdecken();
  initWochenplanActions();
  loadWochenplan();
});
