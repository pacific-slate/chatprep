/* ChatPrep — app.js
 *
 * Vanilla ES module. No build step. No framework. No bundler.
 *
 * Responsibilities:
 *   - Load JSON data (copy, services, templates, industries, countries)
 *   - Hydrate DOM from copy.json (data-copy + data-copy-attr)
 *   - Render dynamic step controls (tiles, checkboxes, chips, country dropdown)
 *   - Run the wizard state machine (intro → step1..4 → output)
 *   - Persist answers in localStorage
 *   - Derive canonical template + adapt per service
 *   - Wire copy-to-clipboard
 *   - Light i18n scaffold: ?lang=xx or navigator.language → data/copy.<lang>.json
 *     with fallback to English. Country dropdown also pre-fills from locale.
 *
 * Posture: be tolerant of missing/odd data. If something's wrong,
 * show plain-English fallback rather than crashing the wizard.
 *
 * Security: never assign HTML strings to innerHTML — always build
 * with createElement + textContent so content from data files (or
 * user input) cannot execute as markup.
 */

"use strict";

const STORAGE_KEY = "chatprep.draft.v2";
const PREVIEW_OPEN_KEY = "chatprep.preview_open";
const STORAGE_TTL_DAYS = 30;
// step1 is now embedded in the intro screen (the topic-tile homepage).
// We keep step IDs intro / step2 / step3 / step4 to avoid breaking deep links.
const SCREENS = ["intro", "step2", "step3", "step4", "output"];
const ORDER   = ["intro", "step2", "step3", "step4", "output"];

// Screens where the live preview pane should be visible (anywhere in the
// wizard except the homepage-with-no-pick-yet and the final output screen,
// which has its own copy buttons).
const PREVIEW_SCREENS = new Set(["intro", "step2", "step3", "step4"]);

let copy, services, templates, industries, countries;
let state = freshState();

/* ===================== bootstrap ===================== */

document.addEventListener("DOMContentLoaded", () => {
  bootstrap().catch(err => {
    console.error("ChatPrep failed to start:", err);
    showFatalError();
  });
});

async function bootstrap() {
  const lang = pickLanguage();
  // Try the locale-specific copy first; fall back to English (data/copy.json) on miss.
  const copyPath = lang && lang !== "en" ? `data/copy.${lang}.json` : "data/copy.json";

  // Always load copy.json — every page hydrates from it.
  copy = await fetchJSONWithFallback(copyPath, "data/copy.json");
  hydrateCopy(document.body);

  // Per-app bootstrap. Each top-level page sets <body data-app="...">.
  const app = document.body.dataset.app || "personalize";
  if      (app === "router")      await bootstrapRouter();
  else if (app === "supercharge") await bootstrapSupercharge();
  else                            await bootstrapPersonalize();
}

/* ===================== bootstrap: router (homepage) ===================== */
async function bootstrapRouter() {
  // Router is mostly static — just copy hydration, which already ran.
  // Nothing to wire.
}

/* ===================== bootstrap: personalize (existing wizard) ===================== */
async function bootstrapPersonalize() {
  [services, templates, industries, countries] = await Promise.all([
    fetchJSON("data/services.json"),
    fetchJSON("data/templates.json"),
    fetchJSON("data/industries.json"),
    fetchJSON("data/countries.json"),
  ]);

  renderStep1Tiles();
  renderStep2Tiles();
  renderStep3Country();
  renderStep3DetailTiles();
  renderAllChips();
  renderStep4Checkboxes();
  wireActions();
  wireFieldInputs();
  wireTabs();
  wirePreviewTabs();
  wirePreviewToggle();
  wireHistory();

  const draft = loadDraft();
  if (draft) {
    state = { ...freshState(), ...draft };
    const banner = document.getElementById("resume-banner");
    if (banner && state.goal) banner.hidden = false;
  } else {
    const detected = detectCountryCode();
    if (detected) state.country = detected;
  }

  const initialScreen = screenFromHash() || "intro";
  goto(initialScreen, { replace: true });
}

/* ===================== bootstrap: supercharge (CLI walk-through) ===================== */
async function bootstrapSupercharge() {
  const cliTools = await fetchJSON("data/cli-tools.json");
  initSupercharge(cliTools);
}

/* ===================== i18n + locale helpers ===================== */

function pickLanguage() {
  // 1. ?lang= query string wins
  const q = new URLSearchParams(location.search).get("lang");
  if (q) return q.toLowerCase().slice(0, 5);
  // 2. browser language
  const navLang = (navigator.language || "en").toLowerCase();
  return navLang.slice(0, 2); // "en", "es", "fr", etc.
}

function detectCountryCode() {
  // navigator.language formats: "en-US", "es-MX", "fr-FR" — extract the country code.
  // For users with bare languages like "en" or "fr", returns null.
  const lang = navigator.language || "";
  const m = lang.match(/-([A-Z]{2})$/i);
  return m ? m[1].toUpperCase() : null;
}

async function fetchJSONWithFallback(primary, fallback) {
  try {
    const r = await fetch(primary);
    if (r.ok) return await r.json();
  } catch {}
  return fetchJSON(fallback);
}

/* ===================== state ===================== */

function freshState() {
  return {
    goal: null,
    comfort: null,
    industry: "",
    role: "",
    country: "",     // ISO 3166 alpha-2 code (e.g. "US"), or "" if unset
    hobbies: "",
    detail: "standard",
    avoid: [],
    avoid_other: "",
    _saved_at: null,
  };
}

function saveDraft() {
  try {
    state._saved_at = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked (private mode, full quota). Wizard still works.
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ageMs = Date.now() - (parsed._saved_at || 0);
    if (ageMs > STORAGE_TTL_DAYS * 24 * 60 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearDraft() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

/* ===================== copy hydration ===================== */

function getCopy(path) {
  return path.split(".").reduce((o, k) => (o == null ? null : o[k]), copy);
}

function fmt(template, vars) {
  if (!template) return "";
  return Object.entries(vars || {}).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), v),
    template
  );
}

