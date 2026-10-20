# Reddee's Sales — website questions

A small page where Dad's team answers questions for the new Reddee's Sales website. Anyone with the link and access code can answer any question from their phone; answers are saved to a Google Sheet, and everyone sees what's already answered. Photos, videos and files uploaded on the page go into a folder in your Google Drive.

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
4. Pick **setupPhotoFolder** in the function menu at the top and click **Run**. Approve the Google permissions (Sheets and Drive). This creates the "Reddee's website photos" folder in your Drive. Then do the same for **setupVideoUploads**, which approves the "connect to an external service" permission that video uploads need.
5. **Deploy → New deployment** → type **Web app** → Execute as **Me**, Who has access **Anyone** → Deploy. Approve the permissions.
6. Copy the web app URL (ends in `/exec`) into `config.js` as `apiUrl`.
7. In the GitHub repo: **Settings → Pages** → Deploy from branch → `main` / root.

Answers land in an **Answers** tab in the sheet. Uploads go to **Reddee's website photos** in your Drive, one subfolder per item (Storefront, Team, Logo, ...), and each upload is also listed in a **Photos** tab with a link to the file. Large phone photos are resized to 3000 px on the long side before upload; other files (PDF, AI, CDR) are uploaded as they are. Videos, and any file over 20 MB, are sent in 8 MB pieces that Google Drive joins into one file (up to 2 GB each); if the connection drops, the page asks Drive how much arrived and carries on from there. Every save is a new row, so you keep the full history; the page shows the latest answer per question.

## Adding questions

Add an entry to a section in `questions.json`. Each question needs a unique `id` that never changes (answers are linked to it).

```json
{ "id": "warranty_terms", "text": "What warranty do we give on refurbished machines?", "hint": "Optional help text" }
```

Types:
- text (default): a free-text box
- `"type": "choice", "options": ["A", "B"]`: buttons plus an optional note
- `"type": "photo"`: an upload button, a "Sent on WhatsApp instead" tick and an optional note. Add `"folder": "Name"` for the Drive subfolder.
- `"type": "video"`: the same, but for videos.
- Any question can take uploads with `"upload": true` (plus optional `"folder"` and `"accept"`, e.g. `"image/*,.pdf"`).

## Changing the access code

Edit `ACCESS_CODE` in Apps Script, then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The same applies whenever `Code.gs` changes. The URL stays the same. Everyone will be asked for the new code.

## Preview

Run `python3 -m http.server` in this folder and open http://localhost:8000. Add `?demo=1` to the URL to test without touching the sheet.
