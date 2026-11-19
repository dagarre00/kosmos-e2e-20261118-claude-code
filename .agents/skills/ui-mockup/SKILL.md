---
name: ui-mockup
description: Build a plain HTML and CSS mockup of a screen, show it to the human in whatever harness is running, and write the approved UI contract. Use for new or changed UI, on "mockup", "UI contract", "screen design".
---
# ui-mockup

Runs inside `sync-wiki`, after the feature page and before any component page, so sign-off can still change the spec.

1. Read the feature page. It must declare the screen's `US-`/`FR-` headings with every user-visible text (`status: draft` is fine); otherwise finish that part of `sync-wiki` first.
2. Write `wiki/contracts/ui/mockups/<name>.html`, `<name>` in lowercase-kebab: one file, plain HTML and CSS, no JavaScript, no framework, no external assets, so it renders the same in every browser, IDE webview and preview pane.
3. Show each state as a labelled section: default, empty and error always; loading only when an action waits on I/O or a timer (a synchronous screen has none: omit it, never add a "not applicable" section). Use the exact user-visible text from the feature page. Every sample value (a result, a count, a computed number) comes from the implemented function or, with no code yet, from the feature page's formula worked on one stated input; never invent one.
4. Accessibility is not optional: semantic elements, a label for every input, visible focus, text contrast of at least 4.5:1, computed for each text and background pair (not estimated), no meaning carried by color alone.
5. Show it to the human, first option that works:
   1. The harness has its own viewer that renders a local HTML file for the human (an in-app browser or preview pane, an IDE webview, a canvas or artifact page) → open the file there. A viewer that uploads the file (a hosted artifact page, private by default) only if the human agreed to the mockup leaving the machine.
   2. The human sits at this machine → `node scripts/preview.mjs <name>` opens it in their default browser.
   3. Remote, container or cloud session → `node scripts/preview.mjs <name> --serve` in the background; give the printed loopback URL to forward. Stop it after sign-off.
   4. Nothing renders → give the file path.

   A viewer that fails (a blocked screenshot, no opener) is noted and the next option tried; it never blocks the step. Always print the path and the state names too. Then stop: UI sign-off is a pause. On change requests edit the file and show it again (a reload is enough; `--serve` rereads the file) until the human approves.
6. Write `wiki/contracts/ui/<name>.md` from `wiki/contracts/ui/_template.md`: `mockup: mockups/<name>.html`, `approved-by: <human> <yyyy-mm-dd>` (who signed off, and when), the `Seen:` line (how the human saw it, or `unrendered, approved on source`), the computed contrast ratios, and every element, state, message and validation rule in tables. Link `[[contracts/ui/<name>]]` from `wiki/contracts/00-contracts.md` (create it as `sync-wiki` says if missing). Do not link the mockup; `mockups/` is not part of the verified wiki.
7. Run `node scripts/verify-wiki.mjs` until `WIKI_OK`. The page locks with the rest in `sync-wiki` step 9; run standalone, set `status: locked` and commit `docs(T-XXX): lock <name> UI contract`.