function hydrateCopy(root) {
  root.querySelectorAll("[data-copy]").forEach(el => {
    const path = el.getAttribute("data-copy");
    let value = getCopy(path);
    if (value == null) return;
    if (path === "nav.step_label") {
      value = fmt(value, {
        n: el.getAttribute("data-step-n"),
        total: el.getAttribute("data-step-total"),
      });
    }
    el.textContent = value;
  });
  root.querySelectorAll("[data-copy-attr]").forEach(el => {
    const spec = el.getAttribute("data-copy-attr");
    const [attr, path] = spec.split(":");
    const value = getCopy(path);
    if (value != null) el.setAttribute(attr, value);
  });
}

/* ===================== dynamic renders ===================== */

function renderStep1Tiles() {
  // Now lives on the homepage (intro screen). Tile click both records the
  // answer AND advances to step2 — see ACTIONS handling for the goal field
  // when the fieldset has data-advance-on-pick="true".
  const fs = document.querySelector('[data-field="goal"]');
  fs.appendChild(buildTiles(copy.step1.options, "goal", "radio"));
}

function renderStep2Tiles() {
  const fs = document.querySelector('[data-field="comfort"]');
  fs.appendChild(buildTiles(copy.step2.options, "comfort", "radio"));
}

function renderStep3Country() {
  const sel = document.getElementById("field-country");
  countries.countries.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.code;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
}

function renderStep3DetailTiles() {
  const fs = document.querySelector('[data-field="detail"]');
  fs.appendChild(buildTiles(copy.step3.detail_options, "detail", "radio"));
}

function renderStep4Checkboxes() {
  const fs = document.querySelector('[data-field="avoid"]');
  fs.appendChild(buildCheckboxRows(copy.step4.options, "avoid"));
}

function renderAllChips() {
  document.querySelectorAll("[data-chips-for]").forEach(container => {
    const field = container.getAttribute("data-chips-for");
    const sourcePath = container.getAttribute("data-chips-source");
    const mode = container.getAttribute("data-chips-mode") || "replace";
    const list = getCopy(sourcePath) || [];
    list.forEach(label => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = label;
      chip.dataset.value = label;
      chip.addEventListener("click", () => onChipClick(field, label, mode, chip));
      container.appendChild(chip);
    });
  });
}

function onChipClick(field, value, mode, chipEl) {
  const input = document.querySelector(`[data-field="${field}"]`);
  if (!input) return;

  if (mode === "append") {
    // For hobbies-style multi-add: toggle the chip's value in the comma-separated input
    const current = input.value.split(",").map(s => s.trim()).filter(Boolean);
    const idx = current.findIndex(v => v.toLowerCase() === value.toLowerCase());
    if (idx >= 0) {
      current.splice(idx, 1);
      chipEl.classList.remove("chip--selected");
    } else {
      current.push(value);
      chipEl.classList.add("chip--selected");
    }
    input.value = current.join(", ");
  } else {
    // Replace mode (industry, role): set the value, mark this chip selected, unmark siblings
    input.value = value;
    chipEl.parentElement.querySelectorAll(".chip").forEach(c => c.classList.remove("chip--selected"));
    chipEl.classList.add("chip--selected");
  }

  state[field] = input.value;
  saveDraft();
}

function buildTiles(options, name, type) {
  const frag = document.createDocumentFragment();
  options.forEach(opt => {
    const label = document.createElement("label");
    label.className = "tile";

    const input = document.createElement("input");
    input.type = type;
    input.name = name;
    input.value = opt.id;
    label.appendChild(input);

    const labelEl = document.createElement("span");
    labelEl.className = "tile__label";
    labelEl.textContent = opt.label;
    label.appendChild(labelEl);

    if (opt.hint) {
      const hintEl = document.createElement("span");
      hintEl.className = "tile__hint";
      hintEl.textContent = opt.hint;
      label.appendChild(hintEl);
    }

    frag.appendChild(label);
  });
  return frag;
}

function buildCheckboxRows(options, name) {
  const frag = document.createDocumentFragment();
  options.forEach(opt => {
    const row = document.createElement("label");
    row.className = "checkbox-row";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.value = opt.id;
    row.appendChild(input);

    const text = document.createElement("span");
    text.className = "checkbox-row__text";

    const labelEl = document.createElement("span");
    labelEl.className = "checkbox-row__label";
    labelEl.textContent = opt.label;
    text.appendChild(labelEl);

    if (opt.hint) {
      const hintEl = document.createElement("span");
      hintEl.className = "checkbox-row__hint";
      hintEl.textContent = opt.hint;
      text.appendChild(hintEl);
    }

    row.appendChild(text);
    frag.appendChild(row);
  });
  return frag;
}

/* ===================== input wiring ===================== */

function wireActions() {
  document.body.addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    const handler = ACTIONS[action];
    if (handler) handler(btn, e);
  });
}

const ACTIONS = {
  resume:   () => {
    document.getElementById("resume-banner")?.setAttribute("hidden", "");
    goto(currentStepFromState() || "step2");
  },
  "resume-dismiss": () => { document.getElementById("resume-banner")?.setAttribute("hidden", ""); },
  back:     () => goBack(),
  continue: () => goNext(),
  finish:   () => goNext(true),
  restart:  () => {
    state = freshState();
    clearDraft();
    const d = detectCountryCode();
    if (d) state.country = d;
    goto("intro");
    window.scrollTo(0, 0);
  },
};

function wireFieldInputs() {
  document.body.addEventListener("change", e => {
    const t = e.target;
    let advanceFromGoal = false;
    if (t.matches('input[name="goal"]')) {
      state.goal = t.value;
      // When the goal radio lives in a tile-group with data-advance-on-pick,
      // selecting it auto-advances. The intro screen sets this attribute
      // so picking a topic on the homepage = pick + advance in one click.
      const fs = t.closest('[data-advance-on-pick]');
      if (fs && currentScreen() === "intro") advanceFromGoal = true;
    }
    if (t.matches('input[name="comfort"]'))  state.comfort = t.value;
    if (t.matches('input[name="detail"]'))   state.detail = t.value;
    if (t.matches('input[name="avoid"]'))    state.avoid = collectChecked("avoid");
    if (t.matches('select[data-field="country"]')) state.country = t.value;
    saveDraft();
    renderPreview();
    if (advanceFromGoal) {
      // Brief delay so the user sees their tile select before the screen swaps
      setTimeout(() => goto("step2"), 180);
    }
  });
  document.body.addEventListener("input", e => {
    const t = e.target;
    if (!t.dataset.field) return;
    const f = t.dataset.field;
    if (["industry","role","hobbies","avoid_other"].includes(f)) {
      state[f] = t.value;
      saveDraft();
      renderPreview();
    }
  });
}

