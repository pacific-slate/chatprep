# Vendor sources for ChatPrep templates

> **Purpose:** every output format ChatPrep produces is grounded in the AI vendor's own published guidance, not invented by us. This file cites the exact docs we drew from. Re-verify quarterly — these change.

**Last verified:** 2026-04-27

---

## OpenAI (ChatGPT)

### Output format
Two-box plain text with markdown section headers (`# About me`, `# What I want help with`, `# How to respond`, `# Always`, `# Avoid`, `# When unsure`).

### Why this format
- **Two boxes**: ChatGPT's Custom Instructions UI literally has two text boxes labeled "What would you like ChatGPT to know about you to provide better responses?" and "How would you like ChatGPT to respond?" Our `box1` / `box2` split mirrors that.
- **Markdown headers**: OpenAI's GPT-4.1 Prompting Guide explicitly recommends a markdown-headed structure: `# Role and Objective`, `# Instructions`, `# Output Format`, `# Examples`, `# Context`. Quote: *"We recommend starting here [markdown], and using markdown titles for major sections and subsections."*

### Sources
- **GPT-4.1 Prompting Guide** — `github.com/openai/openai-cookbook/blob/main/examples/gpt4-1_prompting_guide.ipynb` (the §"Prompt Structure" + §"Delimiters" sections)
- ChatGPT Custom Instructions help center: `help.openai.com/en/articles/8096356` — bot-blocked from automated fetch; verified box labels manually 2026-04-27.

### Char limits
~1,500 per box (OpenAI doesn't publish an exact number; ~1,500 is the widely-reported community estimate). Our `services.json` carries this; counter shows live in the output panel.

---

## Anthropic (Claude)

### Output format
XML tags: `<role>` → `<about-me>` → `<how-to-respond>` → `<always>` → `<avoid>` → `<when-unsure>`. Wrap in nothing — Claude reads the whole block as the system prompt for a Project.

### Why this format
- **XML tags reduce misinterpretation**. Direct quote from the Anthropic docs: *"XML tags help Claude parse complex prompts unambiguously, especially when your prompt mixes instructions, context, examples, and variable inputs. Wrapping each type of content in its own tag (e.g. `<instructions>`, `<context>`, `<input>`) reduces misinterpretation."*
- **Use consistent, descriptive tag names**. Their guidance, our practice.
- **Give Claude an explicit role**. Quote: *"Setting a role in the system prompt focuses Claude's behavior and tone for your use case. Even a single sentence makes a difference."* — that's why our first tag is `<role>`.

### Sources
- **Anthropic Prompting Best Practices** — `https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/system-prompts` (sections "Structure prompts with XML tags" + "Give Claude a role")
- Anthropic Claude Cookbook (general examples) — `github.com/anthropics/claude-cookbooks` — does not ship a personalization template; their guidance is in the prompt-engineering docs above.

### Char limits
Claude Projects accept very long descriptions (200K context). No practical char limit for our use case; we don't auto-trim.

---

## Google (Gemini)

### Output format
XML tags using **Google's exact recommended tag names**: `<role>` → `<context>` → `<constraints>` → `<task>`.

### Why this format
- Google's own Gemini 3 prompt design guide publishes this exact template:
  ```
  <role>
  You are [specialized assistant for domain]
  </role>

  <constraints>
  1. [Behavioral rules]
  2. [Output standards]
  </constraints>

  <context>
  [User input/background data]
  </context>

  <task>
  [Specific request]
  </task>
  ```
- We follow the schema literally so future Gemini model updates (which Google will tune against this template) keep working without our intervention.

### Sources
- **Gemini API Prompting Strategies** — `https://ai.google.dev/gemini-api/docs/prompting-strategies`
- Gemini Cookbook (general examples) — `github.com/google-gemini/cookbook` — no personalization templates published; canonical structure is in the docs above.

### Char limits
Gemini Gems cap around **4,000 characters** (widely reported across third-party guides; Google doesn't publish an exact number). We auto-trim optional sections (hobbies, fallback) when over limit and surface a "we trimmed" warning.

---

## What's NOT vendor-published

The vendors all document **developer-facing prompt structure**. None of them publishes a **consumer personalization template** (i.e. "here's what to put in your Custom Instructions box"). The end-user help articles for ChatGPT / Claude / Gemini all give one-paragraph overviews and rely on the user to figure out what to write. ChatPrep fills that gap by mapping a friendly 4-question wizard onto each vendor's developer-grade structure.

This means:
- Vendor structure is authoritative — we follow it literally.
- Vendor *content* for consumer use cases is something they leave to the user — ChatPrep's content (tone phrases, "always do" rules, etc.) is our own reasonable synthesis. We've kept it editable in `data/templates.json` so anyone can adjust without touching code.

## How to re-verify

When AI services update — quarterly at minimum — walk this checklist:

1. **OpenAI**: re-fetch `github.com/openai/openai-cookbook/blob/main/examples/gpt4-1_prompting_guide.ipynb` (or the latest model's equivalent). Diff against the structure recommendations in §"Prompt Structure".
2. **Anthropic**: re-fetch `platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/system-prompts`. Confirm XML-tag and role guidance unchanged.
3. **Google**: re-fetch `ai.google.dev/gemini-api/docs/prompting-strategies`. Confirm XML schema unchanged.
4. Update `_last_verified` in `public/data/services.json` and `public/data/templates.json`.
5. Update the date stamp at the top of this file.
6. If any vendor guidance has materially changed, update the matching adapter in `public/app.js` and bump `_version`.
