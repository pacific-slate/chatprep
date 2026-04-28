# ChatPrep

A free wizard that builds copy-paste personalization templates for ChatGPT, Claude, and Gemini.

**No accounts. No tracking. No analytics. Runs entirely in your browser.**

## What this is

A five-question wizard that produces three copy-paste templates — one for ChatGPT Custom Instructions, one for a Claude Project, one for a Gemini Gem — pre-trimmed to each service's character limits and conventions. Designed for non-technical users (high-school graduates, retirees, ESL speakers) who want to make AI work better for them but don't know where to start.

Built as a public utility, not a startup. Open source, MIT licensed, no monetization.

## How to run locally

This is a vanilla HTML/CSS/JS site with no build step.

```sh
cd chatprep
python3 -m http.server -d public 8000
```

Then open <http://localhost:8000>.

## Project structure

```
chatprep/
├── public/              # deployable static site (uploaded to Cloudflare)
│   ├── index.html       # single-page wizard UI
│   ├── styles.css       # vanilla CSS, custom properties, mobile-first
│   ├── app.js           # ES module, no bundler
│   └── templates.json   # service templates as data
├── SPEC.md              # wizard contract (questions, outputs, behavior)
├── wrangler.jsonc       # Cloudflare Workers static-assets config
├── LICENSE              # MIT
└── README.md
```

## Deploy

Push to `main` → Cloudflare Workers (Static Assets) auto-deploys to <https://chatprep.org>.

The Cloudflare project runs `npx wrangler deploy` on each push, which uploads `./public/` as static assets per [`wrangler.jsonc`](wrangler.jsonc).

## License

MIT. See [`LICENSE`](LICENSE).

## Privacy

This site does not run a server. There is no backend, no database, no logging, no analytics. Everything you type stays in your browser. To verify: open the page, view source, search for "fetch" or "XMLHttpRequest" — you won't find any. After the page loads, you can disconnect from the internet and the wizard still works.

## Disclaimer

ChatGPT is a trademark of OpenAI. Claude is a trademark of Anthropic. Gemini is a trademark of Google. ChatPrep is not affiliated with, endorsed by, or sponsored by any of them.