function collectChecked(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
}

/* ===================== navigation / validation ===================== */

/* History-aware navigation.
 *
 * Each screen change pushes a hash entry (`#step2`, `#output`, etc.) so the
 * browser back/forward buttons work as expected — back from #step3 goes to
 * #step2, back from the homepage exits the site (correct), forward re-enters.
 * Refresh keeps the user on the same step.
 *
 * popstate handler reads the new hash and re-routes via goto(..., {fromPopstate: true})
 * to avoid pushing a duplicate history entry.
 */
function goto(screen, opts = {}) {
  const { fromPopstate = false, replace = false } = opts;

  SCREENS.forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.hidden = (s !== screen);
  });

  reflectStateIntoControls();
  updatePreviewVisibility(screen);
  renderPreview();

  const heading = document.querySelector(`#screen-${screen} .screen__heading`);
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (screen === "output") renderOutputs();

  // Sync URL hash unless this navigation came from popstate (else infinite loop)
  if (!fromPopstate) {
    const url = "#" + screen;
    if (replace) history.replaceState({ screen }, "", url);
    else         history.pushState({ screen }, "", url);
  }
}

function wireHistory() {
  window.addEventListener("popstate", e => {
    const screen = e.state?.screen || screenFromHash() || "intro";
    if (SCREENS.includes(screen)) goto(screen, { fromPopstate: true });
  });
}

