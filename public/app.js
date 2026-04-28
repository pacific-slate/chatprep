/* ChatPrep — app.js
 *
 * Vanilla ES module. No build step. No framework. No bundler.
 *
 * Responsibilities:
 *   - Load JSON data (copy, services, templates, industries)
 *   - Hydrate DOM from copy.json (data-copy + data-copy-attr)
 *   - Render dynamic step controls (tiles, checkboxes, datalist)
 *   - Run the wizard state machine (intro → step1..5 → output)
 *   - Persist answers in localStorage
 *   - Derive canonical template + adapt per service
 *   - Wire copy-to-clipboard
 *
 * Posture: be tolerant of missing/odd data. If something's wrong,
 * show plain-English fallback rather than crashing the wizard.
 *
 * Security: never assign HTML strings to innerHTML — always build
 * with createElement + textContent so content from data files (or
 * user input) cannot execute as markup.
 */

"use strict";

const STORAGE_KEY = "chatprep.draft.v1";
const STORAGE_TTL_DAYS = 30;
const SCREENS = ["intro", "step1", "step2", "step3", "step4", "step5", "output"];
const ORDER   = ["intro", "step1", "step2", "step3", "step4", "step5", "output"];

let copy, services, templates, industries;
let state = freshState();

/* ===================== bootstrap ===================== */

document.addEventListener("DOMContentLoaded", () => {
  bootstrap().catch(err => {
    console.error("ChatPrep failed to start:", err);
    showFatalError();
  });
});

async function bootstrap() {
  [copy, services, templates, industries] = await Promise.all([
    fetchJSON("data/copy.json"),
    fetchJSON("data/services.json"),
    fetchJSON("data/templates.json"),
    fetchJSON("data/industries.json"),
  ]);

  hydrateCopy(document.body);
  renderStep1Tiles();
  renderStep2Tiles();
  renderStep3Checkboxes();
  renderStep4Industries();
  renderStep4DetailTiles();
  renderStep5Checkboxes();
  wireActions();
  wireFieldInputs();
  wireTabs();

  const draft = loadDraft();
  if (draft) {
    state = { ...freshState(), ...draft };
    document.querySelector('[data-action="resume"]')?.removeAttribute("hidden");
  }

  goto("intro");
}

/* ===================== state ===================== */

function freshState() {
  return {
    goal: null,
    comfort: null,
    services: [],
    industry: "",
    role: "",
    country: "",
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
  const fs = document.querySelector('[data-field="goal"]');
  fs.appendChild(buildTiles(copy.step1.options, "goal", "radio"));
}
function renderStep2Tiles() {
  const fs = document.querySelector('[data-field="comfort"]');
  fs.appendChild(buildTiles(copy.step2.options, "comfort", "radio"));
}
function renderStep3Checkboxes() {
  const fs = document.querySelector('[data-field="services"]');
  fs.appendChild(buildCheckboxRows(copy.step3.options, "services"));
}
function renderStep4Industries() {
  const dl = document.getElementById("list-industries");
  industries.industries.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    dl.appendChild(opt);
  });
}
function renderStep4DetailTiles() {
  const fs = document.querySelector('[data-field="detail"]');
  fs.appendChild(buildTiles(copy.step4.detail_options, "detail", "radio"));
}
function renderStep5Checkboxes() {
  const fs = document.querySelector('[data-field="avoid"]');
  fs.appendChild(buildCheckboxRows(copy.step5.options, "avoid"));
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
  start:    () => { state = freshState(); clearDraft(); goto("step1"); },
  resume:   () => { goto(currentStepFromState() || "step1"); },
  back:     () => goBack(),
  continue: () => goNext(),
  finish:   () => goNext(true),
  restart:  () => { state = freshState(); clearDraft(); goto("intro"); window.scrollTo(0, 0); },
};

function wireFieldInputs() {
  document.body.addEventListener("change", e => {
    const t = e.target;
    if (t.matches('input[name="goal"]'))     state.goal = t.value;
    if (t.matches('input[name="comfort"]'))  state.comfort = t.value;
    if (t.matches('input[name="detail"]'))   state.detail = t.value;
    if (t.matches('input[name="services"]')) state.services = collectChecked("services");
    if (t.matches('input[name="avoid"]'))    state.avoid    = collectChecked("avoid");
    saveDraft();
  });
  document.body.addEventListener("input", e => {
    const t = e.target;
    if (!t.dataset.field) return;
    const f = t.dataset.field;
    if (["industry","role","country","hobbies","avoid_other"].includes(f)) {
      state[f] = t.value;
      saveDraft();
    }
  });
}

function collectChecked(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
}

/* ===================== navigation / validation ===================== */

function goto(screen) {
  SCREENS.forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.hidden = (s !== screen);
  });
  reflectStateIntoControls();
  const heading = document.querySelector(`#screen-${screen} .screen__heading`);
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (screen === "output") renderOutputs();
}

function currentScreen() {
  return SCREENS.find(s => !document.getElementById(`screen-${s}`).hidden) || "intro";
}

function currentStepFromState() {
  if (!state.goal) return "step1";
  if (!state.comfort) return "step2";
  if (state.services.length === 0) return "step3";
  if (!state.industry && !state.role && !state.country) return "step4";
  return "step5";
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
  if (screen === "step1" && !state.goal)
    return showError("step1", "goal", copy.step1.error_required);
  if (screen === "step2" && !state.comfort)
    return showError("step2", "comfort", copy.step2.error_required);
  if (screen === "step3" && state.services.length === 0)
    return showError("step3", "services", copy.step3.error_required);
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
  setChecks("services", state.services);
  setChecks("avoid", state.avoid);
  setText("industry", state.industry);
  setText("role", state.role);
  setText("country", state.country);
  setText("hobbies", state.hobbies);
  setText("avoid_other", state.avoid_other);
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
  if (el && el.tagName !== "FIELDSET") el.value = value || "";
}

