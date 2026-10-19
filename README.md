# Reddee's Sales — website questions

A small page where Dad's team answers questions for the new Reddee's Sales website. Anyone with the link and access code can answer any question from their phone; answers are saved to a Google Sheet, and everyone sees what's already answered.

## Files

| File | What it is |
| --- | --- |
| `questions.json` | The questions. Edit this to add, change or remove questions. |
| `config.js` | The Google Apps Script URL. Empty = demo mode (answers stay in the browser). |
| `apps-script/Code.gs` | The script that saves answers to the Google Sheet. |
| `index.html`, `style.css`, `app.js` | The page itself. |

## One-time setup

1. Create a new Google Sheet (e.g. "Reddee's website answers").
2. In the sheet: **Extensions → Apps Script**. Delete what's there and paste in `apps-script/Code.gs`.
3. Change `ACCESS_CODE` at the top to the code you'll share with the team. Save.
4. **Deploy → New deployment** → type **Web app** → Execute as **Me**, Who has access **Anyone** → Deploy. Approve the permissions.
5. Copy the web app URL (ends in `/exec`) into `config.js` as `apiUrl`.
6. In the GitHub repo: **Settings → Pages** → Deploy from branch → `main` / root.

Answers land in an **Answers** tab in the sheet. Every save is a new row, so you keep the full history; the page shows the latest answer per question.

## Adding questions

Add an entry to a section in `questions.json`. Each question needs a unique `id` that never changes (answers are linked to it).

```json
{ "id": "warranty_terms", "text": "What warranty do we give on refurbished machines?", "hint": "Optional help text" }
```

Types:
- text (default): a free-text box
- `"type": "choice", "options": ["A", "B"]`: buttons plus an optional note
- `"type": "photo"`: a "Photos sent" tick plus an optional note

## Changing the access code

Edit `ACCESS_CODE` in Apps Script, then **Deploy → Manage deployments → Edit → New version**. The URL stays the same. Everyone will be asked for the new code.

## Preview

Run `python3 -m http.server` in this folder and open http://localhost:8000. Add `?demo=1` to the URL to test without touching the sheet.