function screenFromHash() {
  const hash = (location.hash || "").replace(/^#/, "");
  if (!hash) return null;
  if (!SCREENS.includes(hash)) return null;
  // Don't deep-link to output if state is empty — redirect to intro
  if (hash === "output" && !state.goal) return "intro";
  return hash;
}

function currentScreen() {
  return SCREENS.find(s => !document.getElementById(`screen-${s}`).hidden) || "intro";
}

function currentStepFromState() {
  if (!state.goal) return "intro";
  if (!state.comfort) return "step2";
  if (!state.country && !state.industry && !state.role) return "step3";
  return "step4";
}

function goNext(isFinish = false) {
  const here = currentScreen();
  if (!validateStep(here)) return;
  const idx = ORDER.indexOf(here);
  const nextIdx = isFinish ? ORDER.indexOf("output") : Math.min(ORDER.length - 1, idx + 1);
  goto(ORDER[nextIdx]);
}

function goBack() {
  const here = currentScreen();
  const idx = ORDER.indexOf(here);
  const prev = ORDER[Math.max(0, idx - 1)];
  goto(prev);
}

function validateStep(screen) {
  clearError(screen);
  if (screen === "step1" && !state.goal)    return showError("step1", "goal", copy.step1.error_required);
  if (screen === "step2" && !state.comfort) return showError("step2", "comfort", copy.step2.error_required);
  // step3 fields are all optional — gentle posture
  // step4 fully optional
  return true;
}

function showError(screen, field, msg) {
  const node = document.querySelector(`#screen-${screen} [data-error-for="${field}"]`);
  if (node) {
    node.textContent = msg;
    node.hidden = false;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  return false;
}
function clearError(screen) {
  document.querySelectorAll(`#screen-${screen} .error-message`).forEach(n => { n.hidden = true; });
}

function reflectStateIntoControls() {
  setRadio("goal", state.goal);
  setRadio("comfort", state.comfort);
  setRadio("detail", state.detail);
  setChecks("avoid", state.avoid);
  setText("industry", state.industry);
  setText("role", state.role);
  setText("hobbies", state.hobbies);
  setText("avoid_other", state.avoid_other);
  setSelect("country", state.country);
  // Reflect chip selection state when re-entering a screen
  syncChipSelection("hobbies", "append");
  syncChipSelection("industry", "replace");
  syncChipSelection("role", "replace");
}

function setRadio(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(r => r.checked = (r.value === value));
}
function setChecks(name, values) {
  const set = new Set(values || []);
  document.querySelectorAll(`input[name="${name}"]`).forEach(c => c.checked = set.has(c.value));
}
function setText(field, value) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (el && el.tagName !== "FIELDSET" && el.tagName !== "SELECT") el.value = value || "";
}
function setSelect(field, value) {
  const el = document.querySelector(`select[data-field="${field}"]`);
  if (el) el.value = value || "";
}

function syncChipSelection(field, mode) {
  const container = document.querySelector(`[data-chips-for="${field}"]`);
  if (!container) return;
  const input = document.querySelector(`[data-field="${field}"]`);
  const value = input?.value || "";
  if (mode === "append") {
    const tokens = value.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    container.querySelectorAll(".chip").forEach(c => {
      c.classList.toggle("chip--selected", tokens.includes(c.dataset.value.toLowerCase()));
    });
  } else {
    container.querySelectorAll(".chip").forEach(c => {
      c.classList.toggle("chip--selected", c.dataset.value.toLowerCase() === value.toLowerCase());
    });
  }
}

/* ===================== template derivation ===================== */

function deriveCanonical() {
  const t = templates;
  const role     = state.role.trim()     || "person";
  const industry = state.industry.trim() || "general work";

  // Map ISO country code → English name for the template
  const countryName = countryNameFromCode(state.country) || "an unspecified country";

  const goalsLine     = t.goals_by_q1[state.goal] || "Help me think more clearly.";
  const roleObjective = (t.role_objective_by_q1 || {})[state.goal] || "their goals";
  const toneCfg       = t.tone_by_comfort[state.comfort] || t.tone_by_comfort.casual;
  const formatLine    = t.format_by_q1[state.goal] || "Mix prose with bullets where helpful.";
  const lengthLine    = t.length_by_detail[state.detail] || t.length_by_detail.standard;

  const aboutMe = fmt(t.skeleton.about_me, { role, industry, country: countryName });

  const alwaysList = [];
  if (state.avoid.includes("cite_sources"))  alwaysList.push(t.always_rules.cite_sources);
  if (state.avoid.includes("plain_english")) alwaysList.push(t.always_rules.plain_english);
  if (state.avoid.includes("show_work"))     alwaysList.push(t.always_rules.show_work);

  const avoidList = [];
  if (state.avoid.includes("no_emoji"))    avoidList.push(t.avoid_rules.no_emoji);
  if (state.avoid.includes("no_jokes"))    avoidList.push(t.avoid_rules.no_jokes);
  if (state.avoid.includes("no_pretend"))  avoidList.push(t.avoid_rules.no_pretend);
  if (state.avoid.includes("neutral_pol")) avoidList.push(t.avoid_rules.neutral_pol);
  avoidList.push(t.avoid_rules.no_pii);
  if (state.avoid_other.trim()) avoidList.push(state.avoid_other.trim());

  return {
    aboutMe,
    hobbies:       state.hobbies.trim(),
    goalsLead:     t.skeleton.goals_lead,
    goalsLine,
    roleObjective,
    toneLead:      t.skeleton.tone_lead,
    tone:          toneCfg.tone,
    readingLevel:  toneCfg.reading_level,
    format:        formatLine,
    length:        lengthLine,
    alwaysLead:    t.skeleton.always_lead,
    always:        alwaysList,
    avoidLead:     t.skeleton.avoid_lead,
    avoid:         avoidList,
    fallback:      t.skeleton.fallback,
  };
}

function countryNameFromCode(code) {
  if (!code) return null;
  const found = countries.countries.find(c => c.code === code);
  return found ? found.name : null;
}

/* Per-service adapters
 * Each adapter follows the vendor's officially documented prompt structure.
 * Sources cited in docs/VENDOR_SOURCES.md — re-verify quarterly.
 */

function adaptForChatGPT(c) {
  // Source: OpenAI GPT-4.1 Prompting Guide (openai-cookbook/examples/gpt4-1_prompting_guide.ipynb)
  // Recommended structure: markdown headers — # Role and Objective, # Instructions, # Output Format
  //
  // UI verified live 2026-04-27: ChatGPT has CONSOLIDATED its Custom Instructions
  // panel. The two-box pattern ("What would you like ChatGPT to know about you?"
  // + "How would you like ChatGPT to respond?") is GONE. The Personalization
  // settings page now has:
  //   - Base style dropdown (Default / Efficient / etc.)
  //   - Characteristics sliders (Warm, Enthusiastic, Headers & Lists, Emoji)
  //   - Fast answers toggle
  //   - SINGLE "Custom instructions" text field (1500 char limit per help article)
  //   - Memory + Record mode toggles
  //
  // We now generate one block for the Custom instructions field.
  // Slider recommendations are surfaced separately in the panel (see buildChatGPTPanel).

  const text = [
    "# About me",
    c.aboutMe,
    c.hobbies ? `My hobbies and interests: ${c.hobbies}.` : null,
    "",
    "# What I want help with",
    c.goalsLine,
    "",
    "# How to respond",
    `- Tone: ${c.tone}.`,
    `- Reading level: ${c.readingLevel}`,
    `- Format: ${c.format}`,
    `- Length: ${c.length}`,
    "",
    "# Always",
    ...(c.always.length ? c.always.map(x => `- ${x}`) : ["- Use your best judgment."]),
    "",
    "# Avoid",
    ...c.avoid.map(x => `- ${x}`),
    "",
    "# When unsure",
    c.fallback,
  ].filter(Boolean).join("\n");

  return { text, sliders: deriveChatGPTSliders(c) };
}

// Map chatprep answers → ChatGPT's Characteristics slider recommendations.
// These are the four sliders OpenAI added to the Personalization panel
// in April 2026: Warm, Enthusiastic, Headers & Lists, Emoji.
// Each is "Less ↔ Default ↔ More". Only emit a recommendation if we
// have signal from the user's answers; otherwise leave the slider alone.
function deriveChatGPTSliders(c) {
  const out = [];

  // Warm: based on tone. Warm if the user picked "warm and patient" (=new comfort).
  if (/warm/i.test(c.tone))     out.push({ name: "Warm",            setting: "More" });
  else if (/direct/i.test(c.tone)) out.push({ name: "Warm",         setting: "Less" });

  // Enthusiastic: dial down if user said "no jokes or filler"
  if (c.avoid.some(a => /joke|filler/i.test(a))) {
    out.push({ name: "Enthusiastic", setting: "Less" });
  }

  // Headers & Lists: turn up if format calls for bullets / structured output
  if (/bullet|structure|short paragraphs/i.test(c.format)) {
    out.push({ name: "Headers & Lists", setting: "More" });
  } else if (/prose|riff|match the tone/i.test(c.format)) {
    out.push({ name: "Headers & Lists", setting: "Less" });
  }

  // Emoji: explicit no-emoji opt-in
  if (c.avoid.some(a => /emoji/i.test(a))) {
    out.push({ name: "Emoji", setting: "Less" });
  }

  return out;
}

function adaptForClaude(c) {
  // Source: Anthropic Prompting Best Practices (platform.claude.com/docs/...)
  // - "Structure prompts with XML tags" — descriptive names, consistent
  // - "Give Claude a role" — single sentence in system prompt focuses behavior
  // - We add an explicit <role> tag at the top per their guidance.

  const aboutSection = c.aboutMe + (c.hobbies ? `\nMy hobbies: ${c.hobbies}.` : "");
  return [
    "<role>",
    `You are a thoughtful assistant helping with ${c.roleObjective}. Use a ${c.tone} tone.`,
    "</role>",
    "",
    "<about-me>",
    aboutSection,
    "</about-me>",
    "",
    "<how-to-respond>",
    `Tone: ${c.tone}.`,
    `Reading level: ${c.readingLevel}`,
    `Format: ${c.format}`,
    `Length: ${c.length}`,
    "</how-to-respond>",
    "",
    "<always>",
    ...(c.always.length ? c.always.map(x => `- ${x}`) : ["- Use your best judgment."]),
    "</always>",
    "",
    "<avoid>",
    ...c.avoid.map(x => `- ${x}`),
    "</avoid>",
    "",
    "<when-unsure>",
    c.fallback,
    "</when-unsure>",
  ].join("\n");
}

function adaptForGemini(c) {
  // Source: Google Gemini 3 prompt design guide (ai.google.dev/gemini-api/docs/prompting-strategies)
  // Recommended XML tags: <role>, <constraints>, <context>, <task>
  // We follow their schema literally.

  const aboutSection = c.aboutMe + (c.hobbies ? `\nHobbies: ${c.hobbies}.` : "");

  const constraintsList = [
    `Tone: ${c.tone}.`,
    `Reading level: ${c.readingLevel}`,
    `Format: ${c.format}`,
    `Length: ${c.length}`,
    "",
    "Always:",
    ...(c.always.length ? c.always.map(x => `- ${x}`) : ["- Use your best judgment."]),
    "",
    "Avoid:",
    ...c.avoid.map(x => `- ${x}`),
  ].join("\n");

  const full = [
    "<role>",
    `You are a thoughtful assistant helping with ${c.roleObjective}. Use a ${c.tone} tone.`,
    "</role>",
    "",
    "<context>",
    aboutSection,
    "</context>",
    "",
    "<constraints>",
    constraintsList,
    "</constraints>",
    "",
    "<task>",
    `Respond to my messages following the role and constraints above. ${c.fallback}`,
    "</task>",
  ].join("\n");

  const limit = services.gemini.char_limit || 4000;
  if (full.length <= limit) return { text: full, trimmed: false };

  // Trim optional sections to fit the 4000-char hard cap
  let txt = full;
  txt = txt.replace(/Hobbies:.*\n/g, "");
  if (txt.length > limit) txt = txt.replace(c.fallback, "").trimEnd();
  if (txt.length > limit) txt = txt.slice(0, limit - 1) + "…";
  return { text: txt, trimmed: true };
}

/* ===================== output rendering ===================== */

function renderOutputs() {
  const c = deriveCanonical();
  const chatgpt = adaptForChatGPT(c);
  const claude  = adaptForClaude(c);
  const gemini  = adaptForGemini(c);

  fillPanel("chatgpt", buildChatGPTPanel(chatgpt));
  fillPanel("claude",  buildSinglePanel("claude", claude));
  fillPanel("gemini",  buildSinglePanel("gemini", gemini.text, { trimmed: gemini.trimmed }));
}

/* ===================== live preview pane ===================== */

function updatePreviewVisibility(screen) {
  const pane = document.getElementById("preview-pane");
  const layout = document.querySelector(".layout");
  if (!pane || !layout) return;
  const shouldShow = PREVIEW_SCREENS.has(screen);
  pane.hidden = !shouldShow;
  layout.classList.toggle("layout--with-preview", shouldShow);
}

function renderPreview() {
  const pane = document.getElementById("preview-pane");
  if (!pane || pane.hidden) return;

  const placeholder = document.getElementById("preview-placeholder");
  const content     = document.getElementById("preview-content");
  if (!placeholder || !content) return;

  // Before any topic is picked, show the placeholder line
  if (!state.goal) {
    placeholder.hidden = false;
    content.hidden = true;
    return;
  }
  placeholder.hidden = true;
  content.hidden = false;

  const c = deriveCanonical();
  const chatgpt = adaptForChatGPT(c);
  const claude  = adaptForClaude(c);
  const gemini  = adaptForGemini(c);

  fillPreviewPanel("chatgpt", buildChatGPTPanel(chatgpt, { mode: "preview" }));
  fillPreviewPanel("claude",  buildSinglePanel("claude", claude, { mode: "preview" }));
  fillPreviewPanel("gemini",  buildSinglePanel("gemini", gemini.text, { trimmed: gemini.trimmed, mode: "preview" }));
}

function fillPreviewPanel(name, nodes) {
  const panel = document.querySelector(`[data-preview-panel="${name}"]`);
  if (panel) panel.replaceChildren(...nodes);
}

function wirePreviewTabs() {
  document.querySelectorAll('[data-preview-tab]').forEach(tab => {
    tab.addEventListener("click", () => activatePreviewTab(tab.dataset.previewTab));
  });
}

function activatePreviewTab(name) {
  document.querySelectorAll('[data-preview-tab]').forEach(t => {
    t.setAttribute("aria-selected", t.dataset.previewTab === name ? "true" : "false");
  });
  document.querySelectorAll('[data-preview-panel]').forEach(p => {
    p.hidden = (p.dataset.previewPanel !== name);
  });
}

function wirePreviewToggle() {
  // The <details> open/closed state persists per-user via localStorage.
  const det = document.getElementById("preview-details");
  if (!det) return;
  // Restore prior state (default closed on mobile, open on desktop)
  const saved = (() => { try { return localStorage.getItem(PREVIEW_OPEN_KEY); } catch { return null; } })();
  if (saved === "open")       det.open = true;
  else if (saved === "closed") det.open = false;
  else                         det.open = window.matchMedia("(min-width: 900px)").matches;

  det.addEventListener("toggle", () => {
    try { localStorage.setItem(PREVIEW_OPEN_KEY, det.open ? "open" : "closed"); } catch {}
  });
}

function fillPanel(name, nodes) {
  const panel = document.querySelector(`[data-panel="${name}"]`);
  panel.replaceChildren(...nodes);
}

function buildChatGPTPanel({ text, sliders }, opts = {}) {
  const isPreview = opts.mode === "preview";
  const svc = services.chatgpt;
  const nodes = [];
  if (!isPreview) nodes.push(makeHint(svc.where_to_paste_human, svc.settings_url));
  nodes.push(makeOutputBlock(null, text, svc.char_limit_per_box, { isPreview }));
  if (sliders && sliders.length && !isPreview) {
    nodes.push(makeSliderRecommendations(sliders));
  }
  if (!isPreview) nodes.push(makeVerifiedStamp());
  return nodes;
}

function makeSliderRecommendations(sliders) {
  const wrap = document.createElement("div");
  wrap.className = "tab-panel__paste-hint";

  const heading = document.createElement("strong");
  heading.textContent = "Bonus — adjust these sliders too:";
  wrap.appendChild(heading);

  wrap.appendChild(document.createElement("br"));

  const intro = document.createElement("span");
  intro.textContent = "ChatGPT's Personalization page (just above the Custom instructions field) has a \"Characteristics\" section with sliders. Based on your answers, we'd suggest:";
  wrap.appendChild(intro);

  const list = document.createElement("ul");
  list.style.margin = "0.6rem 0 0";
  list.style.paddingLeft = "1.2rem";
  sliders.forEach(s => {
    const li = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = s.name;
    li.appendChild(name);
    li.appendChild(document.createTextNode(` → ${s.setting}`));
    list.appendChild(li);
  });
  wrap.appendChild(list);
  return wrap;
}

function buildSinglePanel(name, text, opts = {}) {
  const isPreview = opts.mode === "preview";
  const svc = services[name];
  const nodes = [];
  if (!isPreview) nodes.push(makeHint(svc.where_to_paste_human, svc.settings_url));
  if (opts.trimmed && !isPreview) nodes.push(makeWarning(copy.output.char_warning));
  nodes.push(makeOutputBlock(null, text, svc.char_limit, { isPreview }));
  if (!isPreview) nodes.push(makeVerifiedStamp());
  return nodes;
}

function makeHint(text, url) {
  const div = document.createElement("p");
  div.className = "tab-panel__paste-hint";

  const strong = document.createElement("strong");
  strong.textContent = copy.output.where_to_paste_label;
  div.appendChild(strong);
  div.appendChild(document.createTextNode(" " + text + " "));

  if (url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Open settings →";
    div.appendChild(a);
  }
  return div;
}

function makeOutputBlock(label, text, charLimit, opts = {}) {
  const isPreview = !!opts.isPreview;
  const wrap = document.createElement("div");
  wrap.className = isPreview ? "preview__output-block" : "tab-panel__output-block";

  if (label) {
    const lbl = document.createElement("span");
    lbl.className = "tab-panel__output-block-label";
    lbl.textContent = label;
    wrap.appendChild(lbl);
  }

  const ta = document.createElement("textarea");
  ta.className = isPreview ? "preview__output" : "tab-panel__output";
  ta.value = text;
  ta.spellcheck = false;
  ta.readOnly = isPreview;
  // Preview pane uses a small fixed height; output pane sizes to content.
  ta.rows = isPreview ? 10 : Math.min(20, Math.max(8, text.split("\n").length + 1));
  wrap.appendChild(ta);

  if (!isPreview) {
    const meta = document.createElement("div");
    meta.className = "tab-panel__meta";
    if (charLimit) {
      const counter = document.createElement("span");
      counter.textContent = fmt(copy.output.char_counter, { used: text.length, max: charLimit });
      if (text.length > charLimit) counter.style.color = "var(--error)";
      meta.appendChild(counter);
    }

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "button button--ghost tab-panel__copy";
    copyBtn.textContent = copy.output.copy_button;
    copyBtn.addEventListener("click", () => copyText(ta.value, copyBtn, ta));
    wrap.appendChild(copyBtn);
    wrap.appendChild(meta);
  }

  return wrap;
}

function makeWarning(text) {
  const div = document.createElement("p");
  div.className = "tab-panel__warning";
  div.textContent = text;
  return div;
}

function makeVerifiedStamp() {
  const p = document.createElement("p");
  p.className = "tab-panel__meta";
  const date = (services && services._last_verified) || (copy && copy._last_verified) || "unknown";
  p.textContent = fmt(copy.output.verified_stamp, { date });
  return p;
}

/* ===================== tabs ===================== */

function wireTabs() {
  document.querySelectorAll('[role="tab"]').forEach(tab => {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
    tab.addEventListener("keydown", e => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        const i = tabs.indexOf(tab);
        const next = e.key === "ArrowRight"
          ? tabs[(i + 1) % tabs.length]
          : tabs[(i - 1 + tabs.length) % tabs.length];
        next.focus();
        activateTab(next.dataset.tab);
      }
    });
  });
}

