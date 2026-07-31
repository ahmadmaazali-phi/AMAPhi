# Getting Ask Phi Working

The assistant is built and tested. It needs one thing: a backend to talk to. This takes about five minutes, once.

## Why it can't just work on its own

GitHub Pages serves files, and nothing else — there's no server to run code on. Talking to Anthropic requires an API key, and **a key cannot go in `index.html`**. Anyone can open View Source and read it, and scrapers find exposed keys within hours. Your credits would be spent by strangers.

So the key lives in a tiny free service called a Worker. Your page asks the Worker, the Worker asks Anthropic, the answer comes back. The key never touches the browser.

## Setup

### 1. Get an API key
Go to [console.anthropic.com](https://console.anthropic.com) → **API Keys** → **Create Key**. Copy it somewhere safe; you won't be shown it again.

Before going further, set a spend limit under **Billing → Limits**. This is the single most useful safeguard you have.

### 2. Create the Worker
Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) (free account is fine).

Go straight to the right page with this link:
**https://dash.cloudflare.com/?to=/:account/workers-and-pages**

Or find it in the left sidebar. It's called **Workers & Pages** on most accounts;
newer ones may show **Compute (Workers)**. Same place.

Then:

1. Click **Create application** — that's the exact button label. There is no
   button called just "Create".
2. You'll see templates and a Git import option. Choose **Hello World**
   (sometimes shown as "Start with Hello World").
3. Give it a name — `phi-assistant` is fine — and click **Deploy**.
4. Once it finishes, click **Edit code**. Select everything in the editor,
   delete it, and paste in the whole of `ask-phi-worker.js`.
5. Click **Deploy** again, top right.

If you're dropped straight into a Git-import screen with no template gallery,
look for a "Start with Hello World" or "Deploy a Worker" link on that page —
Cloudflare has been moving this around, and both routes end up in the same
editor.

### 3. Add your key as a secret
In the Worker: **Settings → Variables and Secrets → Add**

| Field | Value |
|---|---|
| Type | **Secret** — not "Text" |
| Name | `ANTHROPIC_API_KEY` |
| Value | your key from step 1 |

**Deploy** once more. Choosing "Secret" is what keeps the key encrypted and out of logs.

### 4. Lock it to your own site
Near the top of `ask-phi-worker.js` is a list of allowed domains:

```js
const ALLOWED_ORIGINS = [
  'https://ahmadmaazali.github.io',
  'https://polyhistors.com',
  ...
];
```

Replace these with your real domain. Without this, another site could point their traffic at your Worker and spend your credits.

### 5. Connect the page
Copy your Worker's URL — it looks like `https://phi-assistant.yourname.workers.dev`.

Open `index.html`, search for **`PASTE YOUR CLOUDFLARE WORKER URL`**, and put the URL between the quotes just below:

```js
endpoint: 'https://phi-assistant.yourname.workers.dev',
```

Commit and push. Ask Phi is live.

## Checking it worked

Open the site, click **Ask Φ**, and send anything. You should get a reply within a few seconds.

If not, open the browser console (F12) — the widget reports what went wrong:

| What you see | What it means |
|---|---|
| "isn't live just yet" | The `endpoint` line is still empty |
| "API key was rejected" | The secret is missing, misnamed, or wrong. It must be named exactly `ANTHROPIC_API_KEY` |
| A CORS error in the console | Your domain isn't in `ALLOWED_ORIGINS` |
| Can't find "Create application" | You may be on the account home page rather than Workers & Pages. Use the direct link above |
| "took longer than expected" | Request exceeded 45s. Usually transient — try again |

## What it costs

Each question sends the conversation plus a slice of the page the reader is on, and gets back a few paragraphs. That's roughly 2,000–4,000 tokens per exchange — a fraction of a penny on Sonnet. A hundred questions a day is a few pounds a month. The spend limit from step 1 is your backstop.

## What's already protected

The Worker isn't a naked pipe to your key:

- **The system prompt is built server-side.** The endpoint is public, so anything the browser sends could be tampered with. Instructions come from the Worker, not the page — someone POSTing directly can't rewrite Phi's behaviour.
- **Conversations are capped** at 12 messages, 4,000 characters each, so a long paste can't run up a bill.
- **Only your domains are allowed** through CORS.
- **Errors are translated** into something a reader can act on, rather than a raw status code.

## Changing how Phi answers

The instructions are in `buildSystemPrompt()` in `ask-phi-worker.js`. It currently tells Phi to separate scientific and scriptural accounts, cite Qur'an by surah:ayah, Hadith by collection and number, Bible by book chapter:verse, flag where classical tafsir differs from popular modern readings, and lay out the range of views on contested questions rather than picking one.

Edit that function and redeploy the Worker. No change to the website is needed.

## If you'd rather not run a Worker

The widget degrades honestly. With `endpoint` left empty it tells the reader the assistant isn't live yet and points them to your WhatsApp and the tutoring form — as a working link, not raw text. Nothing looks broken, so there's no harm in leaving it until you're ready.
