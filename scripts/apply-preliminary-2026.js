#!/usr/bin/env node
/**
 * apply-preliminary-2026.js — injects the self-reported Fall 2026 admissions
 * profile into the "Admissions Range" card of each school page that has one,
 * behind a toggle against the official 2025 ABA 509 numbers.
 *
 * build-school-pages.js can no longer round-trip the current page format, so this
 * patches the rendered HTML in place. It is idempotent: re-running restores the
 * official markup from the injected block first, then re-injects.
 *
 * Usage:
 *   node scripts/apply-preliminary-2026.js [--dry-run] [--only=SLUG,...]
 */
const fs = require('fs');
const path = require('path');
const { niceLsatDomain, niceGpaDomain, pctPos } = require('./generate-school-pages.js');

const ROOT = path.join(__dirname, '..');
const PRELIM_PATH = path.join(ROOT, 'data', 'preliminary_2026.json');
const DRY_RUN = process.argv.includes('--dry-run');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1].split(',') : null;

const START = '<!-- PRELIM-2026-START -->';
const CAP = '<!-- PRELIM-2026-CAP -->';
const END = '<!-- PRELIM-2026-END -->';

// Only the LSAT and GPA percentiles are preliminary. Class size, tuition and the
// application details below the toggle stay on 2025 data and must say so, since
// replacing the card-note with the toggle removed the card's only year label.
const INFO_NOTE = `      <div class="adm-info-note"><b>2025 figures.</b> 1L class size is from the school's ABA 509 report; tuition and application details reflect the current cycle. The toggle above does not change these; only the LSAT and GPA percentiles have preliminary Fall 2026 values.</div>`;

const CSS = `<style id="prelim-2026-css">
  .adm-toggle { display: inline-flex; gap: 2px; background: var(--bg-2); border: 1px solid var(--border-2); border-radius: 999px; padding: 3px; }
  .adm-tab { appearance: none; border: 0; background: transparent; cursor: pointer; font: inherit; font-size: .72rem; font-weight: 600; color: var(--subtle); padding: 5px 12px; border-radius: 999px; transition: background .15s ease, color .15s ease; }
  .adm-tab:hover { color: var(--ink); }
  .adm-tab[aria-selected="true"] { background: #fff; color: var(--em-700); box-shadow: 0 1px 3px rgba(15,23,42,.1); }
  .adm-tab:focus-visible { outline: 2px solid var(--em-600); outline-offset: 2px; }
  .adm-pane[hidden] { display: none; }
  .prelim-banner { display: flex; gap: 9px; align-items: flex-start; font-size: .76rem; line-height: 1.5; color: #7c4a06; background: rgba(180,83,9,.06); border: 1px solid rgba(180,83,9,.18); border-left: 3px solid rgba(180,83,9,.5); border-radius: 9px; padding: 10px 12px; margin-bottom: 20px; }
  .prelim-banner svg { flex: 0 0 auto; width: 15px; height: 15px; margin-top: 2px; color: #b45309; }
  .prelim-banner a { color: #b45309; font-weight: 600; }
  .adm-info-note { font-size: .7rem; line-height: 1.5; color: var(--subtle); margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-2); }
  .adm-info-note b { color: var(--ink); font-weight: 600; }
  .adm-info-note + .range-info-rows { margin-top: 10px; padding-top: 0; border-top: 0; }
  @media (max-width: 560px) {
    .adm-toggle { width: 100%; }
    .adm-tab { flex: 1; padding: 6px 8px; font-size: .68rem; }
  }
</style>
`;

const JS = `<script id="prelim-2026-js">
(function () {
  var tabs = document.querySelectorAll('.adm-tab');
  if (!tabs.length) return;
  function select(key) {
    tabs.forEach(function (t) {
      var on = t.dataset.adm === key;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('.adm-pane').forEach(function (p) {
      p.hidden = p.dataset.admPane !== key;
    });
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { select(t.dataset.adm); });
    t.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var list = Array.prototype.slice.call(tabs);
      var next = list[(list.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length];
      next.focus();
      select(next.dataset.adm);
    });
  });
})();
</script>
`;

const INFO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';

function rangeRows(p) {
  const [lsatLo, lsatHi] = niceLsatDomain(p.lsat25, p.lsat75);
  const [gpaLo, gpaHi] = niceGpaDomain(p.gpa25, p.gpa75);
  const lsatStart = pctPos(p.lsat25, lsatLo, lsatHi);
  const lsatWidth = pctPos(p.lsat75, lsatLo, lsatHi) - lsatStart;
  const lsatMark = pctPos(p.lsat50, lsatLo, lsatHi);
  const gpaStart = pctPos(p.gpa25, gpaLo, gpaHi);
  const gpaWidth = pctPos(p.gpa75, gpaLo, gpaHi) - gpaStart;
  const gpaMark = pctPos(p.gpa50, gpaLo, gpaHi);
  return `      <div class="range-row">
        <div class="range-top"><span class="range-name">LSAT</span><span class="range-vals">${p.lsat25} – <b>${p.lsat50}</b> – ${p.lsat75}</span></div>
        <div class="range-track">
          <div class="range-band" style="left:${lsatStart.toFixed(1)}%; width:${lsatWidth.toFixed(1)}%;"></div>
          <div class="range-marker" style="left:${lsatMark.toFixed(1)}%;"></div>
        </div>
        <div class="range-scale"><span>${lsatLo}</span><span>${lsatHi}</span></div>
      </div>
      <div class="range-row">
        <div class="range-top"><span class="range-name">Undergraduate GPA</span><span class="range-vals">${p.gpa25.toFixed(2)} – <b>${p.gpa50.toFixed(2)}</b> – ${p.gpa75.toFixed(2)}</span></div>
        <div class="range-track">
          <div class="range-band" style="left:${gpaStart.toFixed(1)}%; width:${gpaWidth.toFixed(1)}%;"></div>
          <div class="range-marker" style="left:${gpaMark.toFixed(1)}%;"></div>
        </div>
        <div class="range-scale"><span>${gpaLo.toFixed(1)}</span><span>${gpaHi.toFixed(1)}</span></div>
      </div>`;
}

