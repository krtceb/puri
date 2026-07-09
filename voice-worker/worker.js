/* Puri voice relay: gives the app a natural Georgian voice.
   Runs on Cloudflare Workers (free plan). Speaks via the same public
   endpoint Microsoft Edge's "Read Aloud" uses - no account, no key, no cost.
   GET /?q=<georgian text>&voice=eka|giorgi  ->  audio/mpeg */

const TRUSTED_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_VERSION = "143.0.3650.75"; // keep close to current Edge; stale versions get 403
const CHROMIUM_MAJOR = CHROMIUM_VERSION.split(".")[0];
const VOICES = {
  eka: "ka-GE-EkaNeural",
  giorgi: "ka-GE-GiorgiNeural",
  en: "en-US-JennyNeural",
  tr: "tr-TR-EmelNeural",
  ru: "ru-RU-SvetlanaNeural",
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

// Microsoft's endpoint wants a rolling proof-of-time hash (what Edge itself sends).
async function secMsGec() {
  const winEpoch = 11644473600; // seconds between 1601-01-01 and 1970-01-01
  let s = Math.floor(Date.now() / 1000) + winEpoch;
  s -= s % 300; // round down to the current 5-minute window
  const ticks = s * 10000000; // 100-nanosecond ticks
  const bytes = new TextEncoder().encode(String(ticks) + TRUSTED_TOKEN);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function escapeXml(t) {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function uuid() {
  return crypto.randomUUID().replace(/-/g, "");
}

async function synthesize(text, voiceName) {
  const gec = await secMsGec();
  const url =
    "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
    "?TrustedClientToken=" + TRUSTED_TOKEN +
    "&Sec-MS-GEC=" + gec +
    "&Sec-MS-GEC-Version=1-" + CHROMIUM_VERSION +
    "&ConnectionId=" + uuid();

  // random per-request browser identity cookie; the service requires one
  const muid = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  const resp = await fetch(url, {
    headers: {
      Upgrade: "websocket",
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/" + CHROMIUM_MAJOR + ".0.0.0 Safari/537.36 Edg/" + CHROMIUM_MAJOR + ".0.0.0",
      Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: "muid=" + muid + ";",
    },
  });
  const ws = resp.webSocket;
  if (!ws) {
    let body = "";
    try { body = (await resp.text()).slice(0, 160); } catch {}
    throw new Error("upstream refused websocket: HTTP " + resp.status + " " + body);
  }
  ws.accept();

  const requestId = uuid();
  const now = new Date().toString();

  ws.send(
    "X-Timestamp:" + now + "\r\n" +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
    '"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},' +
    '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
  );

  const ssml =
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    "<voice name='" + voiceName + "'>" +
    "<prosody pitch='+0Hz' rate='+0%' volume='+0%'>" + escapeXml(text) + "</prosody>" +
    "</voice></speak>";

  ws.send(
    "X-RequestId:" + requestId + "\r\n" +
    "Content-Type:application/ssml+xml\r\n" +
    "X-Timestamp:" + now + "Z\r\n" +
    "Path:ssml\r\n\r\n" + ssml
  );

  // Binary frames arrive as Blobs on Workers; unwrap them after the stream ends.
  const rawFrames = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 20000);
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        if (event.data.includes("Path:turn.end")) {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          resolve();
        }
        return;
      }
      const d = event.data;
      rawFrames.push(d instanceof ArrayBuffer ? Promise.resolve(d) : d.arrayBuffer());
    });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("ws error")); });
    ws.addEventListener("close", () => { clearTimeout(timer); resolve(); });
  });

  const chunks = [];
  for (const ab of await Promise.all(rawFrames)) {
    // each frame: 2-byte big-endian header length, header, then mp3 bytes
    const buf = new Uint8Array(ab);
    if (buf.length < 2) continue;
    const headerLen = (buf[0] << 8) | buf[1];
    const header = new TextDecoder().decode(buf.slice(2, 2 + headerLen));
    if (header.includes("Path:audio")) chunks.push(buf.slice(2 + headerLen));
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (!total) throw new Error("no audio");
  const audio = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { audio.set(c, offset); offset += c.length; }
  return audio;
}

// POST /see with an image body -> {"text": "..."} via Gemini (her free AI
// Studio key). Modern vision OCR: curved labels, glare, all three alphabets.
// With ?to=en|tr it returns {"items": [{o, t}, ...]} instead: each distinct
// text item paired with its translation, so lists and panels stay readable.
const SEE_LANGS = { en: "English", tr: "Turkish" };

