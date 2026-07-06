/* Puri: a private Georgian translator for Ebru and Master.
   v1: free MyMemory engine, on-device OCR (Tesseract), local phrasebook.
   You pick one language (English or Turkish) and can switch any time.
   Georgian is read aloud, with a "sounds like" Latin line for pronunciation. */

// Raises the free MyMemory daily limit. Stored in pieces so email-harvesting
// bots scanning public code don't recognize it; joins to the real address at runtime.
const OWNER_EMAIL = ["aysan", ".", "eb35"].join("") + "@" + ["gmail", "com"].join(".");
const FOLDERS = ["General", "Small Talk", "Numbers", "Grocery", "Restaurant", "Taxi", "Directions", "Pharmacy", "Bank & SIM", "Services", "Landlord", "Residency", "Emergency"];
const STORE_KEY = "khidi.phrasebook.v1";
const LANG_KEY = "khidi.lang.v1";
const SEED_KEY = "khidi.seed.version";
const SEED_VERSION = 3;

const GEORGIAN = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let myLang = localStorage.getItem(LANG_KEY) || "en"; // "en" | "tr"
let lastResult = null; // { ka, out, lang }

const EAR_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8.5a6 6 0 1 1 12 0c0 4-4 5-5 7.5A3 3 0 0 1 7 16"/><path d="M9.6 9.2a2.4 2.4 0 0 1 4.8 0c0 1.5-1.4 2.1-2.1 2.9"/></svg>';

// ---- Georgian -> Latin "sounds like" ----
const TRANSLIT = {
  "ა":"a","ბ":"b","გ":"g","დ":"d","ე":"e","ვ":"v","ზ":"z","თ":"t","ი":"i",
  "კ":"k","ლ":"l","მ":"m","ნ":"n","ო":"o","პ":"p","ჟ":"zh","რ":"r","ს":"s",
  "ტ":"t","უ":"u","ფ":"p","ქ":"k","ღ":"gh","ყ":"q","შ":"sh","ჩ":"ch","ც":"ts",
  "ძ":"dz","წ":"ts","ჭ":"ch","ხ":"kh","ჯ":"j","ჰ":"h",
};
function translit(text) {
  if (!text) return "";
  let out = "";
  for (const ch of text) out += TRANSLIT[ch] != null ? TRANSLIT[ch] : ch;
  return out;
}

// ---- translation engines ----
// Primary: Google's free endpoint (no key, excellent Georgian).
// Backup: MyMemory (free, but its Georgian entries are sometimes polluted).
async function googleTranslate(text, from, to) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=" + from +
    "&tl=" + to + "&dt=t&q=" + encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error("network");
  const data = await res.json();
  const out = ((data && data[0]) || [])
    .map((seg) => (seg && seg[0]) || "")
    .join("")
    .trim();
  if (!out) throw new Error("empty");
  return out;
}

async function mymemoryTranslate(text, pair) {
  const url =
    "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) +
    "&langpair=" + pair + "&de=" + encodeURIComponent(OWNER_EMAIL);
  const res = await fetch(url);
  if (!res.ok) throw new Error("network");
  const data = await res.json();
  const out = data && data.responseData && data.responseData.translatedText;
  if (!out) throw new Error("empty");
  if (/MYMEMORY WARNING/i.test(out)) throw new Error("limit");
  return out;
}

async function translate(text, pair) {
  const [from, to] = pair.split("|");
  try {
    return await googleTranslate(text, from, to);
  } catch (e) {
    // Google unreachable: fall back to MyMemory rather than failing outright.
    return mymemoryTranslate(text, pair);
  }
}

// ---- status ----
function showStatus(msg, kind) {
  const s = $("status");
  s.hidden = false;
  s.className = "status" + (kind === "error" ? " is-error" : "");
  s.innerHTML = "";
  if (kind !== "error") s.appendChild(el("span", "spinner"));
  s.appendChild(el("span", null, msg));
}
function hideStatus() { $("status").hidden = true; }

// ---- result rendering (one language) ----
const LANG_LABEL = { en: "English", tr: "Türkçe" };
function renderResult(ka, out, lang) {
  $("empty").hidden = true;
  $("result").hidden = false;
  $("source-text").textContent = ka;
  $("translit").textContent = ka ? "sounds like:  " + translit(ka) : "";
  $("out-text").textContent = out;
  $("out-tag").textContent = LANG_LABEL[lang];
  const card = $("out-card");
  card.classList.toggle("out--en", lang === "en");
  card.classList.toggle("out--tr", lang === "tr");
  const save = $("btn-save");
  save.classList.remove("is-saved");
  save.lastChild.textContent = " Save to phrasebook";
  lastResult = { ka, out, lang };
}

