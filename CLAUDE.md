# Working on this project

## How to work

- **Parallel helpers:** split big requests into parallel helper agents wherever the pieces don't overlap (separate files, separate products or areas, tests, QA sweeps). Keep changes to the shared big files (`src/app.js`, `public/js/editor.js`) in the main session so helpers never edit the same file at once. Review and test everything the helpers produce before deploying.
- Small fixes and steps that depend on each other are done directly, without helpers.

## Owner decisions to keep in mind

- **Payment at launch: prepayment only, no cash on delivery.** Cash on delivery is what the shop shows today (during the private preview), but when the site opens to visitors the only payment method will be paying in advance. When reviewing or building code, treat cash on delivery as temporary: don't build new features that depend on it (e.g. a gift sent to someone else can be sender-paid), don't treat failed cash-on-delivery as a lasting cost, and point out code, texts or emails that promise cash on delivery when the switch is made.
