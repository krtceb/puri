# Puri · everyday Georgian

A private Georgian translator for two people, built for everyday life in Georgia.
Georgian in, English or Turkish out (you pick, switch any time). Photo, type, a phrasebook
that works offline, and pronunciation for everything.

## What v1 does

- **Pick your language** (English or Turkish) with the top toggle; switch any time and the
  result re-translates.
- **Type / paste** Georgian to get your language back (and the other way, into Georgian).
- **Photo** a sign or document. The text is read on the phone itself (Tesseract), then translated.
- **Pronunciation:** every Georgian phrase has a "Hear it" button plus a "sounds like" Latin
  line so you can learn to say it.
- **Phrasebook** of saved phrases, grouped by situation (Pharmacy, Grocery, Landlord, Taxi,
  Residency). Pre-loaded with starter phrases. Works with no signal once saved.

## Cost

v1 is free. Translation runs on MyMemory's free tier, text reading runs on the phone,
hosting is free. No API key, nothing to set up.

## Run it locally

```bash
cd ~/georgian-translator
python3 -m http.server 8731
# open http://localhost:8731
```

## Files

- `index.html` / `styles.css` / `app.js` : the whole app
- `manifest.webmanifest` / `sw.js` / `icon*.png` : installable-app shell
- engine: MyMemory (`app.js` → `translate()`), OCR: Tesseract.js (`runOCR`)

## Later (v2+)

- **Two-way Talk** (voice in, Georgian voice/text back).
- **Upgrade the engine to Claude** for sharper translations and context notes:
  swap the `translate()` function in `app.js` to call a small backend that holds an
  Anthropic API key. ~5 minute change. Small pay-as-you-go cost (a few dollars a month).
- **Offline translation** for the most common phrases.