// ---- main translate flow ----
async function runTranslate() {
  const text = $("input").value.trim();
  if (!text) { showStatus("Type something or snap a photo first.", "error"); return; }

  try {
    if (GEORGIAN.test(text)) {
      showStatus("Reading Georgian…");
      const out = await translate(text, "ka|" + myLang);
      hideStatus();
      renderResult(text, out, myLang);
    } else {
      showStatus("Translating to Georgian…");
      const ka = await translate(text, myLang + "|ka");
      hideStatus();
      renderResult(ka, text, myLang);
    }
  } catch (e) {
    const map = {
      limit: "We hit today's free translation limit. It resets tomorrow.",
      network: "No connection. Check your signal and try again.",
      empty: "Could not translate that. Try fewer words.",
    };
    showStatus(map[e.message] || "Something went wrong. Try again.", "error");
  }
}

// re-translate the current result when the language is switched
async function refreshLang() {
  if (!lastResult) return;
  try {
    showStatus("Switching language…");
    const out = await translate(lastResult.ka, "ka|" + myLang);
    hideStatus();
    renderResult(lastResult.ka, out, myLang);
  } catch { hideStatus(); }
}

// ---- camera / OCR ----
async function runOCR(file) {
  showStatus("Reading the photo… this part runs on your phone.");
  try {
    const worker = await Tesseract.createWorker("kat");
    const { data } = await worker.recognize(file);
    await worker.terminate();
    const text = (data.text || "").trim().replace(/\s+\n/g, "\n");
    if (!text) { showStatus("Could not find readable text. Try a closer, steadier photo.", "error"); return; }
    $("input").value = text;
    $("btn-clear").hidden = false;
    await runTranslate();
  } catch (e) {
    showStatus("Could not read that photo. Try again with more light.", "error");
  }
}

// ---- speech ----
function hasVoice(prefix) {
  try { return speechSynthesis.getVoices().some((v) => v.lang.toLowerCase().startsWith(prefix)); }
  catch { return false; }
}
function speakSynth(text, lang) {
  if (!("speechSynthesis" in window) || !text) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang; u.rate = 0.9;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
  return true;
}
// Google's free voice handles English and Turkish well.
function ttsUrl(text, lang) {
  const t = text.slice(0, 200);
  return "https://translate.google.com/translate_tts?ie=UTF-8&q=" +
    encodeURIComponent(t) + "&tl=" + lang + "&total=1&idx=0&textlen=" + t.length + "&client=tw-ob";
}
function speakLatin(text, lang) { // lang: "en" | "tr"
  if (!text) return;
  const a = new Audio(ttsUrl(text, lang));
  a.play().catch(() => speakSynth(text, lang === "tr" ? "tr-TR" : "en-US"));
}
// Georgian: use a real device voice if present. The free service has no Georgian,
// so rather than read it in the wrong language, we point to the "sounds like" line.
function speakGeorgian(text) {
  if (!text) return;
  if (hasVoice("ka")) { speakSynth(text, "ka-GE"); return; }
  toast("No Georgian voice on this phone yet. Use the 'sounds like' line to say it.");
}
function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add("is-on"));
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove("is-on"), 3600);
}

// ---- phrasebook store ----
function loadBook() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function saveBook(items) { localStorage.setItem(STORE_KEY, JSON.stringify(items)); }

function addPhrase(folder) {
  if (!lastResult) return;
  const items = loadBook();
  items.unshift({
    id: Date.now().toString(36),
    ka: lastResult.ka,
    en: lastResult.lang === "en" ? lastResult.out : "",
    tr: lastResult.lang === "tr" ? lastResult.out : "",
    folder, ts: Date.now(),
  });
  saveBook(items);
}

let activeFolder = "General";
function renderFolders() {
  const nav = $("folders");
  nav.innerHTML = "";
  ["All", ...FOLDERS].forEach((f) => {
    const b = el("button", "folder-chip" + (f === activeFolder ? " is-on" : ""), f);
    b.type = "button";
    b.onclick = () => { activeFolder = f; renderFolders(); renderBook(); };
    nav.appendChild(b);
  });
}

