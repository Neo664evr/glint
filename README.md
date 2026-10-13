# Glint

Every moment, alive. Photos, gleams (short videos), stories, and end-to-end encrypted messages, in a world that moves.

## How it runs

- **Site:** static files served by GitHub Pages (`index.html`, `backend.js`, `config.js`, `img/`, `icons/`).
- **Accounts, database, live updates:** Supabase. One table, `docs`, defined in `supabase/schema.sql`. Row-level security means only the owner of a document can change it, and private settings under `data/users/<id>/` can only be read by that person.
- **Messages:** encrypted in the browser before they are stored. The database only ever holds ciphertext.
- **Installable:** `manifest.webmanifest` and `sw.js` let people add Glint to their home screen.

## Setup

1. Create a Supabase project (free tier works).
2. In Supabase: **SQL Editor**, paste `supabase/schema.sql`, run it.
3. In Supabase: **Authentication > URL Configuration**, set **Site URL** to your domain and add it to **Redirect URLs**.
4. Copy **Project URL** and **anon public key** from **Project Settings > API** into `config.js`.
5. Push. GitHub Pages serves the site.

## Custom domain

Add a `CNAME` file containing the domain, and point the domain's DNS at GitHub Pages (`<user>.github.io` as a CNAME record for `www`, or GitHub's A records for the bare domain).

## Credits

Background sculptures are photographs from The Metropolitan Museum of Art Open Access (public domain, CC0), re-lit and composited for Glint.
