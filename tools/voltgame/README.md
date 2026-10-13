# VoltGame — PARALAKS: Tek Hat

This directory curates the current supplied `VoltGame/` R1 game, rules version 4.
The original folder is preserved. The canonical level data, electrical simulation,
rendering, input, audio and UI are retained; this is the complete game rather than
a replacement mini-game. It includes 27 campaign levels across four regions and
37 daily puzzles, progression, work orders, four score metrics, hints, undo/redo,
ghost playback, challenge codes, move journals, rule books and local save data.

`UPSTREAM-README.md` and `docs/PARALAKS2_SPEC.md` document the supplied game.
`provenance.json` records each curated source's original and integrated SHA-256.
Original hashes retain the supplied bytes; integrated sources use LF line endings
on both Windows and Linux. Per-file normalization is recorded separately from
the three optional host adapters. Git attributes also preserve release and
vendor hashes after checkout.
Prompt directories, legacy games, development output, test output and installed
dependencies are excluded. Existing game data remains in `paralaks2.kayit`;
the integration does not inspect or modify employee or business data.

## Rebuild from the website root

```powershell
npm ci --prefix tools/voltgame/tools --ignore-scripts --no-fund
node tools/build-voltgame.cjs
```

Node 24 or newer is required. Locked build dependency: Terser 5.51.2.
The builder runs the supplied full level verifier, checks the release's exact
27/37 counts, compiles the full worker, then publishes:

- `/public/voltgame/oyun.html`: complete hosted game, embedded locally in `/voltgame.html`.
- `/public/voltgame/solver-worker.js`: same-origin solver with the identical compiled simulation.
- `/public/voltgame/downloads/voltgame-cevrimdisi.html`: one complete offline HTML file.
- `/public/voltgame/release.json`: release identifiers, counts, output sizes and worker hash.
- `/public/voltgame/THIRD-PARTY-NOTICES.txt`: embedded Three.js MIT notice.

The output lives under `public/` to avoid the `VoltGame/` versus `voltgame/`
directory collision on Windows. Game source directories are not public routes.
The download needs no internet connection and keeps its embedded Three.js,
simulation, levels and original Blob worker. Hosted output uses a versioned
same-origin worker URL without loosening the site's worker policy. Both copies
receive the existing navy, amber and cyan palette and authentic VoltGuard logo;
only hosted output loads the site's local font files.
At game widths below 360 pixels, the seven controls use two rows so every button
remains visible and at least 44 pixels wide; this also fixes the offline copy.

## Integration changes

Three source modules use optional `PX.HOST` configuration. `solverClient.js`
selects the emitted worker when configured. `ghost.js` and `screens.js` share
challenge links to the public `/voltgame.html` page. Without `PX.HOST`, their
standalone behavior is retained. The root builder adds a same-origin parent
ready/hash bridge after the game bundle; it does not change gameplay or saves.
Inline `SIM2-BEGIN/END` markers and all existing test IDs are preserved.

The supplied test suite remains under `tools/test/`. Source checks include:

```powershell
node tools/voltgame/tools/test/unit/rules_physical.js
node tools/voltgame/tools/test/unit/rules_client.js
node tools/voltgame/tools/test/unit/rules_meta.js
node tools/voltgame/tools/test/unit/runtime_regressions.js
node tools/voltgame/tools/test/unit/rules_worksrc.js --file public/voltgame/downloads/voltgame-cevrimdisi.html
```

See the website's integration browser test for hosted CSP, iframe, sharing,
responsive layout and offline-download validation. The original test runner
opens file URLs in its own temporary Chrome profile and therefore does not
exercise HTTP response policies by itself.
