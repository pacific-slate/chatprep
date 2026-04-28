# ChatPrep — Wizard & Template Specification

> **Status:** v0.1 — kickoff spec, locks the contract for Days 2–6 build.
> **Source:** distilled from `AI Helper/Prep/ai basics gameplan.md` (the 555-line research report). Section refs cite that doc.
> **Last verified:** 2026-04-27. AI service features change fast — re-verify before each release.

---

## 1. What ChatPrep does

A non-technical user answers 5 questions in ~3 minutes. ChatPrep generates three copy-paste templates — one for ChatGPT Custom Instructions, one for a Claude Project description, one for a Gemini Gem instruction — pre-trimmed to each service's character limits. The user clicks "Copy" on the right tab and pastes it into the service's settings panel. Done.

The wizard is the entire product. There is no account, no profile, no server, no analytics. State persists in `localStorage` only.

---

## 2. The 5 questions (gameplan §3.7)

| # | Question (visible to user) | Input type | Required? | Notes |
|---|---|---|---|---|
| 1 | "What do you mainly want help with?" | radio (6 large tiles) | yes | Options: Writing · Learning · Work · Coding · Daily life · Creative |
| 2 | "How comfortable are you with AI tools?" | radio (3) | yes | Options: Never used · Used a little · Use regularly |
| 3 | "Which AI services do you already pay for or have access to?" | checkbox (multi) | yes (≥1) | Options: Free ChatGPT · ChatGPT Plus · Claude · Gemini · Microsoft Copilot at work · I don't know |
| 4 | "Tell us about yourself" | mixed | yes for industry/role; rest optional | See §2.4 |
| 5 | "Anything you want the AI to *avoid*?" | checkbox group + free text | optional | See §2.5 |

### 2.4 — Step 4 fields

| Field | Control | Source | Notes |
|---|---|---|---|
| Industry | search-as-you-type combobox | NAICS top-level (~20 entries v1) | "Other (type your own)" fallback always present |
| Role | search-as-you-type combobox | hand-curated short list (~30 generic roles) | "Other" fallback |
| Country | dropdown | ISO 3166-1 alpha-2 names | "Other" not needed; this list is exhaustive |
| Hobbies / interests | free text, 200 char max | — | optional |
| Level of detail | slider with 3 labeled stops | Minimal · Standard · Detailed | per gameplan §3.4 — also expose as 3 radios for non-slider users |

**Privacy phrasing on this screen (gameplan §5.5):**
> *"We don't ask for your name, address, employer, or any details that could identify you. Keep it general — 'a teacher in California' is enough."*

### 2.5 — Step 5 "avoid" checkboxes

Default options (multi-select):
- No jokes or emoji
- Don't pretend to have personal experiences
- Don't ask me for sensitive personal info
- Cite sources when stating facts
- Use plain English, not jargon
- Always show worked examples for math/code
- Stay neutral on politics

Plus free-text box: "Anything else?" (300 char max).

---

## 3. Template skeleton (gameplan §5.3)

The internal canonical form. Service-specific output is derived from this.

```
# About me
I'm a [ROLE] working in [INDUSTRY].
I'm based in [COUNTRY].
My goals with AI: [GOALS_FROM_Q1]
[IF DETAIL_LEVEL ≥ Standard]: My hobbies and interests are [HOBBIES].
[IF DETAIL_LEVEL = Detailed]: I'm working on [PROJECT_FREETEXT].

# How I want you to respond
Tone: [TONE_DERIVED_FROM_Q1+Q2]
Length: [LENGTH_DERIVED_FROM_DETAIL_SLIDER]
Format: [FORMAT_DERIVED_FROM_Q1]
Reading level: [READING_LEVEL_FROM_Q2]

# Things to always do
- [DERIVED_FROM_Q5_POSITIVE_CHECKBOXES]

# Things to avoid
- [DERIVED_FROM_Q5_NEGATIVE_CHECKBOXES]
- Don't ask me for sensitive information (full addresses, passwords, financial details).

# When you're not sure
Ask me a clarifying question rather than guessing.
```

**Derivation rules** (in `app.js`, deterministic):