function activateTab(name) {
  document.querySelectorAll('[role="tab"]').forEach(t => {
    t.setAttribute("aria-selected", t.dataset.tab === name ? "true" : "false");
  });
  document.querySelectorAll('[role="tabpanel"]').forEach(p => {
    p.hidden = (p.dataset.panel !== name);
  });
}

/* ===================== clipboard ===================== */

async function copyText(text, btn, sourceTextarea) {
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = copy.output.copy_button_copied;
    setTimeout(() => { btn.textContent = original; }, 1800);
  } catch {
    btn.textContent = "Select & copy manually";
    sourceTextarea?.select?.();
  }
}

/* ===================== fetch + fatal fallback ===================== */

function fetchJSON(path) {
  // cache: 'no-store' so local dev iteration always sees fresh data files.
  // Production: CF Workers send `cache-control: must-revalidate` which the
  // browser respects regardless, so this changes nothing in prod — it just
  // unblocks dev when iterating on copy.json / templates.json without
  // having to clear browser cache between reloads.
  return fetch(path, { cache: "no-store" }).then(r => {
    if (!r.ok) throw new Error(`Failed to load ${path}`);
    return r.json();
  });
}

function showFatalError() {
  const main = document.querySelector("main");
  if (!main) return;
  while (main.firstChild) main.removeChild(main.firstChild);

  const section = document.createElement("section");
  section.className = "screen";

  const h1 = document.createElement("h1");
  h1.className = "screen__heading";
  h1.textContent = "Something didn't load.";
  section.appendChild(h1);

  const p = document.createElement("p");
  p.appendChild(document.createTextNode("Refresh the page and it should be fine. If it keeps happening, the source is at "));
  const a = document.createElement("a");
  a.href = "https://github.com/pacific-slate/chatprep";
  a.textContent = "github.com/pacific-slate/chatprep";
  p.appendChild(a);
  p.appendChild(document.createTextNode("."));
  section.appendChild(p);

  main.appendChild(section);
}