// Undo a previous injection so the official markup is canonical again.
function restore(html) {
  const s = html.indexOf(START);
  if (s === -1) return html;
  const e = html.indexOf(END);
  if (e === -1) throw new Error('injection start marker without an end marker');
  const block = html.slice(s, e + END.length);
  const note = (block.match(/<!-- PRELIM-2026-NOTE:([\s\S]*?) -->/) || [])[1];
  // The CAP marker is the unique anchor for the end of the official pane; without
  // it the lazy capture would stop at the first range-row's closing </div>.
  const official = block.match(/<div class="adm-pane" data-adm-pane="official"[^>]*>\n([\s\S]*?)\n      <\/div>\n<!-- PRELIM-2026-CAP -->/);
  if (note == null || !official) throw new Error('cannot restore previous injection');
  return html.slice(0, s)
    + `<span class="card-note">${note}</span>\n    </div>\n    <div class="card-body">\n`
    + official[1]
    + html.slice(e + END.length);
}

// Keeps the official rows' own leading indentation in the capture, so that
// restore() can put the card body back byte-for-byte.
const CARD_RE = /(<div class="card" id="admissions">\s*<div class="card-head">\s*<h2>Admissions Range<\/h2>\s*)<span class="card-note">([^<]*)<\/span>(?:\s*<\/div>\s*<div class="card-body">\n)([\s\S]*?)(\n\s*<div class="range-info-rows">)/;

function inject(html, p) {
  const m = html.match(CARD_RE);
  if (!m) throw new Error('admissions card not in the expected shape');
  const [full, head, note, officialRows, infoRows] = m;

  const block = `${START}<!-- PRELIM-2026-NOTE:${note} -->
      <div class="adm-toggle" role="tablist" aria-label="Admissions data source">
        <button class="adm-tab" type="button" role="tab" data-adm="prelim" aria-selected="true" aria-controls="adm-prelim">Fall 2026 (self-reported)</button>
        <button class="adm-tab" type="button" role="tab" data-adm="official" aria-selected="false" aria-controls="adm-official" tabindex="-1">2025 (ABA 509)</button>
      </div>
    </div>
    <div class="card-body">
      <div class="adm-pane" data-adm-pane="prelim" id="adm-prelim" role="tabpanel">
        <div class="prelim-banner">
          ${INFO_ICON}
          <div><b>Preliminary — not ABA 509 data.</b> These Fall 2026 percentiles were reported by the school itself and have not been verified against an ABA 509 disclosure, which is not expected until next year. See <a href="/sources.html#preliminary-2026">Sources</a> for details, or switch to the 2025 tab for official figures.</div>
        </div>
${rangeRows(p)}
      </div>
      <div class="adm-pane" data-adm-pane="official" id="adm-official" role="tabpanel" hidden>
${officialRows}
      </div>
${CAP}
${INFO_NOTE}
${END}${infoRows}`;

  return html.replace(full, head + block);
}

// ── main ────────────────────────────────────────────────────────────────────

const prelim = JSON.parse(fs.readFileSync(PRELIM_PATH, 'utf8')).schools;
const slugs = Object.keys(prelim).filter(s => !ONLY || ONLY.includes(s));

let patched = 0;
const failed = [];

for (const slug of slugs) {
  const file = path.join(ROOT, 'schools', slug, 'index.html');
  if (!fs.existsSync(file)) { failed.push(`${slug}: no page`); continue; }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    // Pages come out of git with CRLF endings on Windows; the patterns below are
    // all written against LF, so normalise here and restore the file's own
    // convention on write rather than rewriting every line.
    const crlf = raw.includes('\r\n');
    const before = crlf ? raw.replace(/\r\n/g, '\n') : raw;
    let html = restore(before);
    html = inject(html, prelim[slug]);
    if (!html.includes('id="prelim-2026-css"')) {
      html = html.replace('</head>', CSS + '</head>');
    }
    if (!html.includes('id="prelim-2026-js"')) {
      html = html.replace('</body>', JS + '</body>');
    }
    // Re-running restore() on the result must reproduce the pre-injection page,
    // or the block is not safely reversible and we leave the file alone. The
    // stylesheet and script are added once and survive restore, so ignore them.
    const bare = h => h.replace(CSS, '').replace(JS, '');
    if (bare(restore(html)) !== bare(restore(before))) {
      throw new Error('injection is not reversible — refusing to write');
    }
    if (!DRY_RUN) fs.writeFileSync(file, crlf ? html.replace(/\n/g, '\r\n') : html, 'utf8');
    patched++;
  } catch (e) {
    failed.push(`${slug}: ${e.message}`);
  }
}

console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Patched ${patched}/${slugs.length} school pages.`);
if (failed.length) {
  console.log(`\nFAILED (${failed.length}) — left untouched:`);
  failed.forEach(f => console.log(' - ' + f));
  process.exitCode = 1;
}