/* ===================== template derivation ===================== */

function deriveCanonical() {
  const t = templates;
  const role     = state.role.trim()     || "person";
  const industry = state.industry.trim() || "general work";
  const country  = state.country.trim()  || "the United States";

  const goalsLine    = t.goals_by_q1[state.goal] || "Help me think more clearly.";
  const toneCfg      = t.tone_by_comfort[state.comfort] || t.tone_by_comfort.casual;
  const formatLine   = t.format_by_q1[state.goal] || "Mix prose with bullets where helpful.";
  const lengthLine   = t.length_by_detail[state.detail] || t.length_by_detail.standard;

  const aboutMe = fmt(t.skeleton.about_me, { role, industry, country });

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
    hobbies:      state.hobbies.trim(),
    goalsLead:    t.skeleton.goals_lead,
    goalsLine,
    toneLead:     t.skeleton.tone_lead,
    tone:         toneCfg.tone,
    readingLevel: toneCfg.reading_level,
    format:       formatLine,
    length:       lengthLine,
    alwaysLead:   t.skeleton.always_lead,
    always:       alwaysList,
    avoidLead:    t.skeleton.avoid_lead,
    avoid:        avoidList,
    fallback:     t.skeleton.fallback,
  };
}

function adaptForChatGPT(c) {
  const box1 = [
    c.aboutMe,
    c.hobbies ? `My hobbies and interests: ${c.hobbies}.` : null,
    "",
    c.goalsLead,
    `- ${c.goalsLine}`,
  ].filter(Boolean).join("\n");

  const box2 = [
    c.toneLead,
    `- Tone: ${c.tone}.`,
    `- Reading level: ${c.readingLevel}`,
    `- Format: ${c.format}`,
    `- Length: ${c.length}`,
    "",
    c.alwaysLead,
    ...(c.always.length ? c.always.map(x => `- ${x}`) : ["- (no specific rules — use your best judgment)"]),
    "",
    c.avoidLead,
    ...c.avoid.map(x => `- ${x}`),
    "",
    c.fallback,
  ].join("\n");

  return { box1, box2 };
}

function adaptForClaude(c) {
  const aboutSection = c.aboutMe + (c.hobbies ? `\nMy hobbies: ${c.hobbies}.` : "");
  return [
    "<about-me>", aboutSection, "</about-me>", "",
    "<goals>", c.goalsLine, "</goals>", "",
    "<tone-and-format>",
    `Tone: ${c.tone}.`,
    `Reading level: ${c.readingLevel}`,
    `Format: ${c.format}`,
    `Length: ${c.length}`,
    "</tone-and-format>", "",
    "<always>",
    ...(c.always.length ? c.always.map(x => `- ${x}`) : ["- Use your best judgment."]),
    "</always>", "",
    "<avoid>", ...c.avoid.map(x => `- ${x}`), "</avoid>", "",
    "<fallback>", c.fallback, "</fallback>",
  ].join("\n");
}

function adaptForGemini(c) {
  const full = [
    c.aboutMe,
    c.hobbies ? `Hobbies: ${c.hobbies}.` : null,
    "",
    `${c.goalsLead} ${c.goalsLine}`,
    "",
    `Tone: ${c.tone}. Reading level: ${c.readingLevel} Format: ${c.format} Length: ${c.length}`,
    "",
    c.alwaysLead,
    ...(c.always.length ? c.always.map(x => `- ${x}`) : ["- Use your best judgment."]),
    "",
    c.avoidLead,
    ...c.avoid.map(x => `- ${x}`),
    "",
    c.fallback,
  ].filter(Boolean).join("\n");

  const limit = services.gemini.char_limit || 4000;
  if (full.length <= limit) return { text: full, trimmed: false };

  let txt = full;
  // Drop optional sections to fit.
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

function fillPanel(name, nodes) {
  const panel = document.querySelector(`[data-panel="${name}"]`);
  panel.replaceChildren(...nodes);
}

function buildChatGPTPanel({ box1, box2 }) {
  const svc = services.chatgpt;
  return [
    makeHint(svc.where_to_paste_human, svc.settings_url),
    makeOutputBlock("Box 1 — \"What would you like ChatGPT to know about you?\"", box1, svc.char_limit_per_box),
    makeOutputBlock("Box 2 — \"How would you like ChatGPT to respond?\"", box2, svc.char_limit_per_box),
    makeVerifiedStamp(),
  ];
}

function buildSinglePanel(name, text, opts = {}) {
  const svc = services[name];
  const nodes = [makeHint(svc.where_to_paste_human, svc.settings_url)];
  if (opts.trimmed) nodes.push(makeWarning(copy.output.char_warning));
  nodes.push(makeOutputBlock(null, text, svc.char_limit));
  nodes.push(makeVerifiedStamp());
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

function makeOutputBlock(label, text, charLimit) {
  const wrap = document.createElement("div");
  wrap.className = "tab-panel__output-block";

  if (label) {
    const lbl = document.createElement("span");
    lbl.className = "tab-panel__output-block-label";
    lbl.textContent = label;
    wrap.appendChild(lbl);
  }

  const ta = document.createElement("textarea");
  ta.className = "tab-panel__output";
  ta.value = text;
  ta.spellcheck = false;
  ta.rows = Math.min(20, Math.max(8, text.split("\n").length + 1));
  wrap.appendChild(ta);

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
  return fetch(path).then(r => {
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