/* ===================================================================
 * SUPERCHARGE WIZARD — separate state machine for the CLI walk-through.
 * Independent from the personalize wizard above; doesn't touch the
 * shared `state` variable. Persists to its own localStorage key.
 * =================================================================== */

const SC_STORAGE_KEY = "chatprep.supercharge.v1";
const SC_SCREENS = ["intro", "cli", "os", "comfort", "output"];

let scState = scFreshState();
let scTools = null; // populated from cli-tools.json

function scFreshState() {
  return { cli: null, os: null, termComfort: null, _saved_at: null };
}

function scSaveDraft() {
  try {
    scState._saved_at = Date.now();
    localStorage.setItem(SC_STORAGE_KEY, JSON.stringify(scState));
  } catch {}
}

function scLoadDraft() {
  try {
    const raw = localStorage.getItem(SC_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function scClearDraft() {
  try { localStorage.removeItem(SC_STORAGE_KEY); } catch {}
}

function initSupercharge(cliTools) {
  scTools = cliTools;

  // Render dynamic controls
  scRenderCliTiles();
  scRenderOsTiles();
  scRenderComfortTiles();

  // Wire up actions + inputs
  document.body.addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "back")     scGoBack();
    if (action === "continue") scGoNext();
    if (action === "finish")   scGoNext(true);
    if (action === "restart") {
      scState = scFreshState();
      scClearDraft();
      scGoto("intro");
      window.scrollTo(0, 0);
    }
  });

  document.body.addEventListener("change", e => {
    const t = e.target;
    if (t.matches('input[name="cli"]'))         scState.cli = t.value;
    if (t.matches('input[name="os"]'))          scState.os = t.value;
    if (t.matches('input[name="termComfort"]')) scState.termComfort = t.value;
    scSaveDraft();
  });

  // History API for back-button support (matches personalize wizard pattern)
  window.addEventListener("popstate", e => {
    const screen = e.state?.screen || scScreenFromHash() || "intro";
    if (SC_SCREENS.includes(screen)) scGoto(screen, { fromPopstate: true });
  });

  const draft = scLoadDraft();
  if (draft) scState = { ...scFreshState(), ...draft };

  const initial = scScreenFromHash() || "intro";
  scGoto(initial, { replace: true });
}

