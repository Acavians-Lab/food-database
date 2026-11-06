# food-database
Public food/nutrition database for the Acavians Lab app — community-submitted entries reviewed before merging.

## Files

- `foods.json` — the live library. Everything here shows up in the app's search.
- `retired-foods.json` — foods taken out of the library. The app never lists or searches these; it only uses them to keep full details (serving units, fiber, brand, etc.) for foods people had already logged before the removal. To retire a food, move its entry from `foods.json` into this file rather than deleting it.
