#!/usr/bin/env node
/**
 * build-preliminary-2026.js — converts the Spivey Consulting 2026 vs. 2025 tracker
 * CSV into data/preliminary_2026.json, keyed by Atlas Legis school slug.
 *
 * Only schools that report ALL SIX percentiles (LSAT 25/50/75 and GPA 25/50/75)
 * for 2026 are included. These are self-reported figures, not ABA 509 data.
 *
 * Usage:
 *   node scripts/build-preliminary-2026.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'raw', 'spivey-2026-tracker.csv');
const SCHOOLS_PATH = path.join(ROOT, 'data', 'law-schools.json');
const OUT_PATH = path.join(ROOT, 'data', 'preliminary_2026.json');
const DRY_RUN = process.argv.includes('--dry-run');

// Column indices in the tracker's header row (row index 1 of the file).
const COL = {
  name: 0,
  lsat25: 1, lsat50: 2, lsat75: 3,
  gpa25: 11, gpa50: 12, gpa75: 13,
};

// ── CSV parsing ─────────────────────────────────────────────────────────────

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ── name matching ───────────────────────────────────────────────────────────

// Spivey names schools by parent university; Atlas Legis names them by law school.
// Anything the token matcher cannot resolve on its own is pinned here.
const ALIASES = {
  'University of California-Los Angeles': 'ucla-school-of-law',
  'University of California-Berkeley': 'uc-berkeley-school-of-law',
  'University of California-Irvine': 'uc-irvine-school-of-law',
  'University of California-Davis': 'uc-davis-school-of-law',
  'University of California-San Francisco': 'uc-college-of-the-law-san-francisco',
  'Yeshiva University (Cardozo)': 'cardozo-school-of-law',
  'Brigham Young University': 'byu-j-reuben-clark-law-school',
  'University of St. Thomas (Minnesota)': 'university-of-st-thomas-school-of-law',
  'Loyola Marymount University-Los Angeles': 'loyola-law-school-los-angeles',
  'University of Nevada-Las Vegas': 'unlv-william-s-boyd-school-of-law',
  'University of the Pacific': 'university-of-the-pacific-mcgeorge-school-of-law',
  'William & Mary': 'william-mary-law-school',
  'Texas A&M University': 'texas-a-m-university-school-of-law',
  'Boston University': 'boston-university-school-of-law',
  'Boston College': 'boston-college-law-school',
  'University of Florida': 'university-of-florida-levin-college-of-law',
  'American University': 'american-university-washington-college-of-law',
  'University of Southern California': 'usc-gould-school-of-law',
  // These three shared a token majority with the wrong school and matched it
  // outright — NYU and CUNY both landed on New York Law School, SMU on
  // Southern University Law Center. Pin them before they report and overwrite.
  'New York University': 'nyu-school-of-law',
  'City University of New York': 'cuny-school-of-law',
  'Southern Methodist University': 'smu-dedman-school-of-law',
  // The rest tie against a same-state sibling and fall through unmatched.
  'University of Pennsylvania': 'penn-carey-law',
  'Indiana University-Bloomington': 'indiana-university-maurer-school-of-law',
  'Indiana University-Indianapolis': 'indiana-university-mckinney-school-of-law',
  'University of Arizona': 'university-of-arizona-james-e-rogers-college-of-law',
  'Louisiana State University': 'lsu-paul-m-hebert-law-center',
  'University of Mississippi': 'university-of-mississippi-school-of-law',
  'Mississippi College': 'mississippi-college-school-of-law',
  'University of Arkansas-Little Rock': 'ua-little-rock-bowen-school-of-law',
  'St. Thomas University (Florida)': 'st-thomas-university-school-of-law',
};

const STOPWORDS = new Set([
  'university', 'school', 'law', 'college', 'of', 'the', 'at', 'and',
  'center', 'institute',
]);

function tokens(name) {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(t => t && !STOPWORDS.has(t));
}

function score(csvName, school) {
  const a = new Set(tokens(csvName));
  const b = new Set(tokens(school.name));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  // Jaccard-ish, biased toward covering the CSV name's tokens: the law school's
  // own name usually carries extra donor/benefactor tokens the tracker omits.
  return shared / a.size + shared / b.size / 2;
}

function matchSchool(csvName, schools) {
  const alias = ALIASES[csvName];
  if (alias) {
    const hit = schools.find(s => s.slug === alias);
    if (!hit) throw new Error(`alias slug not found in law-schools.json: ${alias}`);
    return { school: hit, how: 'alias' };
  }
  const ranked = schools
    .map(s => ({ s, score: score(csvName, s) }))
    .sort((x, y) => y.score - x.score);
  const best = ranked[0], next = ranked[1];
  // Require a full token cover of the CSV name and a clear gap to the runner-up.
  if (best.score >= 1.0 && best.score - next.score >= 0.15) {
    return { school: best.s, how: 'tokens' };
  }
  return { school: null, best: best, next: next };
}

// ── main ────────────────────────────────────────────────────────────────────

const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8')).slice(2);
const schools = JSON.parse(fs.readFileSync(SCHOOLS_PATH, 'utf8'));

const out = {};
const skippedIncomplete = [];
const unmatched = [];
let seen = 0;

for (const r of rows) {
  const name = (r[COL.name] || '').trim();
  if (!name) continue;
  seen++;

  const raw = {
    lsat25: (r[COL.lsat25] || '').trim(),
    lsat50: (r[COL.lsat50] || '').trim(),
    lsat75: (r[COL.lsat75] || '').trim(),
    gpa25: (r[COL.gpa25] || '').trim(),
    gpa50: (r[COL.gpa50] || '').trim(),
    gpa75: (r[COL.gpa75] || '').trim(),
  };

  // Gate: every one of the six percentiles must be present.
  if (Object.values(raw).some(v => v === '')) {
    if (Object.values(raw).some(v => v !== '')) skippedIncomplete.push(name);
    continue;
  }

  const { school, best } = matchSchool(name, schools);
  if (!school) {
    unmatched.push(`${name} (closest: ${best.s.name}, score ${best.score.toFixed(2)})`);
    continue;
  }

  // Two tracker rows resolving to one slug means a bad match, not a real
  // duplicate — fail loudly rather than let the later row overwrite the earlier.
  if (out[school.slug]) {
    throw new Error(
      `slug collision on ${school.slug}: "${out[school.slug].trackerName}" and "${name}" ` +
      `both matched ${school.name}. Add an ALIASES entry for the wrong one.`
    );
  }

  out[school.slug] = {
    name: school.name,
    trackerName: name,
    lsat25: Number(raw.lsat25),
    lsat50: Number(raw.lsat50),
    lsat75: Number(raw.lsat75),
    gpa25: Number(raw.gpa25),
    gpa50: Number(raw.gpa50),
    gpa75: Number(raw.gpa75),
  };
}

const payload = {
  label: 'Fall 2026 (self-reported)',
  official: false,
  source: 'Spivey Consulting Group, 2026 vs. 2025 Law School Medians and Class Size Tracker',
  disclaimer: 'Self-reported by the schools and not yet verified against ABA 509 disclosures.',
  generated: new Date().toISOString().slice(0, 10),
  schools: out,
};

const sorted = {};
Object.keys(out).sort().forEach(k => { sorted[k] = out[k]; });
payload.schools = sorted;

if (!DRY_RUN) {
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Read ${seen} tracker rows.`);
console.log(`Included ${Object.keys(sorted).length} schools with all six 2026 percentiles.`);
console.log(`Skipped ${skippedIncomplete.length} with partial 2026 data.`);
if (unmatched.length) {
  console.log(`\nUNMATCHED (${unmatched.length}) — needs an ALIASES entry:`);
  unmatched.forEach(u => console.log(' - ' + u));
}