let bookQuery = "";
function renderBook() {
  const wrap = $("book");
  wrap.innerHTML = "";
  let items = loadBook();
  const q = bookQuery;
  if (q) {
    // a search looks everywhere, ignoring the folder chips
    items = items.filter((i) =>
      (i.ka && i.ka.toLowerCase().includes(q)) ||
      (i.en && i.en.toLowerCase().includes(q)) ||
      (i.tr && i.tr.toLowerCase().includes(q)) ||
      translit(i.ka).toLowerCase().includes(q)
    );
  } else if (activeFolder !== "All") {
    items = items.filter((i) => i.folder === activeFolder);
  }
  if (!items.length) {
    wrap.appendChild(el("p", "book-empty", q
      ? "Nothing matches that search."
      : "No saved phrases here yet. Translate something and tap Save."));
    return;
  }
  items.forEach((i) => wrap.appendChild(phraseCard(i)));
}

function phraseCard(i) {
  const card = el("div", "phrase");
  const ka = el("p", "phrase__ka phrase__ka--tap", i.ka);
  ka.title = "Tap to show big";
  ka.onclick = () => openShow(i.ka, myLang === "tr" ? (i.tr || i.en) : (i.en || i.tr), myLang);
  card.appendChild(ka);
  card.appendChild(el("p", "phrase__translit", translit(i.ka)));

  const val = myLang === "tr" ? (i.tr || i.en) : (i.en || i.tr);
  if (val) {
    const row = el("div", "phrase__row phrase__row--" + myLang);
    row.appendChild(el("span", "phrase__lang", myLang.toUpperCase()));
    row.appendChild(el("span", "phrase__val", val));
    card.appendChild(row);
  }

  const foot = el("div", "phrase__foot");
  const say = el("button", "speak");
  say.type = "button";
  say.setAttribute("aria-label", "Hear it in Georgian");
  say.innerHTML = EAR_SVG;
  say.onclick = () => speakGeorgian(i.ka);
  const del = el("button", "phrase__btn phrase__btn--del", "Remove");
  del.type = "button";
  del.onclick = () => { saveBook(loadBook().filter((x) => x.id !== i.id)); renderBook(); };
  foot.appendChild(say);
  foot.appendChild(del);
  card.appendChild(foot);
  return card;
}

// ---- save sheet ----
function openSaveSheet() {
  if (!lastResult) return;
  const grid = $("save-folders");
  grid.innerHTML = "";
  FOLDERS.forEach((f) => {
    const b = el("button", "folder-chip", f);
    b.type = "button";
    b.onclick = () => {
      addPhrase(f);
      $("save-sheet").hidden = true;
      const save = $("btn-save");
      save.classList.add("is-saved");
      save.lastChild.textContent = " Saved to " + f;
    };
    grid.appendChild(b);
  });
  $("save-sheet").hidden = false;
}

// ---- language toggle ----
function syncLang() {
  document.querySelectorAll(".seg__btn").forEach((b) =>
    b.classList.toggle("is-on", b.dataset.lang === myLang)
  );
}

// ---- fullscreen "show them" mode ----
let showKa = "";
function openShow(ka, src, lang) {
  if (!ka) return;
  showKa = ka;
  $("show-ka").textContent = ka;
  $("show-translit").textContent = translit(ka);
  $("show-src").textContent = src ? LANG_LABEL[lang] + ": " + src : "";
  const s = $("show");
  s.classList.remove("show--xl", "show--lg", "show--md");
  const n = ka.length;
  s.classList.add(n <= 16 ? "show--xl" : n <= 46 ? "show--lg" : "show--md");
  s.hidden = false;
}
function closeShow() { $("show").hidden = true; }