async function handleSee(request, env, u) {
  if (!env.GEMINI_API_KEY) {
    return new Response("no eyes configured", { status: 503, headers: corsHeaders() });
  }
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length) return new Response("missing image", { status: 400, headers: corsHeaders() });
  if (buf.length > 4_000_000) return new Response("image too large", { status: 413, headers: corsHeaders() });
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  const mime = request.headers.get("Content-Type") || "image/jpeg";
  // "-latest" aliases track Google's newest models, so retirements (like
  // gemini-2.5-flash's) can't break the app; lite is the always-up fallback.
  const models = u.searchParams.get("gemodel")
    ? [u.searchParams.get("gemodel")]
    : ["gemini-flash-latest", "gemini-flash-lite-latest"];
  const target = SEE_LANGS[u.searchParams.get("to")];
  const prompt = target
    ? "This photo comes from a translator app. List every distinct text item you can read: " +
      "a label, a sign line, a button caption, a menu entry, a product name. Words that read " +
      "together as one phrase stay together as one item; never merge separate labels into one. " +
      "For each item return o = the exact original text as written, keeping its language and " +
      "alphabet, and t = its translation into " + target + ". If an item is already in " + target +
      ", set t to its Georgian translation instead. Skip unreadable fragments. If there is no " +
      "readable text, return an empty array."
    : "Read all text visible in this image, exactly as written, keeping the original language and alphabet (Georgian, Russian, English...). Preserve line breaks between separate items. Reply with ONLY the text you can read - no commentary, no translation, no formatting. If there is no readable text, reply with an empty message.";
  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mime, data: btoa(bin) } },
        { text: prompt },
      ],
    }],
    generationConfig: target
      ? {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { o: { type: "STRING" }, t: { type: "STRING" } },
              required: ["o", "t"],
            },
          },
        }
      : { temperature: 0 },
  };
  try {
    let gr = null;
    for (const model of models) {
      gr = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + env.GEMINI_API_KEY,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      if (gr.ok) break; // retired, overloaded, or throttled: try the next model
    }
    if (!gr.ok) {
      const errBody = await gr.text();
      return new Response("see failed: " + gr.status + " " + errBody.slice(0, 200), {
        status: gr.status === 429 ? 429 : 502,
        headers: corsHeaders(),
      });
    }
    const j = await gr.json();
    const text = (((j.candidates || [])[0] || {}).content?.parts || [])
      .map((p) => p.text || "")
      .join("")
      .trim();
    if (target) {
      let items = [];
      try {
        items = JSON.parse(text).filter(
          (p) => p && typeof p.o === "string" && p.o.trim() && typeof p.t === "string" && p.t.trim()
        );
      } catch {}
      return new Response(JSON.stringify({ items, via: "gemini" }), {
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ text, via: "gemini" }), {
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response("see failed: " + e.message, { status: 502, headers: corsHeaders() });
  }
}

// POST /listen?lang=ka with an audio body -> {"text": "..."} via Whisper on
// Workers AI (free allocation on this account; fails politely if exhausted).
async function handleListen(request, env, u) {
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length) return new Response("missing audio", { status: 400, headers: corsHeaders() });
  if (buf.length > 4_000_000) return new Response("audio too long", { status: 413, headers: corsHeaders() });
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  // Preferred: full-size Whisper on Groq (free tier) - the only free model that
  // writes Georgian in Georgian. Falls back to Workers AI if no key / any error.
  if (env.GROQ_API_KEY) {
    try {
      const ct = request.headers.get("Content-Type") || "audio/mp4";
      const ext = ct.includes("mpeg") ? "mp3" : ct.includes("ogg") ? "ogg" : ct.includes("webm") ? "webm" : ct.includes("wav") ? "wav" : "mp4";
      const fd = new FormData();
      fd.append("file", new Blob([buf], { type: ct }), "audio." + ext);
      // Default to the full model; the app can ask for turbo (~2x faster) via gmodel.
      fd.append("model", u.searchParams.get("gmodel") || "whisper-large-v3");
      fd.append("response_format", "verbose_json"); // also reports the detected language
      const glang = u.searchParams.get("lang");
      if (glang && glang !== "auto") fd.append("language", glang);
      const gr = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: "Bearer " + env.GROQ_API_KEY },
        body: fd,
      });
      if (gr.ok) {
        const j = await gr.json();
        return new Response(JSON.stringify({
          text: ((j && j.text) || "").trim(),
          language: (j && j.language) || "", // e.g. "english", "turkish", "georgian"
          via: "groq",
        }), {
          headers: { ...corsHeaders(), "Content-Type": "application/json" },
        });
      }
    } catch {}
    // fall through to Workers AI below
  }

  const model = u.searchParams.get("model") || "turbo";
  let payload;
  if (model === "classic") {
    // @cf/openai/whisper takes raw byte-array input, no language hint
    payload = { audio: [...buf] };
  } else {
    payload = { audio: btoa(bin) };
    const lang = u.searchParams.get("lang");
    if (lang && lang !== "auto") payload.language = lang;
    // task=translate makes Whisper output English directly, whatever was spoken
    if (u.searchParams.get("task") === "translate") payload.task = "translate";
  }
  try {
    const r = await env.AI.run(
      model === "classic" ? "@cf/openai/whisper" : "@cf/openai/whisper-large-v3-turbo",
      payload
    );
    return new Response(JSON.stringify({ text: ((r && r.text) || "").trim() }), {
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response("listen failed: " + e.message, { status: 502, headers: corsHeaders() });
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    const u = new URL(request.url);
    if (u.pathname === "/see" && request.method === "POST") {
      return handleSee(request, env, u);
    }
    if (u.pathname === "/listen" && request.method === "POST") {
      return handleListen(request, env, u);
    }
    const text = (u.searchParams.get("q") || "").trim().slice(0, 800);
    const voice = VOICES[u.searchParams.get("voice") || "eka"] || VOICES.eka;
    if (!text) {
      return new Response("missing q", { status: 400, headers: corsHeaders() });
    }

    // repeat phrases come from cache, instantly and without re-synthesis
    const cacheKey = new Request(u.origin + "/?v=" + voice + "&q=" + encodeURIComponent(text));
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("Access-Control-Allow-Origin", "*");
      return hit;
    }

    try {
      const audio = await synthesize(text, voice);
      const res = new Response(audio, {
        headers: {
          ...corsHeaders(),
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=2592000", // a month
        },
      });
      ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
      return res;
    } catch (e) {
      return new Response("voice unavailable: " + e.message, {
        status: 502,
        headers: corsHeaders(),
      });
    }
  },
};
