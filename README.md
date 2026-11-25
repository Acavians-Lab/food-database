# food-database
Public food/nutrition database for the Acavians Lab app — community-submitted entries reviewed before merging.

## Files

- `foods.json` — the live library. Everything here shows up in the app's search.
- `retired-foods.json` — foods taken out of the library. The app never lists or searches these; it only uses them to keep full details (serving units, fiber, brand, etc.) for foods people had already logged before the removal. To retire a food, move its entry from `foods.json` into this file rather than deleting it.
- `photos/` — product photos for foods in `foods.json`, one `<food id>.jpg` each. A food's `photoUrl` points at its file here (never an embedded `data:` image — those made `foods.json` many megabytes and slowed the app on older phones).
- `exercises.json` — the shared exercise library every phone syncs from (about every 6 hours). Each exercise has a permanent `id` — never change or reuse one. Edit `nameEn` / `nameEs` (one is enough), `youtube`, muscles and type freely; renames show up everywhere, past workouts included. To take one out of everyone's search, set `"retired": true` instead of deleting it (people already using it keep it). The admin's Public toggle in the app adds and edits entries here too.