// ---- talk mode (free, built into the browser) ----
// iOS quirk: Safari's speech engine often never fires its "ended" event after
// stop(), so everything funnels through finishRec(), which also runs from a
// watchdog timer. Whichever path fires first wins; the rest become no-ops.
let rec = null;
let recActive = false;
let recDone = true;
let heardText = "";
function syncMic() {
  $("mic").classList.toggle("is-live", recActive);
  $("mic").setAttribute("aria-label", recActive ? "Stop listening" : "Start listening");
}
function talkSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
async function finishRec() {
  if (recDone) return;
  recDone = true;
  recActive = false;
  syncMic();
  try { rec && rec.abort(); } catch {}
  const text = heardText.trim();
  if (!text) { $("talk-status").textContent = "Didn't catch that. Tap the mic and try again."; return; }
  $("talk-status").textContent = "Translating…";
  try {
    const ka = await translate(text, myLang + "|ka");
    $("talk-status").textContent = "";
    renderResult(ka, text, myLang); // also lands in Translate, so it can be saved
    openShow(ka, text, myLang);
  } catch {
    $("talk-status").textContent = "Couldn't translate. Check your signal and try again.";
  }
}
function startRec() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  rec = new SR();
  rec.lang = myLang === "tr" ? "tr-TR" : "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  heardText = "";
  recDone = false;
  rec.onresult = (e) => {
    let full = "";
    for (const r of e.results) full += r[0].transcript;
    if (full) heardText = full; // keep interim text too; iOS may never mark it final
    $("talk-heard").textContent = heardText;
    $("talk-last").hidden = !heardText;
  };
  rec.onend = finishRec;
  rec.onspeechend = () => setTimeout(finishRec, 700); // iOS: engine noticed silence
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      recDone = true;
      recActive = false;
      syncMic();
      $("talk-status").textContent = "Puri needs microphone permission. Allow it in Settings > Apps > Safari.";
      return;
    }
    finishRec(); // e.g. "no-speech": finalize with whatever we heard
  };
  recActive = true;
  syncMic();
  $("talk-status").textContent = "Listening… tap again when you finish.";
  $("talk-heard").textContent = "";
  $("talk-last").hidden = true;
  rec.start();
}
function stopRec() {
  try { rec && rec.stop(); } catch {}
  setTimeout(finishRec, 900); // watchdog: iOS often skips the ended event
}

// ---- views ----
function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
  $("view-" + name).classList.add("is-active");
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("is-active", t.dataset.view === name)
  );
  if (name === "book") { renderFolders(); renderBook(); }
  window.scrollTo(0, 0);
}

// ---- wire up ----
function init() {
  syncLang();
  document.querySelectorAll(".seg__btn").forEach((b) => {
    b.onclick = () => {
      myLang = b.dataset.lang;
      localStorage.setItem(LANG_KEY, myLang);
      syncLang();
      refreshLang();
    };
  });

  $("btn-go").onclick = runTranslate;
  $("input").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runTranslate();
  });
  $("input").addEventListener("input", () => {
    $("btn-clear").hidden = $("input").value.trim() === "";
  });
  $("btn-clear").onclick = () => {
    $("input").value = "";
    $("btn-clear").hidden = true;
    $("result").hidden = true;
    $("empty").hidden = false;
    hideStatus();
  };

  $("btn-photo").onclick = () => $("file").click();
  $("file").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) runOCR(f);
    e.target.value = "";
  });

  $("speak-ka").onclick = () => speakGeorgian($("source-text").textContent);
  $("speak-out").onclick = () => speakLatin($("out-text").textContent, myLang);

  // fullscreen show mode
  $("show-big").onclick = () => lastResult && openShow(lastResult.ka, lastResult.out, lastResult.lang);
  $("show-close").onclick = closeShow;
  $("show-speak").innerHTML = EAR_SVG;
  $("show-speak").onclick = () => speakGeorgian(showKa);

  // phrasebook search
  $("search").addEventListener("input", () => {
    bookQuery = $("search").value.trim().toLowerCase();
    renderBook();
  });

  // talk mode
  if (talkSupported()) {
    $("mic").onclick = () => (recActive ? stopRec() : startRec());
  } else {
    $("mic").disabled = true;
    $("talk-hint").textContent = "This browser can't listen here. Use the Translate tab and type instead.";
  }

  $("btn-save").onclick = openSaveSheet;
  $("save-cancel").onclick = () => ($("save-sheet").hidden = true);
  $("save-sheet").addEventListener("click", (e) => {
    if (e.target.id === "save-sheet") $("save-sheet").hidden = true;
  });

  document.querySelectorAll(".tab[data-view]").forEach((t) => {
    t.onclick = () => switchView(t.dataset.view);
  });

  // prime voice list (some browsers load it lazily)
  if ("speechSynthesis" in window) speechSynthesis.getVoices();

  ensureSeeds();
}

