/**
 * Ask Phi — Cloudflare Worker proxy
 * PolyHistors Institute
 *
 * WHY THIS EXISTS
 * GitHub Pages serves static files only, so the site cannot hold an API key.
 * Anything written into index.html is public. This Worker sits between the
 * browser and Anthropic, holding the key as an encrypted secret.
 *
 * DEPLOY
 *   1. dash.cloudflare.com -> Workers & Pages -> Create -> Worker
 *   2. Replace the default code with this file, and Deploy
 *   3. Settings -> Variables and Secrets -> Add:
 *        Type:  Secret        (NOT "Text")
 *        Name:  ANTHROPIC_API_KEY
 *        Value: your key from console.anthropic.com
 *   4. Edit ALLOWED_ORIGINS below to your own domain
 *   5. Copy the Worker URL into PHI_ASSISTANT.endpoint in index.html
 */

/* Only these sites may use your Worker. Leaving "*" in place would let anyone
   route their traffic through your key. Replace with your real domain(s). */
const ALLOWED_ORIGINS = [
  'https://ahmadmaazali-phi.github.io',   // <- the live site
  'https://polyhistors.com',              // keep for a future custom domain
  'https://www.polyhistors.com',
  'http://localhost:8000',                // local testing; harmless to leave
];

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1200;
const MAX_MESSAGES = 12;
const MAX_CHARS = 4000;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
  };
}

/**
 * The system prompt is built HERE, not taken from the browser.
 * The endpoint is public, so anything the client sends could be tampered with.
 * Only the page context (topic, section, excerpt) is accepted from the client,
 * and it is length-capped before use.
 */
function buildSystemPrompt({ topic, section, excerpt }) {
  const lines = [
    'You are Phi, the study assistant for PolyHistors Institute — a site presenting the history of the universe, life and humanity with modern science and scriptural tradition side by side, along with pages on religion, theology, philosophy, astronomy, poetry and Urdu literature.',
    '',
    `The reader is currently on the page: ${topic || 'PolyHistors Institute'}.`,
  ];

  if (section) lines.push(`They are reading the section: ${section}.`);

  if (excerpt) {
    lines.push(
      '',
      "TEXT CURRENTLY ON THEIR SCREEN (use it when they say 'this', 'here' or 'that passage'):",
      '---',
      excerpt,
      '---'
    );
  }

  lines.push(
    '',
    'HOW TO ANSWER:',
    '- Where a question touches both science and scripture, give each account clearly separated, then note honestly where they converge, where they simply address different questions, and where a claimed correspondence is contested.',
    '- Cite precisely: Qur\u2019an as surah:ayah (e.g. 21:30); Hadith with collection and number (e.g. Sahih al-Bukhari 3191); Bible as book chapter:verse.',
    '- Note classical tafsir readings (al-Tabari, al-Qurtubi, Ibn Kathir, al-Razi) where they differ from popular modern ones.',
    '- Be honest about uncertainty. Do not present contested interpretations as settled, and do not overstate "scientific miracle" claims.',
    '- Where Muslims or Christians genuinely disagree \u2014 human evolution and Adam especially \u2014 lay out the range of positions with their strengths and difficulties rather than picking one.',
    '- Be respectful toward all traditions. You may explain what a tradition holds without asserting it as fact.',
    '- Keep answers focused and readable: usually 2\u20134 short paragraphs. Use **bold** sparingly. Markdown links render, so [label](https://url) is fine.',
    '- If a question falls outside the site\u2019s scope, answer briefly and helpfully anyway.'
  );

  return lines.join('\n');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ reply: 'This endpoint accepts POST requests only.' }), {
        status: 405,
        headers: cors,
      });
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({
          reply:
            'The assistant is not finished setting up: the Worker has no ANTHROPIC_API_KEY secret. ' +
            'Add it under Settings -> Variables and Secrets.',
        }),
        { status: 503, headers: cors }
      );
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ reply: 'Could not read that request.' }), {
        status: 400,
        headers: cors,
      });
    }

    const { messages, topic, section, excerpt } = payload || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ reply: 'No question was received.' }), {
        status: 400,
        headers: cors,
      });
    }

    /* Trim and sanitise so a long paste cannot run up a bill */
    const trimmed = messages.slice(-MAX_MESSAGES).map((m) => ({
      role: m && m.role === 'assistant' ? 'assistant' : 'user',
      content: String((m && m.content) || '').slice(0, MAX_CHARS),
    }));

    const system = buildSystemPrompt({
      topic: String(topic || '').slice(0, 200),
      section: String(section || '').slice(0, 200),
      excerpt: String(excerpt || '').slice(0, 6000),
    });

    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: trimmed,
        }),
      });

      if (!upstream.ok) {
        const detail = await upstream.text();
        console.error('Anthropic error', upstream.status, detail);

        const friendly =
          upstream.status === 429
            ? 'The assistant is busy right now. Please try again in a moment.'
            : upstream.status === 401
            ? 'The assistant\u2019s API key was rejected. Check the ANTHROPIC_API_KEY secret in the Worker.'
            : 'The assistant service is unavailable right now. Please try again shortly.';

        return new Response(JSON.stringify({ reply: friendly }), {
          status: upstream.status === 401 ? 500 : 502,
          headers: cors,
        });
      }

      const data = await upstream.json();
      const reply = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      return new Response(
        JSON.stringify({ reply: reply || 'No answer came back. Please rephrase and try again.' }),
        { status: 200, headers: cors }
      );
    } catch (err) {
      console.error('Worker error', err);
      return new Response(
        JSON.stringify({ reply: 'Could not reach the assistant. Please try again shortly.' }),
        { status: 500, headers: cors }
      );
    }
  },
};