function scRenderCliTiles() {
  const fs = document.querySelector('[data-field="cli"]');
  if (!fs) return;
  const opts = (copy.supercharge?.step_cli?.options) || [];
  opts.forEach(opt => {
    const label = document.createElement("label");
    label.className = "cli-tile" + (opt.available ? "" : " cli-tile--disabled");

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "cli";
    input.value = opt.id;
    if (!opt.available) input.disabled = true;
    label.appendChild(input);

    const head = document.createElement("div");
    head.className = "cli-tile__head";
    const title = document.createElement("span");
    title.className = "cli-tile__name";
    title.textContent = opt.label;
    head.appendChild(title);
    const vendor = document.createElement("span");
    vendor.className = "cli-tile__vendor";
    vendor.textContent = "by " + opt.vendor;
    head.appendChild(vendor);
    label.appendChild(head);

    const body = document.createElement("p");
    body.className = "cli-tile__body";
    body.textContent = opt.best_for;
    label.appendChild(body);

    if (!opt.available && opt.coming_soon_note) {
      const note = document.createElement("p");
      note.className = "cli-tile__note";
      note.textContent = opt.coming_soon_note;
      label.appendChild(note);
    }

    fs.appendChild(label);
  });
}

function scRenderOsTiles() {
  const fs = document.querySelector('[data-field="os"]');
  if (!fs) return;
  const opts = copy.supercharge?.step_os?.options || [];
  opts.forEach(opt => {
    const label = document.createElement("label");
    label.className = "tile";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "os";
    input.value = opt.id;
    label.appendChild(input);
    const lbl = document.createElement("span");
    lbl.className = "tile__label";
    lbl.textContent = opt.label;
    label.appendChild(lbl);
    if (opt.hint) {
      const h = document.createElement("span");
      h.className = "tile__hint";
      h.textContent = opt.hint;
      label.appendChild(h);
    }
    fs.appendChild(label);
  });
}

function scRenderComfortTiles() {
  const fs = document.querySelector('[data-field="termComfort"]');
  if (!fs) return;
  const opts = copy.supercharge?.step_comfort?.options || [];
  opts.forEach(opt => {
    const label = document.createElement("label");
    label.className = "tile";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "termComfort";
    input.value = opt.id;
    label.appendChild(input);
    const lbl = document.createElement("span");
    lbl.className = "tile__label";
    lbl.textContent = opt.label;
    label.appendChild(lbl);
    if (opt.hint) {
      const h = document.createElement("span");
      h.className = "tile__hint";
      h.textContent = opt.hint;
      label.appendChild(h);
    }
    fs.appendChild(label);
  });
}

function scGoto(screen, opts = {}) {
  const { fromPopstate = false, replace = false } = opts;
  SC_SCREENS.forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.hidden = (s !== screen);
  });
  scReflectStateIntoControls();
  const heading = document.querySelector(`#screen-${screen} .screen__heading`);
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (screen === "output") scRenderWalkthrough();
  if (!fromPopstate) {
    const url = "#" + screen;
    if (replace) history.replaceState({ screen }, "", url);
    else         history.pushState({ screen }, "", url);
  }
}