// ---- starter phrases for real life in Georgia ----
const SEED = [
  // General
  ["გამარჯობა", "Hello", "Merhaba", "General"],
  ["ნახვამდის", "Goodbye", "Hoşça kalın", "General"],
  ["დილა მშვიდობისა", "Good morning", "Günaydın", "General"],
  ["საღამო მშვიდობისა", "Good evening", "İyi akşamlar", "General"],
  ["გმადლობთ", "Thank you", "Teşekkür ederim", "General"],
  ["დიდი მადლობა", "Thank you very much", "Çok teşekkürler", "General"],
  ["არაფრის", "You're welcome", "Rica ederim", "General"],
  ["კი", "Yes", "Evet", "General"],
  ["არა", "No", "Hayır", "General"],
  ["ბოდიში", "Excuse me", "Affedersiniz", "General"],
  ["უკაცრავად", "Sorry", "Pardon", "General"],
  ["თუ შეიძლება", "Please", "Lütfen", "General"],
  ["კარგი", "Okay", "Tamam", "General"],
  ["არ მესმის", "I don't understand", "Anlamıyorum", "General"],
  ["გაიმეორეთ, თუ შეიძლება", "Please repeat that", "Tekrar eder misiniz", "General"],
  ["ნელა ილაპარაკეთ, თუ შეიძლება", "Please speak slowly", "Yavaş konuşur musunuz", "General"],
  ["ინგლისურად ლაპარაკობთ?", "Do you speak English?", "İngilizce biliyor musunuz?", "General"],
  ["ვერ ვლაპარაკობ ქართულად", "I can't speak Georgian", "Gürcüce konuşamıyorum", "General"],
  ["როგორ ხართ?", "How are you?", "Nasılsınız?", "General"],
  ["რა გქვიათ?", "What is your name?", "Adınız ne?", "General"],
  // Grocery
  ["რა ღირს?", "How much is it?", "Ne kadar?", "Grocery"],
  ["ეს რა ღირს?", "How much is this?", "Bu ne kadar?", "Grocery"],
  ["ძალიან ძვირია", "It's too expensive", "Çok pahalı", "Grocery"],
  ["ფასდაკლება გაქვთ?", "Is there a discount?", "İndirim var mı?", "Grocery"],
  ["ერთი კილო, თუ შეიძლება", "One kilo, please", "Bir kilo, lütfen", "Grocery"],
  ["ნახევარი კილო", "Half a kilo", "Yarım kilo", "Grocery"],
  ["ეს მინდა", "I want this one", "Bunu istiyorum", "Grocery"],
  ["ბარათით შეიძლება?", "Can I pay by card?", "Kartla olur mu?", "Grocery"],
  ["პარკი მჭირდება", "I need a bag", "Poşet lazım", "Grocery"],
  ["სად არის სალარო?", "Where is the checkout?", "Kasa nerede?", "Grocery"],
  // Restaurant
  ["მენიუ, თუ შეიძლება", "The menu, please", "Menü, lütfen", "Restaurant"],
  ["წყალი, თუ შეიძლება", "Water, please", "Su, lütfen", "Restaurant"],
  ["ერთი ყავა", "One coffee", "Bir kahve", "Restaurant"],
  ["ანგარიში, თუ შეიძლება", "The bill, please", "Hesap, lütfen", "Restaurant"],
  ["ძალიან გემრიელია", "It's delicious", "Çok lezzetli", "Restaurant"],
  ["ვეგეტარიანელი ვარ", "I'm vegetarian", "Vejetaryenim", "Restaurant"],
  ["ხორცის გარეშე", "Without meat", "Etsiz", "Restaurant"],
  ["ცხარე არ მინდა", "Not spicy, please", "Acısız olsun", "Restaurant"],
  // Pharmacy
  ["აფთიაქი სად არის?", "Where is the pharmacy?", "Eczane nerede?", "Pharmacy"],
  ["თავი მტკივა", "I have a headache", "Başım ağrıyor", "Pharmacy"],
  ["მუცელი მტკივა", "I have a stomachache", "Karnım ağrıyor", "Pharmacy"],
  ["ცხელება მაქვს", "I have a fever", "Ateşim var", "Pharmacy"],
  ["ტკივილგამაყუჩებელი მჭირდება", "I need a painkiller", "Ağrı kesici lazım", "Pharmacy"],
  ["ექიმი მჭირდება", "I need a doctor", "Doktora ihtiyacım var", "Pharmacy"],
  ["ალერგია მაქვს", "I have an allergy", "Alerjim var", "Pharmacy"],
  // Directions
  ["სად არის...?", "Where is...?", "... nerede?", "Directions"],
  ["მარცხნივ", "Left", "Sol", "Directions"],
  ["მარჯვნივ", "Right", "Sağ", "Directions"],
  ["პირდაპირ", "Straight ahead", "Düz", "Directions"],
  ["ახლოს არის?", "Is it near?", "Yakın mı?", "Directions"],
  ["შორს არის?", "Is it far?", "Uzak mı?", "Directions"],
  ["დაკარგული ვარ", "I'm lost", "Kayboldum", "Directions"],
  ["რუკაზე მაჩვენეთ", "Show me on the map", "Haritada gösterin", "Directions"],
  // Taxi
  ["აქ წამიყვანეთ", "Take me here", "Beni buraya götürün", "Taxi"],
  ["ამ მისამართზე", "To this address", "Bu adrese", "Taxi"],
  ["მგზავრობა რა ღირს?", "How much is the ride?", "Yolculuk ne kadar?", "Taxi"],
  ["აქ გავჩერდეთ", "Stop here", "Burada duralım", "Taxi"],
  ["მრიცხველი ჩართეთ, თუ შეიძლება", "Turn on the meter, please", "Taksimetreyi açın, lütfen", "Taxi"],
  // Landlord
  ["ქირა", "Rent", "Kira", "Landlord"],
  ["წყალი არ მოდის", "There's no water", "Su gelmiyor", "Landlord"],
  ["შუქი არ არის", "There's no electricity", "Elektrik yok", "Landlord"],
  ["გათბობა არ მუშაობს", "The heating isn't working", "Isıtma çalışmıyor", "Landlord"],
  ["ინტერნეტი არ მუშაობს", "The internet isn't working", "İnternet çalışmıyor", "Landlord"],
  ["გასაღები", "Key", "Anahtar", "Landlord"],
  ["შემიკეთეთ, თუ შეიძლება", "Please fix it", "Tamir eder misiniz", "Landlord"],
  // Residency
  ["ბინადრობის ნებართვა", "Residence permit", "Oturma izni", "Residency"],
  ["პასპორტი", "Passport", "Pasaport", "Residency"],
  ["დოკუმენტები", "Documents", "Belgeler", "Residency"],
  ["სად მოვაწერო ხელი?", "Where do I sign?", "Nereyi imzalayayım?", "Residency"],
  ["დახმარება მჭირდება", "I need help", "Yardıma ihtiyacım var", "Residency"],
  // Emergency
  ["დახმარება!", "Help!", "İmdat!", "Emergency"],
  ["პოლიცია", "Police", "Polis", "Emergency"],
  ["სასწრაფო", "Ambulance", "Ambulans", "Emergency"],
  ["ხანძარია!", "Fire!", "Yangın!", "Emergency"],
  ["ექიმი გამოიძახეთ", "Call a doctor", "Doktor çağırın", "Emergency"],
  ["ეს საგანგებოა", "This is an emergency", "Bu acil durum", "Emergency"],
  // Small Talk
  ["სასიამოვნოა თქვენი გაცნობა", "Nice to meet you", "Tanıştığımıza memnun oldum", "Small Talk"],
  ["თურქეთიდან ვარ", "I'm from Turkey", "Türkiye'denim", "Small Talk"],
  ["თბილისში ვცხოვრობ", "I live in Tbilisi", "Tiflis'te yaşıyorum", "Small Talk"],
  ["აქ ახლოს ვცხოვრობ", "I live nearby", "Yakında oturuyorum", "Small Talk"],
  ["ქართულს ვსწავლობ", "I'm learning Georgian", "Gürcüce öğreniyorum", "Small Talk"],
  ["ცოტა ქართული ვიცი", "I know a little Georgian", "Biraz Gürcüce biliyorum", "Small Talk"],
  ["საქართველო ძალიან მომწონს", "I really like Georgia", "Gürcistan'ı çok seviyorum", "Small Talk"],
  ["ძალიან ლამაზია", "It's very beautiful", "Çok güzel", "Small Talk"],
  ["კარგი ამინდია დღეს", "The weather is nice today", "Bugün hava güzel", "Small Talk"],
  ["ძალიან ცივა", "It's very cold", "Çok soğuk", "Small Talk"],
  ["ძალიან ცხელა", "It's very hot", "Çok sıcak", "Small Talk"],
  ["კარგ დღეს გისურვებთ", "Have a nice day", "İyi günler dilerim", "Small Talk"],
  ["კარგ შაბათ-კვირას", "Have a nice weekend", "İyi hafta sonları", "Small Talk"],
  ["ხვალამდე", "See you tomorrow", "Yarın görüşürüz", "Small Talk"],
  ["გილოცავთ", "Congratulations", "Tebrikler", "Small Talk"],
  ["მადლობა დახმარებისთვის", "Thank you for the help", "Yardım için teşekkürler", "Small Talk"],
  // Numbers
  ["ერთი", "One", "Bir", "Numbers"],
  ["ორი", "Two", "İki", "Numbers"],
  ["სამი", "Three", "Üç", "Numbers"],
  ["ოთხი", "Four", "Dört", "Numbers"],
  ["ხუთი", "Five", "Beş", "Numbers"],
  ["ექვსი", "Six", "Altı", "Numbers"],
  ["შვიდი", "Seven", "Yedi", "Numbers"],
  ["რვა", "Eight", "Sekiz", "Numbers"],
  ["ცხრა", "Nine", "Dokuz", "Numbers"],
  ["ათი", "Ten", "On", "Numbers"],
  ["ოცი", "Twenty", "Yirmi", "Numbers"],
  ["ორმოცდაათი", "Fifty", "Elli", "Numbers"],
  ["ასი", "One hundred", "Yüz", "Numbers"],
  ["ათასი", "One thousand", "Bin", "Numbers"],
  ["ნახევარი", "Half", "Yarım", "Numbers"],
  ["ერთი ლარი", "One lari", "Bir lari", "Numbers"],
  ["ხურდა გაქვთ?", "Do you have change?", "Bozuk paranız var mı?", "Numbers"],
  ["ნაღდი ფულით გადავიხდი", "I'll pay in cash", "Nakit ödeyeceğim", "Numbers"],
  ["ბარათით გადავიხდი", "I'll pay by card", "Kartla ödeyeceğim", "Numbers"],
  ["უფრო იაფი გაქვთ?", "Do you have anything cheaper?", "Daha ucuzu var mı?", "Numbers"],
  ["დღეს", "Today", "Bugün", "Numbers"],
  ["ხვალ", "Tomorrow", "Yarın", "Numbers"],
  ["გუშინ", "Yesterday", "Dün", "Numbers"],
  ["ახლა", "Now", "Şimdi", "Numbers"],
  ["მოგვიანებით", "Later", "Sonra", "Numbers"],
  ["ორშაბათი", "Monday", "Pazartesi", "Numbers"],
  ["სამშაბათი", "Tuesday", "Salı", "Numbers"],
  ["ოთხშაბათი", "Wednesday", "Çarşamba", "Numbers"],
  ["ხუთშაბათი", "Thursday", "Perşembe", "Numbers"],
  ["პარასკევი", "Friday", "Cuma", "Numbers"],
  ["შაბათი", "Saturday", "Cumartesi", "Numbers"],
  ["კვირა", "Sunday", "Pazar", "Numbers"],
  ["რომელი საათია?", "What time is it?", "Saat kaç?", "Numbers"],
  ["რომელ საათზე იხსნება?", "What time does it open?", "Saat kaçta açılıyor?", "Numbers"],
  ["რომელ საათზე იკეტება?", "What time does it close?", "Saat kaçta kapanıyor?", "Numbers"],
  // Bank & SIM
  ["ანგარიშის გახსნა მინდა", "I want to open an account", "Hesap açmak istiyorum", "Bank & SIM"],
  ["ბანკომატი სად არის?", "Where is the ATM?", "ATM nerede?", "Bank & SIM"],
  ["ბარათი არ მუშაობს", "The card isn't working", "Kart çalışmıyor", "Bank & SIM"],
  ["ფულის გადარიცხვა მინდა", "I want to transfer money", "Para göndermek istiyorum", "Bank & SIM"],
  ["ვალუტის გადაცვლა მინდა", "I want to exchange currency", "Döviz bozdurmak istiyorum", "Bank & SIM"],
  ["კურსი რა არის?", "What is the exchange rate?", "Kur ne kadar?", "Bank & SIM"],
  ["სიმ ბარათი მინდა", "I want a SIM card", "SIM kart istiyorum", "Bank & SIM"],
  ["ბალანსის შევსება მინდა", "I want to top up my balance", "Kontör yüklemek istiyorum", "Bank & SIM"],
  ["ინტერნეტ პაკეტი მინდა", "I want an internet package", "İnternet paketi istiyorum", "Bank & SIM"],
  ["თარჯიმანი მჭირდება", "I need a translator", "Tercümana ihtiyacım var", "Bank & SIM"],
  ["ეს ფორმა როგორ შევავსო?", "How do I fill in this form?", "Bu formu nasıl doldururum?", "Bank & SIM"],
  ["ვის მივმართო?", "Who should I ask?", "Kime başvurmalıyım?", "Bank & SIM"],
  // Services
  ["თმის შეჭრა მინდა", "I want a haircut", "Saç kestirmek istiyorum", "Services"],
  ["თმის შეღებვა მინდა", "I want my hair colored", "Saç boyatmak istiyorum", "Services"],
  ["ძალიან მოკლედ ნუ შემჭრით", "Don't cut it too short", "Çok kısa kesmeyin", "Services"],
  ["მანიკური მინდა", "I want a manicure", "Manikür istiyorum", "Services"],
  ["პედიკური მინდა", "I want a pedicure", "Pedikür istiyorum", "Services"],
  ["ჩაწერა შეიძლება ხვალისთვის?", "Can I book for tomorrow?", "Yarın için randevu alabilir miyim?", "Services"],
  ["აბონემენტი რა ღირს?", "How much is a membership?", "Abonelik ne kadar?", "Services"],
  ["შეკვეთა მაქვს", "I have an order", "Siparişim var", "Services"],
  ["კართან დატოვეთ, თუ შეიძლება", "Leave it at the door, please", "Kapıya bırakın, lütfen", "Services"],
  ["ქიმწმენდა სად არის?", "Where is the dry cleaner?", "Kuru temizleme nerede?", "Services"],
  // Restaurant (more)
  ["ერთი ჩაი, თუ შეიძლება", "One tea, please", "Bir çay, lütfen", "Restaurant"],
  ["ერთი ლუდი", "One beer", "Bir bira", "Restaurant"],
  ["ჭიქა ღვინო", "A glass of wine", "Bir kadeh şarap", "Restaurant"],
  ["ხაჭაპური", "Khachapuri", "Haçapuri", "Restaurant"],
  ["ხინკალი", "Khinkali", "Hinkali", "Restaurant"],
  ["პური", "Bread", "Ekmek", "Restaurant"],
  ["ყველი", "Cheese", "Peynir", "Restaurant"],
  ["გემრიელად მიირთვით", "Bon appétit", "Afiyet olsun", "Restaurant"],
  ["ცალ-ცალკე გადავიხდით", "We'll pay separately", "Ayrı ayrı ödeyeceğiz", "Restaurant"],
  ["ეს არ შემიკვეთავს", "I didn't order this", "Bunu sipariş etmedim", "Restaurant"],
  ["წასაღებად, თუ შეიძლება", "To go, please", "Paket olsun, lütfen", "Restaurant"],
  // Taxi (more)
  ["აქ მოუხვიეთ", "Turn here", "Buradan dönün", "Taxi"],
  ["მარცხნივ მოუხვიეთ", "Turn left", "Sola dönün", "Taxi"],
  ["მარჯვნივ მოუხვიეთ", "Turn right", "Sağa dönün", "Taxi"],
  ["ცოტა ნელა, თუ შეიძლება", "A bit slower, please", "Biraz yavaş, lütfen", "Taxi"],
  ["აეროპორტში, თუ შეიძლება", "To the airport, please", "Havalimanına, lütfen", "Taxi"],
  ["აქ კარგია", "Here is fine", "Burası iyi", "Taxi"],
  // Grocery (more)
  ["რძე", "Milk", "Süt", "Grocery"],
  ["კვერცხი", "Eggs", "Yumurta", "Grocery"],
  ["ხილი", "Fruit", "Meyve", "Grocery"],
  ["ბოსტნეული", "Vegetables", "Sebze", "Grocery"],
  ["ახალია?", "Is it fresh?", "Taze mi?", "Grocery"],
  ["გასინჯვა შეიძლება?", "Can I taste it?", "Tadabilir miyim?", "Grocery"],
];

// Add new starter phrases once per seed version, without touching saved or deleted ones.
function ensureSeeds() {
  const v = parseInt(localStorage.getItem(SEED_KEY) || "0", 10);
  if (v >= SEED_VERSION) return;
  const have = new Set(loadBook().map((x) => x.ka));
  const additions = SEED
    .filter((s) => !have.has(s[0]))
    .map((s, n) => ({
      id: "seed-" + SEED_VERSION + "-" + n,
      ka: s[0], en: s[1], tr: s[2], folder: s[3], ts: Date.now() - (SEED.length - n),
    }));
  if (additions.length) saveBook([...loadBook(), ...additions]);
  localStorage.setItem(SEED_KEY, String(SEED_VERSION));
}

document.addEventListener("DOMContentLoaded", init);

// Offline shell.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