| Field | Rule |
|---|---|
| GOALS_FROM_Q1 | Map Q1 selection → 1-line goal phrase. e.g. "Writing" → "help me write clearer, more engaging prose." |
| TONE | Q1=Creative → "warm, willing to riff." Q1=Work → "professional, neutral." Default: "friendly but direct." |
| LENGTH | Detail slider Minimal=brief; Standard=medium; Detailed=detailed |
| FORMAT | Q1=Coding → "code blocks with inline explanation." Q1=Learning → "Socratic, ask before assuming." Default: "prose with bullets where useful." |
| READING_LEVEL | Q2=Never used → "plain English, ~8th grade." Q2=Used regularly → "professional." |

---

## 4. Per-service adaptation

### 4.1 ChatGPT (Custom Instructions)

Two boxes on `chatgpt.com/#settings/CustomInstructions`:
- "What would you like ChatGPT to know about you?" — **maps to "About me" section**, ~1500 char limit each box (verify on release)
- "How would you like ChatGPT to respond?" — **maps to "How I want you to respond" + "Things to always" + "Things to avoid"**

Char counter visible per box. Auto-trim by dropping optional sections (hobbies first, then project).

### 4.2 Claude (Project description)

Single text field on `claude.ai/projects/new`. **Use full canonical template, no split.** Anthropic recommends XML-style tags for Claude (gameplan §5.2) — wrap each section:

```
<about-me>...</about-me>
<style>...</style>
<rules>...</rules>
```

200K context, no practical char limit on Project description for our use case.

### 4.3 Gemini (Gem instructions)

Single text field on `gemini.google.com/gems/create`. **Hard cap ~4000 chars** (gameplan §5.1). Auto-trim aggressively:
1. Drop "When you're not sure" first
2. Then optional hobbies/project
3. Then collapse "Things to avoid" to top 3 items
4. Visible live char counter `n/4000` on the Gemini tab

If the trimmed template is still over 4000 chars, surface a warning with a "what got trimmed" breakdown — do not silently truncate.

---

## 5. Output UI (gameplan §3.6)

- 3 tabs: `ChatGPT` | `Claude` | `Gemini`. Default to whichever service the user selected in Q3 first.
- Each tab has its own "Copy" button. No global copy.
- Below tabs: 1-paragraph explainer of why three formats.
- `<details>` element ("Why three formats?") closed by default for the curious.
- "Last verified: 2026-04-27" stamp on each tab footer.
- Each tab also shows a 1-sentence "Where to paste this" link with the service's settings URL.

---

## 6. Data files (separate from logic)

| File | Purpose |
|---|---|
| `templates.json` | The skeleton, derivation rules as data, service-specific transforms |
| `data/industries.json` | NAICS top-level list |
| `data/countries.json` | ISO 3166 list |
| `data/services.json` | Per-service URLs, char limits, "last verified" date — **the single file to update when AI services change** |
| `locales/en.json` | All UI strings (i18n-ready per gameplan §2.4) |

No string literals in `app.js` or `index.html` — all user-facing text lives in `locales/en.json`.

---

## 7. State persistence

- `localStorage["chatprep.draft"]` — JSON of all answers, written on every step change.
- On page load: if draft exists and is <30 days old, show "Resume where you left off?" banner.
- Clear button always visible in footer.

---

## 8. Accessibility floor (gameplan §8.1)

WCAG 2.2 AA, plus AAA target-size (44×44 px). Specifically:
- All inputs have `<label>` association.
- Visible focus ring on every focusable element.
- Errors inline + summary at top, plain language.
- Combobox follows WAI-ARIA Authoring Practices `combobox` pattern.
- 18–20px body, 150% line-height, max 38rem line length.
- 4.5:1 minimum contrast (AA), aim AAA on home.
- Works at 200% zoom and on 320px viewport.

---

## 9. Out of scope for V1

Per gameplan §4.4: i18n beyond English, the auto-monitoring agent, saved profiles via URL fragment, "lint your existing prompt" mode, printable PDF, voice input, school/educator mode, Perplexity / Copilot / Grok / Mistral / Llama. **All deferred.**

---

## 10. Definition of done (V1)

- All 5 wizard steps work, keyboard-only navigable.
- Three tabs render valid templates for any answer combination.
- Each tab's Copy button writes the right thing to clipboard.
- Mobile (320px) works without horizontal scroll.
- Light + dark mode both pass contrast.
- VoiceOver reads the entire wizard in correct order.
- 5 non-technical users complete the wizard without help.
- README has "what this is, how to verify it sends nothing, MIT license" stated above the fold.