function scScreenFromHash() {
  const h = (location.hash || "").replace(/^#/, "");
  if (!h) return null;
  return SC_SCREENS.includes(h) ? h : null;
}

function scCurrentScreen() {
  return SC_SCREENS.find(s => !document.getElementById(`screen-${s}`).hidden) || "intro";
}

function scGoNext(isFinish = false) {
  const here = scCurrentScreen();
  if (!scValidateStep(here)) return;
  const idx = SC_SCREENS.indexOf(here);
  const next = isFinish ? "output" : SC_SCREENS[Math.min(SC_SCREENS.length - 1, idx + 1)];
  scGoto(next);
}

function scGoBack() {
  const here = scCurrentScreen();
  const idx = SC_SCREENS.indexOf(here);
  scGoto(SC_SCREENS[Math.max(0, idx - 1)]);
}

function scValidateStep(screen) {
  scClearError(screen);
  if (screen === "cli" && !scState.cli)             return scShowError(screen, "cli", copy.supercharge.step_cli.error_required);
  if (screen === "os"  && !scState.os)              return scShowError(screen, "os",  copy.supercharge.step_os.error_required);
  if (screen === "comfort" && !scState.termComfort) return scShowError(screen, "termComfort", copy.supercharge.step_comfort.error_required);
  return true;
}

function scShowError(screen, field, msg) {
  const node = document.querySelector(`#screen-${screen} [data-error-for="${field}"]`);
  if (node) {
    node.textContent = msg;
    node.hidden = false;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  return false;
}
function scClearError(screen) {
  document.querySelectorAll(`#screen-${screen} .error-message`).forEach(n => { n.hidden = true; });
}

function scReflectStateIntoControls() {
  document.querySelectorAll('input[name="cli"]').forEach(r => r.checked = (r.value === scState.cli));
  document.querySelectorAll('input[name="os"]').forEach(r => r.checked = (r.value === scState.os));
  document.querySelectorAll('input[name="termComfort"]').forEach(r => r.checked = (r.value === scState.termComfort));
}

/* ===== Walk-through renderer ===== */

function scRenderWalkthrough() {
  const tool = scTools && scTools[scState.cli];
  const wt = document.getElementById("walkthrough");
  if (!wt) return;
  while (wt.firstChild) wt.removeChild(wt.firstChild);

  if (!tool) {
    const p = document.createElement("p");
    p.textContent = "We don't have a walk-through for that one yet — see the link below for the official install page.";
    wt.appendChild(p);
    return;
  }

  const showExplanations = scState.termComfort === "never";

  // Tool header
  const head = document.createElement("header");
  head.className = "walkthrough__head";
  const h = document.createElement("h3");
  h.textContent = `${tool.name} on ${platformLabel(scState.os)}`;
  head.appendChild(h);
  if (tool.what_it_is) {
    const intro = document.createElement("p");
    intro.textContent = tool.what_it_is;
    head.appendChild(intro);
  }
  if (tool.what_it_costs) {
    const cost = document.createElement("p");
    cost.className = "walkthrough__cost";
    const costLbl = document.createElement("strong");
    costLbl.textContent = "Cost: ";
    cost.appendChild(costLbl);
    cost.appendChild(document.createTextNode(tool.what_it_costs));
    head.appendChild(cost);
  }
  wt.appendChild(head);

  // Prereqs
  if (tool.prereqs && tool.prereqs.items?.length) {
    const pre = document.createElement("section");
    pre.className = "walkthrough__prereqs";
    const ph = document.createElement("h4");
    ph.textContent = tool.prereqs.headline || "Before you start";
    pre.appendChild(ph);
    const ul = document.createElement("ul");
    tool.prereqs.items.forEach(it => {
      const li = document.createElement("li");
      const strong = document.createElement("strong");
      strong.textContent = it.label;
      li.appendChild(strong);
      if (it.body) {
        li.appendChild(document.createElement("br"));
        li.appendChild(document.createTextNode(it.body));
      }
      if (it.url) {
        li.appendChild(document.createTextNode(" "));
        const a = document.createElement("a");
        a.href = it.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Open →";
        li.appendChild(a);
      }
      ul.appendChild(li);
    });
    pre.appendChild(ul);
    wt.appendChild(pre);
  }

  // Steps
  const platformBlock = tool[scState.os];
  if (platformBlock && platformBlock.steps) {
    const ol = document.createElement("ol");
    ol.className = "walkthrough__steps";
    platformBlock.steps.forEach((step, i) => {
      const li = document.createElement("li");
      li.className = "step";

      const stepHead = document.createElement("h4");
      stepHead.className = "step__title";
      stepHead.textContent = step.title;
      li.appendChild(stepHead);

      if (showExplanations && step.explain_for_beginners) {
        const exp = document.createElement("p");
        exp.className = "step__explain";
        exp.textContent = step.explain_for_beginners;
        li.appendChild(exp);
      }

      if (step.command) {
        const block = scMakeCommandBlock(step.command);
        li.appendChild(block);
      }

      if (step.link) {
        const linkP = document.createElement("p");
        const a = document.createElement("a");
        a.href = step.link.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = step.link.label;
        a.className = "step__link";
        linkP.appendChild(a);
        li.appendChild(linkP);
      }

      ol.appendChild(li);
    });
    wt.appendChild(ol);
  }

  // Official link footer
  const linkP = document.createElement("p");
  linkP.className = "walkthrough__official";
  const lbl = document.createElement("strong");
  lbl.textContent = (copy.supercharge.output.official_link_label || "Official install page:") + " ";
  linkP.appendChild(lbl);
  const a = document.createElement("a");
  a.href = tool.official_url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = tool.official_url;
  linkP.appendChild(a);
  wt.appendChild(linkP);

  // Verified stamp
  const stampEl = document.getElementById("walkthrough-verified");
  if (stampEl && copy.supercharge.output.verified_stamp) {
    const date = scTools._last_verified || "unknown";
    stampEl.textContent = copy.supercharge.output.verified_stamp.replace("{date}", date);
  }
}

function scMakeCommandBlock(commandText) {
  const wrap = document.createElement("div");
  wrap.className = "command-block";

  const pre = document.createElement("pre");
  pre.className = "command-block__code";
  const code = document.createElement("code");
  code.textContent = commandText;
  pre.appendChild(code);
  wrap.appendChild(pre);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "button button--ghost command-block__copy";
  btn.textContent = copy.supercharge.output.copy_button || "Copy command";
  btn.addEventListener("click", async () => {
    const original = btn.textContent;
    try {
      await navigator.clipboard.writeText(commandText);
      btn.textContent = copy.supercharge.output.copied || "✓ Copied";
      setTimeout(() => { btn.textContent = original; }, 1800);
    } catch {
      // Fallback: select the text so user can copy manually
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      btn.textContent = "Selected — press ⌘C";
    }
  });
  wrap.appendChild(btn);

  return wrap;
}

function platformLabel(osCode) {
  return ({ mac: "Mac", win: "Windows", lin: "Linux" })[osCode] || osCode;
}
