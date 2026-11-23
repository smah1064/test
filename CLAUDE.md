# Working on this project

## How to work

- **Parallel helpers:** split big requests into parallel helper agents wherever the pieces don't overlap (separate files, separate products or areas, tests, QA sweeps). Keep changes to the shared big files (`src/app.js`, `public/js/editor.js`) in the main session so helpers never edit the same file at once. Review and test everything the helpers produce before deploying.
- Small fixes and steps that depend on each other are done directly, without helpers.
