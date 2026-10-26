# Solar Fleet

A small web app for Harsha's solar systems: daily output against each system's expected day, tickets for faults, EB bills with owner approval, and daylight grid import.

- **Page:** plain HTML, CSS and JavaScript, served by GitHub Pages. No build step.
- **Data and logins:** Supabase (tables prefixed `solar_`). Every table is closed by row-level security to people listed in `solar_users`.
- **Meter readings:** the Solar master Google Sheet collects them. `apps-script/sync.gs` sends them to the app each night; `apps-script/eb.gs` works out daylight grid import first.
- **Nightly checks:** run inside the database at 02:00 IST and raise tickets. The office logger check runs hourly.

The publishable key in `config.js` is meant to be public. The sheet's sync key is not in this repository.

Libraries in `vendor/` are kept as files so the page doesn't depend on a CDN: supabase-js 2.45.4 (MIT) and d3 7.9.0 (ISC).
