# Supplier packs

One Arabic PDF per production method, to send to printing houses and workshops before choosing who to work with.
Each pack states the files we send, every product made with that method (photo, drawing, size, margins, colours,
sizes: read from `src/products.js`), the questions the workshop should answer and the numbers to confirm.

- Built by `scripts/supplier-pack.js`; the text of each pack is `scripts/supplier-packs/<method>.js`.
- Rebuild after product changes: `NODE_PATH=$(npm root -g) node scripts/supplier-pack.js all` (needs Playwright).
- Owner's decisions (28 Nov 2026): Arabic; the Arabic ebda3 logo, but no "who we are" text and no description of
  the website; no price table (`--prices` brings it back); the general questions are only the first five.
- `test/supplier-packs.test.js` checks that each pack lists exactly the products of its method.
- DTG and DTF come with test prints (`*-test-*.png`) for the workshop to print.
