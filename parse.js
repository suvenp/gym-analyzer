const fs = require('fs');
const path = require('path');

const NOTES_DIR = path.join(__dirname, 'notes');
const OUTPUT_FILE = path.join(__dirname, 'workout_data.json');

// ── Helpers ──

function inferYearFromFilename(filename) {
  // Match a 4-digit year that looks like 20XX, not embedded in longer numbers
  const m = filename.match(/(20\d{2})/);
  return m ? parseInt(m[1]) : null;
}

function inferWorkoutType(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('pull')) return 'Pull';
  if (lower.includes('push')) return 'Push';
  if (lower.includes('leg')) return 'Legs';
  if (lower.includes('heavy')) return 'Heavy';
  return 'General';
}

function inferYearRange(filename) {
  const year = inferYearFromFilename(filename);
  if (!year) return { start: 2025, end: 2025 };
  const lower = filename.toLowerCase();
  // Some files span across year boundaries
  if (lower.includes('q1') && year === 2025) {
    // 2025 q1 push starts at 12/30 (2024)
    return { start: year - 1, end: year };
  }
  if (lower.includes('spring') && !lower.includes('heavy')) {
    return { start: year, end: year };
  }
  if (lower.includes('oct') || lower.includes('newcycle')) {
    return { start: year, end: year + 1 };
  }
  return { start: year, end: year };
}

const DATE_PATTERNS = [
  // 10-14-2025 or 10/14/2025
  { re: /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s*$/, parse: (m) => ({ month: parseInt(m[1]), day: parseInt(m[2]), year: parseInt(m[3]) }) },
  // 2:16 style (month:day) — treat colon as separator
  { re: /^(\d{1,2}):(\d{1,2})\s*$/, parse: (m) => ({ month: parseInt(m[1]), day: parseInt(m[2]), year: null }) },
  // 6-4 / 8/3 / 10-11 / 1/3
  { re: /^(\d{1,2})[\/\-](\d{1,2})\s*$/, parse: (m) => ({ month: parseInt(m[1]), day: parseInt(m[2]), year: null }) },
  // "26 July" or "Aug 10"
  { re: /^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\s*$/i, parse: (m) => ({ day: parseInt(m[1]), month: monthNum(m[2]), year: null }) },
  { re: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\s+(\d{1,2})\s*$/i, parse: (m) => ({ month: monthNum(m[1]), day: parseInt(m[2]), year: null }) },
  // "Oct 7" at start of file or "Sept 1" / "Sept 20"
  { re: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\s+(\d{1,2})\s*$/i, parse: (m) => ({ month: monthNum(m[1]), day: parseInt(m[2]), year: null }) },
  // "Oct 31" with no year
  { re: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\s+(\d{1,2})\s*$/i, parse: (m) => ({ month: monthNum(m[1]), day: parseInt(m[2]), year: null }) },
];

function monthNum(s) {
  const map = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  return map[s.toLowerCase().substring(0, 4).replace(/t$/, '')] || map[s.toLowerCase().substring(0, 3)] || null;
}

function tryParseDate(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  for (const pat of DATE_PATTERNS) {
    const m = trimmed.match(pat.re);
    if (m) return pat.parse(m);
  }
  return null;
}

function isDivider(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Lines of =, -, —, or mixes thereof (at least 1 char, only those chars)
  return /^[=\-—–]+$/.test(trimmed);
}

function isRestLine(line) {
  const lower = line.trim().toLowerCase();
  return /^\d+\.?\d*\s*min/i.test(lower) ||
    /min\s*(rest|strict|mostly|maybe|between|and|except|but|or|ish|for|max|fixed)/i.test(lower) ||
    /^1\s*(to|and|or)\s/i.test(lower) ||
    /^\d+\s*min\b/i.test(lower) ||
    /min\s*$/.test(lower) ||
    /^between\s+\d/i.test(lower) ||
    /^about\s+\d.*min/i.test(lower) ||
    /^no\s+timer/i.test(lower) ||
    /^\d+\.?\d*\s*(to|and)\s+\d+\.?\d*\s*min/i.test(lower);
}

function isCardioWarmup(line) {
  const lower = line.trim().toLowerCase();
  if (/^(run|jog|skip|skipping|mobility|stretch|warmup|warm up|warm-up|quick warmup|warmup and|warmup light|warmup stretch|warmup quick|warmup full|warmup good|warmup great|good warm|nice warmup|come back kid|warmup run|hangs|scap pulls|light because|air squat|after savannah|after new york|seattle|role)\b/i.test(lower)) return true;
  if (/^(run|jog)\s+\d+/i.test(lower)) return true;
  if (/^\d+\s+(run|jog)/i.test(lower)) return true;
  if (/^mobility\b/i.test(lower)) return true;
  if (/^warmup\s*(and\s+)?(rollout|light|stretch|rows|full|quick|good|great|run)/i.test(lower)) return true;
  if (lower === 'warmup' || lower === 'warm up') return true;
  return false;
}

function isNoteLine(line) {
  const lower = line.trim().toLowerCase();
  // Lines that are purely instructional / notes (no weight or rep data)
  if (/^(go |stay |same |keep |try |focus |increase |next |need |can |check |good |great |form |was |do |did |start |end |all |maybe |should |suggest |watch |pain |more |better |very |slight|skipped|missed|wasn|hit |had |extra|slowly|not |intense|heavier|higher|lower|still |tough|little|strict|use |make|let|slow|add |get |before|grip |movement|stable|separate|when |overall|for |max |took |correction|got the|this was|i think|i'm|healing|elbow|could have|stop|skip)/i.test(lower)) return true;
  // Emoji-only lines
  if (/^[\s💪🏽🔥👍🏽🦿🦾🙌🏽🥜😊😤\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}:\(\)]+$/u.test(lower)) return true;
  if (lower === 'finisher' || lower === 'finisher !!' || lower === 'school') return true;
  return false;
}

function isMetaLine(line) {
  const lower = line.trim().toLowerCase();
  // Lines like "no time", "was not in it", emoji lines, location notes
  if (/^(no time|:\(|sa$|hu be|chasepw@|q$|i'm$|n$|in$|w$)/i.test(lower)) return true;
  if (/^[💪🏽🔥👍🏽🦿🦾🙌🏽🥜]+$/u.test(lower.replace(/\s/g, ''))) return true;
  if (lower.length <= 2 && !/\d/.test(lower)) return true;
  return false;
}

function kgToLbs(kg) {
  return Math.round(kg * 2.205 * 10) / 10;
}

// Parse a weight token, return { weight_lbs, is_warmup, is_kg }
function parseWeight(token) {
  if (!token && token !== 0) return null;
  const s = String(token).trim().toLowerCase();

  if (s === 'bar' || s === 'air' || s === 'warmup' || s === 'warming' || s === 'no weight' || s === '0') {
    return { weight_lbs: 0, is_warmup: true };
  }
  if (s.includes('rdl bar')) {
    return { weight_lbs: 0, is_warmup: true };
  }

  // Handle "Xkg"
  const kgMatch = s.match(/^(\d+\.?\d*)\s*kg$/);
  if (kgMatch) {
    return { weight_lbs: kgToLbs(parseFloat(kgMatch[1])), is_warmup: false };
  }

  const num = parseFloat(s);
  if (!isNaN(num)) {
    return { weight_lbs: num, is_warmup: false };
  }
  return null;
}

// ── Set Line Parsing ──

// Parse rating from parenthetical like (3.5) or (9) or (10)
function extractRating(text) {
  // Match last parenthetical that looks like a number
  const matches = [...text.matchAll(/\((\d+\.?\d*)\)/g)];
  if (matches.length === 0) return { rating: null, cleaned: text };
  const last = matches[matches.length - 1];
  const rating = parseFloat(last[1]);
  // Only treat as rating if it's in plausible range
  if (rating >= 1 && rating <= 10) {
    const cleaned = text.substring(0, last.index) + text.substring(last.index + last[0].length);
    return { rating, cleaned };
  }
  return { rating: null, cleaned: text };
}

// Extract inline notes (text after the set data)
function extractNotes(text) {
  // After removing rating, check for trailing text that isn't weight/rep data
  const cleaned = text.replace(/\([\d.]+\)/g, '').trim();
  // Look for text after the numeric data
  const m = cleaned.match(/(?:\d+\s*x\s*\d+|\d+)\s+(.+)$/i);
  if (m) {
    const note = m[1].trim();
    // Filter out stuff that's actually data
    if (!/^\d+$/.test(note) && !/^x\s*\d+/.test(note) && note.length > 2) {
      return note;
    }
  }
  return null;
}

function normalizeRating(raw, era) {
  if (raw === null) return null;
  if (era === 'rpe') {
    // Pre-2023 RPE 1-5 -> RIR-like: (raw/5)*3 + 7
    return Math.round(((raw / 5) * 3 + 7) * 10) / 10;
  }
  // Already RIR scale
  return raw;
}

// Determine rating era from date
function ratingEra(dateStr) {
  if (!dateStr) return 'rir';
  const year = parseInt(dateStr.substring(0, 4));
  return year < 2023 ? 'rpe' : 'rir';
}

// ── Superset Parsing ──

function isSupersetHeader(line) {
  // Exercise names separated by /
  const trimmed = line.trim();
  if (!trimmed.includes('/')) return false;
  // Must not be purely numeric (set lines also use /)
  const parts = trimmed.split('/').map(p => p.trim());
  // If all parts are numeric-ish, it's a set line not a header
  const allNumeric = parts.every(p => /^[\d.\sx()kglbs,same@set]+$/i.test(p) || !p);
  return !allNumeric && parts.length >= 2;
}

// ── Main Parser ──

function parseSetLine(line, prevWeight, prevReps, exerciseNames, supersetId) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Check for superset set line (contains /)
  const isSupersetSet = supersetId && trimmed.includes('/');

  if (isSupersetSet) {
    return parseSupersetSetLine(trimmed, prevWeight, prevReps, exerciseNames, supersetId);
  }

  return parseSingleSet(trimmed, prevWeight, prevReps);
}

function parseSupersetSetLine(line, prevWeights, prevReps, exerciseNames, supersetId) {
  const parts = line.split('/').map(p => p.trim());
  const sets = [];

  for (let i = 0; i < parts.length && i < exerciseNames.length; i++) {
    const part = parts[i];
    if (!part) {
      sets.push(null);
      continue;
    }
    const pw = prevWeights[i] !== undefined ? prevWeights[i] : null;
    const pr = prevReps[i] !== undefined ? prevReps[i] : null;
    const parsed = parseSingleSet(part, pw, pr);
    sets.push(parsed);
  }

  return sets;
}

function parseSingleSet(text, prevWeight, prevReps) {
  let trimmed = text.trim();
  if (!trimmed) return null;

  // Handle "Same" / "SaMe"
  if (/^sam[e]?\s*$/i.test(trimmed)) {
    if (prevWeight !== null && prevReps !== null) {
      return { weight: prevWeight, reps: prevReps, rating: null, is_warmup: prevWeight === 0, notes: null };
    }
    return null;
  }

  // Handle "Set" (repeat previous)
  if (/^set\s*$/i.test(trimmed)) {
    if (prevWeight !== null && prevReps !== null) {
      return { weight: prevWeight, reps: prevReps, rating: null, is_warmup: false, notes: null };
    }
    return null;
  }

  // Handle "Warmup" as a set indicator
  if (/^warmup\s*\d*$/i.test(trimmed)) {
    const wm = trimmed.match(/warmup\s+(\d+)/i);
    const w = wm ? parseFloat(wm[1]) : 0;
    return { weight: w, reps: prevReps || 12, rating: null, is_warmup: true, notes: null };
  }

  // Extract rating
  const { rating, cleaned } = extractRating(trimmed);
  trimmed = cleaned.trim();

  // Extract trailing notes (non-numeric text after data)
  let notes = null;
  // Remove common trailing text
  const notePatterns = [
    /\b(form\s+was\s+\w+|good\s+form|momentum|strict|tense|could have|focus|check\s+form|control|great\s+form|from\s+not\s+great|pulley\s+sticky|form\s+good|from\s+was\s+good|mostly|pause\s+at\s+\d+|pause\s+on\s+\d+|not\s+strict|form\s+can\s+be|some\s+momentum|kept\s+form|neg\s+\d+|cheat\s+\d+|little\s+pain)\b.*/i,
    /\b(extra\s+\d+|one\s+extra).*$/i,
  ];
  for (const np of notePatterns) {
    const nm = trimmed.match(np);
    if (nm) {
      notes = nm[0].trim();
      trimmed = trimmed.substring(0, nm.index).trim();
    }
  }

  // Remove emoji and trailing junk
  trimmed = trimmed.replace(/[💪🏽🔥👍🏽🦿🦾🙌🏽🥜😊\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
  // Remove trailing punctuation/junk
  trimmed = trimmed.replace(/[!?.s]+$/, '').trim();

  // "W x R" pattern
  let m = trimmed.match(/^(\d+\.?\d*)\s*x\s*(\d+\.?\d*)/i);
  if (m) {
    let weight = parseFloat(m[1]);
    let reps = parseInt(m[2]);
    return { weight, reps, rating, is_warmup: weight === 0, notes };
  }

  // "R x W" — less common, detect by context (reps first if weight > reps significantly)
  // Actually in this data, format is consistently "weight x reps"

  // Handle plate notation: "2p x 12", "4.5p x 10"
  m = trimmed.match(/^(\d+\.?\d*)\s*p\s*(?:each\s+side\s+)?x?\s*(\d+)/i);
  if (m) {
    // Store plate count as-is (we'll need exercise context to convert)
    let plates = parseFloat(m[1]);
    let reps = parseInt(m[2]);
    // Approximate: 1 plate ≈ 45lbs each side
    return { weight: plates * 45, reps, rating, is_warmup: false, notes, is_plates: true, plate_count: plates };
  }

  // "Xp" alone (no reps)
  m = trimmed.match(/^(\d+\.?\d*)\s*p\s*(each\s+side)?$/i);
  if (m) {
    let plates = parseFloat(m[1]);
    return { weight: plates * 45, reps: prevReps || 10, rating, is_warmup: false, notes, is_plates: true, plate_count: plates };
  }

  // Handle kg: "24kg x 12" or "36kg x 10"
  m = trimmed.match(/^(\d+\.?\d*)\s*kg\s*x\s*(\d+)/i);
  if (m) {
    return { weight: kgToLbs(parseFloat(m[1])), reps: parseInt(m[2]), rating, is_warmup: false, notes };
  }

  // "Xkg" alone
  m = trimmed.match(/^(\d+\.?\d*)\s*kg$/i);
  if (m) {
    return { weight: kgToLbs(parseFloat(m[1])), reps: prevReps || 10, rating, is_warmup: false, notes };
  }

  // Handle "X each side x R"
  m = trimmed.match(/^(\d+\.?\d*)\s*each\s*side\s*x\s*(\d+)/i);
  if (m) {
    return { weight: parseFloat(m[1]) * 2, reps: parseInt(m[2]), rating, is_warmup: false, notes };
  }

  // Handle special weight tokens
  // "green top 53 x 14" or "green 53 x 14" — explicit weight after color
  const colorExplicit = trimmed.match(/^(green top|green|red|yellow|maroon)\s+(\d+\.?\d*)\s*x\s*(\d+)/i);
  if (colorExplicit) {
    return { weight: parseFloat(colorExplicit[2]), reps: parseInt(colorExplicit[3]), rating, is_warmup: false, notes };
  }
  // "green top 53" — explicit weight, no reps
  const colorExplicitNoReps = trimmed.match(/^(green top|green|red|yellow|maroon)\s+(\d+\.?\d*)$/i);
  if (colorExplicitNoReps) {
    return { weight: parseFloat(colorExplicitNoReps[2]), reps: prevReps || 10, rating, is_warmup: false, notes };
  }

  // KB color names with implied weights
  const colorWeights = [
    ['green top', 53],
    ['yellow', kgToLbs(16)], ['green', kgToLbs(24)], ['red', kgToLbs(32)],
    ['maroon', kgToLbs(28)], ['purple', 0], ['black', 0],
  ];
  for (const [color, w] of colorWeights) {
    const colorRe = new RegExp(`^${color}\\s*x\\s*(\\d+)`, 'i');
    const cm = trimmed.match(colorRe);
    if (cm) {
      return { weight: w, reps: parseInt(cm[1]), rating, is_warmup: false, notes };
    }
    if (trimmed.toLowerCase() === color) {
      return { weight: w, reps: prevReps || 10, rating, is_warmup: false, notes };
    }
  }

  // Just a number (weight only, carry over reps) or (reps only if small and no prev weight)
  m = trimmed.match(/^(\d+\.?\d*)$/);
  if (m) {
    const num = parseFloat(m[1]);
    if (prevWeight !== null && prevWeight > 0) {
      // If num is in typical rep range (<=20) and prevWeight is set, treat as reps
      if (num <= 20) {
        return { weight: prevWeight, reps: num, rating, is_warmup: false, notes };
      }
      // Larger number — weight, carry over reps (default to 10 if unknown)
      return { weight: num, reps: prevReps || 10, rating, is_warmup: false, notes };
    }
    // No prev weight — if small number, likely reps; if large, weight
    if (num <= 20) {
      return { weight: 0, reps: num, rating, is_warmup: false, notes };
    }
    return { weight: num, reps: prevReps || 10, rating, is_warmup: false, notes };
  }

  // "W R" (weight space reps, no x) like "18 14" or "23 14"
  m = trimmed.match(/^(\d+\.?\d*)\s+(\d+)$/);
  if (m) {
    return { weight: parseFloat(m[1]), reps: parseInt(m[2]), rating, is_warmup: false, notes };
  }

  // "@ x R" or just "@"
  if (trimmed === '@' || /^@/.test(trimmed)) {
    const rm = trimmed.match(/@\s*x?\s*(\d+)/);
    return { weight: prevWeight, reps: rm ? parseInt(rm[1]) : prevReps, rating, is_warmup: false, notes };
  }

  // Handle "max" or "failure" lines
  if (/^max$/i.test(trimmed) || /^failure$/i.test(trimmed)) {
    return null; // Skip, can't determine numbers
  }

  // Handle specific patterns like "12 x 25" (reps x weight for clean press)
  // Actually this appears to be weight x reps consistently

  // Lines like "3 sets" or "2 sets"
  if (/^\d+\s+sets?$/i.test(trimmed)) {
    return null; // We can't determine exact weights
  }

  // Handle lines with "lbs" suffix (possibly with parenthetical notes in between)
  m = trimmed.match(/^(\d+\.?\d*)\s*lbs?\b.*?x\s*(\d+)/i);
  if (m) {
    return { weight: parseFloat(m[1]), reps: parseInt(m[2]), rating, is_warmup: false, notes };
  }
  m = trimmed.match(/^(\d+\.?\d*)\s*lbs?\s*$/i);
  if (m) {
    return { weight: parseFloat(m[1]), reps: prevReps || 10, rating, is_warmup: false, notes };
  }

  // Handle "X x R x W" patterns (unusual but present as "2 x 10" meaning "2 plates x 10")
  m = trimmed.match(/^(\d+\.?\d*)\s*x\s*(\d+)\s*x\s*(\d+)/i);
  if (m) {
    // Likely "90 x 2 x 10" meaning 90lbs, 2 sets of 10 — take first set
    return { weight: parseFloat(m[1]), reps: parseInt(m[3]), rating, is_warmup: false, notes };
  }

  // Handle "W x R then/pause R" patterns
  m = trimmed.match(/^(\d+\.?\d*)\s*x\s*(\d+).*(?:then|pause|\.)\s*(\d+)/i);
  if (m) {
    // Take the first part
    return { weight: parseFloat(m[1]), reps: parseInt(m[2]) + parseInt(m[3]), rating, is_warmup: false, notes };
  }

  return null;
}

// ── File Processing ──

function processFile(filename, warnings) {
  const filepath = path.join(NOTES_DIR, filename);
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.split('\n');

  const workoutType = inferWorkoutType(filename);
  const yearRange = inferYearRange(filename);

  const sessions = [];
  let currentSession = null;
  let sessionNumber = 0;
  let lastDate = null;
  let lastYear = yearRange.start;

  // First pass: identify session boundaries
  const sessionStarts = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) { i++; continue; }

    // First line of file is usually title
    if (i === 0 || (i <= 2 && !tryParseDate(trimmed) && !isDivider(trimmed))) {
      // Check if it's a title line (workout type description)
      const looksLikeTitle = /^(20\d{2}|pull|push|leg|heavy)/i.test(trimmed);
      if (looksLikeTitle || i === 0) { i++; continue; }
    }

    // Check for divider
    if (isDivider(trimmed)) {
      i++;
      continue;
    }

    // Check for date
    const dateInfo = tryParseDate(trimmed);
    if (dateInfo) {
      sessionStarts.push({ lineIndex: i, dateInfo });
      i++;
      continue;
    }

    i++;
  }

  // If no dates found, treat entire file as one session
  if (sessionStarts.length === 0) {
    // Some files like the heavy lifts file or first entry without date
    // Try to get date from filename
    return [];
  }

  // Process each session
  for (let si = 0; si < sessionStarts.length; si++) {
    const start = sessionStarts[si];
    const endLine = si + 1 < sessionStarts.length ? sessionStarts[si + 1].lineIndex : lines.length;

    // Resolve date
    let { month, day, year } = start.dateInfo;

    if (year === null) {
      // Infer year from context
      year = inferYear(month, day, lastDate, lastYear, yearRange);
    }

    if (month > 12 || day > 31) {
      // Try swapping
      if (day <= 12 && month <= 31) {
        [month, day] = [day, month];
      } else {
        warnings.push(`${filename}:${start.lineIndex + 1} - invalid date month=${month} day=${day}`);
        continue;
      }
    }

    if (month < 1 || day < 1) {
      warnings.push(`${filename}:${start.lineIndex + 1} - invalid date month=${month} day=${day}`);
      continue;
    }

    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Validate date
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      warnings.push(`${filename}:${start.lineIndex + 1} - invalid date: ${dateStr}`);
      continue;
    }

    lastDate = { year, month, day };
    lastYear = year;
    sessionNumber++;

    // Parse session content
    const sessionLines = [];
    for (let li = start.lineIndex + 1; li < endLine; li++) {
      const lt = lines[li].trim();
      if (isDivider(lt)) continue;
      // Skip if it's another date (shouldn't happen but safety)
      if (tryParseDate(lt)) continue;
      sessionLines.push({ text: lt, lineNum: li + 1 });
    }

    const sessionSets = parseSession(sessionLines, dateStr, workoutType, sessionNumber, filename, warnings);
    sessions.push(...sessionSets);
  }

  return sessions;
}

function inferYear(month, day, lastDate, lastYear, yearRange) {
  if (lastDate) {
    // If month < lastDate.month significantly, we probably crossed a year boundary
    const lastMonth = lastDate.month;
    if (month < lastMonth - 2) {
      // Crossed year boundary
      return lastDate.year + 1;
    }
    // December date appearing after smaller months in a file starting next year
    if (month === 12 && lastDate.year === yearRange.start && yearRange.start < yearRange.end) {
      return yearRange.start;
    }
    return lastDate.year;
  }

  // No previous date — use year range logic
  // If month is late in year (oct-dec) and yearRange.start matches, use start
  if (month >= 10 && yearRange.start <= yearRange.end) {
    return yearRange.start;
  }
  // If month is early (jan-mar) and we have an end year
  if (month <= 3) {
    return yearRange.end;
  }
  return yearRange.start;
}

function parseSession(sessionLines, dateStr, workoutType, sessionNumber, sourceFile, warnings) {
  const allSets = [];
  let cardioWarmup = [];

  // Group lines into exercise blocks
  let currentExercise = null;
  let exerciseNames = [];
  let supersetId = null;
  let setNumber = 0;
  let prevWeights = [];
  let prevReps = [];
  let prevSingleWeight = null;
  let prevSingleReps = null;

  for (const { text, lineNum } of sessionLines) {
    if (!text) continue;

    // Skip rest lines
    if (isRestLine(text)) continue;

    // Skip meta/note lines
    if (isMetaLine(text)) continue;

    // Check for cardio/warmup at session level
    if (isCardioWarmup(text) && !currentExercise) {
      cardioWarmup.push(text);
      continue;
    }

    // Check if this is a "Warmup" line within an exercise (skip as warmup set)
    if (/^warmup\s*(up|rows|light)?$/i.test(text.trim())) {
      // Warmup indicator within exercise — skip or treat as warmup set
      continue;
    }

    // Check if line is an exercise header
    if (isExerciseHeader(text, currentExercise)) {
      // Start new exercise
      const isSS = isSupersetHeader(text);

      if (isSS) {
        const rawParts = text.split('/').map(p => p.trim()).filter(Boolean);
        prevWeights = new Array(rawParts.length).fill(null);
        prevReps = new Array(rawParts.length).fill(null);

        // Extract weight from raw name BEFORE cleaning
        exerciseNames = [];
        for (let ei = 0; ei < rawParts.length; ei++) {
          const { name: preName, weight, reps } = extractWeightFromName(rawParts[ei]);
          const cleaned = cleanExerciseName(preName);
          exerciseNames.push(cleaned || preName);
          if (weight !== null) prevWeights[ei] = weight;
          if (reps !== null) prevReps[ei] = reps;
        }
        supersetId = `${dateStr}-${exerciseNames[0].substring(0, 10)}-ss`;
      } else {
        const { name: preName, weight, reps } = extractWeightFromName(text.trim());
        const name = cleanExerciseName(preName);
        exerciseNames = [name || preName];
        supersetId = null;
        prevWeights = [weight];
        prevReps = [reps];
      }

      // Normalize exercise names
      exerciseNames = exerciseNames.map(n => normalizeExerciseName(n) || n);
      // Filter out null (garbage) names
      exerciseNames = exerciseNames.filter(n => n !== null);
      if (exerciseNames.length === 0) continue;

      currentExercise = exerciseNames[0];
      setNumber = 0;
      prevSingleWeight = prevWeights[0];
      prevSingleReps = prevReps[0];
      continue;
    }

    // If no current exercise, check if this could be an exercise name
    if (!currentExercise) {
      if (isNoteLine(text)) continue;
      // Might be a note or exercise
      if (looksLikeSetData(text)) continue; // orphaned set data
      // Treat as exercise name
      const { name: preName, weight, reps } = extractWeightFromName(text.trim());
      const name = cleanExerciseName(preName);
      const normalized = normalizeExerciseName(name);
      if (normalized && normalized.length > 1) {
        exerciseNames = [normalized];
        currentExercise = normalized;
        supersetId = null;
        setNumber = 0;
        prevWeights = [weight];
        prevReps = [reps];
        prevSingleWeight = weight;
        prevSingleReps = reps;
      }
      continue;
    }

    // Try to parse as set data
    if (isNoteLine(text) && !looksLikeSetData(text)) continue;

    // Handle "3 sets" type lines
    const setsMatch = text.match(/^(\d+)\s+sets?\s*$/i);
    if (setsMatch) {
      // We know there are N sets but don't have specifics — skip
      continue;
    }

    // Handle "Last set" indicator
    if (/^last\s+set$/i.test(text.trim())) continue;

    if (supersetId && text.includes('/')) {
      // Superset set line
      const parts = text.split('/').map(p => p.trim());
      const parsedSets = [];

      for (let pi = 0; pi < parts.length && pi < exerciseNames.length; pi++) {
        let part = parts[pi].trim();
        if (!part) { parsedSets.push(null); continue; }

        // Handle "same" for superset part
        if (/^sam[e]?\s*$/i.test(part)) {
          if (prevWeights[pi] !== null) {
            parsedSets.push({
              weight: prevWeights[pi], reps: prevReps[pi],
              rating: null, is_warmup: prevWeights[pi] === 0, notes: null
            });
          } else {
            parsedSets.push(null);
          }
          continue;
        }

        if (/^set$/i.test(part)) {
          if (prevWeights[pi] !== null) {
            parsedSets.push({
              weight: prevWeights[pi], reps: prevReps[pi],
              rating: null, is_warmup: false, notes: null
            });
          } else {
            parsedSets.push(null);
          }
          continue;
        }

        const parsed = parseSingleSet(part, prevWeights[pi], prevReps[pi]);
        parsedSets.push(parsed);
      }

      // Handle case where fewer parts than exercises (implied "same")
      while (parsedSets.length < exerciseNames.length) {
        const idx = parsedSets.length;
        if (prevWeights[idx] !== null) {
          parsedSets.push({
            weight: prevWeights[idx], reps: prevReps[idx],
            rating: null, is_warmup: false, notes: null
          });
        } else {
          parsedSets.push(null);
        }
      }

      setNumber++;
      for (let pi = 0; pi < parsedSets.length; pi++) {
        const ps = parsedSets[pi];
        if (!ps) continue;
        prevWeights[pi] = ps.weight !== null ? ps.weight : prevWeights[pi];
        prevReps[pi] = ps.reps !== null ? ps.reps : prevReps[pi];

        const era = ratingEra(dateStr);
        allSets.push({
          date: dateStr,
          workout_type: workoutType,
          session_number: sessionNumber,
          exercise: exerciseNames[pi],
          set_number: setNumber,
          weight_lbs: ps.weight || 0,
          reps: ps.reps || 0,
          is_warmup: ps.is_warmup || false,
          rating_raw: ps.rating,
          rating_normalized: normalizeRating(ps.rating, era),
          rating_era: era,
          superset_id: supersetId,
          notes: ps.notes,
          source_file: sourceFile
        });
      }
    } else {
      // Single exercise set
      const parsed = parseSingleSet(text, prevSingleWeight, prevSingleReps);
      if (parsed) {
        setNumber++;
        if (parsed.weight !== null) prevSingleWeight = parsed.weight;
        if (parsed.reps !== null) prevSingleReps = parsed.reps;
        prevWeights[0] = prevSingleWeight;
        prevReps[0] = prevSingleReps;

        const era = ratingEra(dateStr);
        allSets.push({
          date: dateStr,
          workout_type: workoutType,
          session_number: sessionNumber,
          exercise: exerciseNames[0],
          set_number: setNumber,
          weight_lbs: parsed.weight || 0,
          reps: parsed.reps || 0,
          is_warmup: parsed.is_warmup || false,
          rating_raw: parsed.rating,
          rating_normalized: normalizeRating(parsed.rating, era),
          rating_era: era,
          superset_id: supersetId,
          notes: parsed.notes,
          source_file: sourceFile
        });
      }
    }
  }

  return allSets;
}

function isExerciseHeader(text, currentExercise) {
  const trimmed = text.trim();

  // Must not be empty
  if (!trimmed) return false;

  // Dividers and dates handled elsewhere
  if (isDivider(trimmed)) return false;
  if (tryParseDate(trimmed)) return false;

  // Rest lines are not headers
  if (isRestLine(trimmed)) return false;

  // If it looks like set data, it's not a header
  if (looksLikeSetData(trimmed)) return false;

  // If it's a pure note, not a header
  if (isNoteLine(trimmed) && !trimmed.includes('/')) return false;

  // If it contains letters that aren't just "x", "kg", "p", "lbs", "same", "set" etc, likely an exercise name
  const hasExerciseWords = /[a-zA-Z]{2,}/.test(trimmed);
  if (!hasExerciseWords) return false;

  // Check if it's a known non-exercise pattern
  const nonExercise = /^(same|set|warmup|bar|air|max|failure|finisher|last|school|was|no |not |had |did |\d+ sets)/i;
  if (nonExercise.test(trimmed)) return false;

  // Lines with exercise-like words
  const exerciseWords = /(press|row|curl|pull|push|dip|squat|dead|lunge|fly|flies|raise|crush|slam|extension|machine|bench|incline|flat|skull|rope|cable|bar|kb|shrug|reverse|arnold|boxer|convict|drive|bridge|bosu|cossach|cosaach|cosach|crossach|makers|drag|sled|ball|diamond|leg|calf|glute|hammer|bicep|tricep|deltoid|disk|plate|single|seated|standing|prone|one leg|olympic|ez|v bar|t bar|lat|low|stiff|trap|rotation|man|gun|free motion)/i;
  if (exerciseWords.test(trimmed)) return true;

  // If it contains a / and has letters, likely superset header
  if (trimmed.includes('/') && isSupersetHeader(trimmed)) return true;

  // If current exercise exists and this line has mostly letters, it's likely a new exercise
  if (currentExercise && /^[a-zA-Z]/.test(trimmed) && trimmed.length > 3) {
    // But not if it's a common note pattern
    if (!isNoteLine(trimmed)) return true;
  }

  return false;
}

function looksLikeSetData(text) {
  const t = text.trim();
  // "W x R" or just a number or "same" or "set" or "@" or plate notation
  if (/^\d+\.?\d*\s*x\s*\d+/i.test(t)) return true;
  if (/^\d+\.?\d*\s*p\s/i.test(t)) return true;
  if (/^\d+\.?\d*\s*kg/i.test(t)) return true;
  if (/^\d+\.?\d*$/i.test(t)) return true;
  if (/^\d+\.?\d*\s+\d+$/i.test(t)) return true;  // "18 14"
  if (/^(same|set|bar|air|warmup\s+\d|@|max|failure)/i.test(t)) return true;
  if (/^(yellow|green|red|maroon|purple|black)\s/i.test(t)) return true;
  // Check for superset set patterns like "85 x 12 / 50 x 12"
  if (/\d+\s*x\s*\d+.*\/.*\d+/i.test(t)) return true;
  if (/^\d+\s*\/\s*\d+/i.test(t)) return true;
  if (/^(no weight|0 x|length)/i.test(t)) return true;
  return false;
}

function cleanExerciseName(name) {
  if (!name) return '';
  // Remove weight/rep info from exercise names
  let cleaned = name.trim();
  // Remove trailing weight info like "65" or "70lbs" or "24kg"
  cleaned = cleaned.replace(/\s+\d+\.?\d*\s*(lbs?|kg|lb)?\s*$/i, '');
  // Remove emoji
  cleaned = cleaned.replace(/[💪🏽🔥👍🏽🦿🦾🙌🏽🥜\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
  // Trim
  cleaned = cleaned.trim();
  // Remove trailing numbers that are weights
  cleaned = cleaned.replace(/\s+\d+\.?\d*\s*$/, '');
  return cleaned;
}

function extractWeightFromName(name) {
  if (!name) return { name: '', weight: null, reps: null };

  let weight = null;
  let reps = null;
  let cleanName = name;

  // Extract "X lbs" or "Xkg" from name
  const lbsMatch = name.match(/\s+(\d+\.?\d*)\s*lbs?\b/i);
  if (lbsMatch) {
    weight = parseFloat(lbsMatch[1]);
    cleanName = name.replace(lbsMatch[0], '').trim();
  }

  const kgMatch = name.match(/\s+(\d+\.?\d*)\s*kg\b/i);
  if (kgMatch) {
    weight = kgToLbs(parseFloat(kgMatch[1]));
    cleanName = name.replace(kgMatch[0], '').trim();
  }

  // Extract reps from name like "x 12" at end
  const repsMatch = cleanName.match(/\s+x?\s*(\d+)\s*$/);
  // Don't extract — too ambiguous

  // Extract trailing weight number
  const trailNum = cleanName.match(/\s+(\d+\.?\d*)\s*$/);
  if (trailNum && !weight) {
    const num = parseFloat(trailNum[1]);
    if (num > 0) {
      weight = num;
      cleanName = cleanName.replace(trailNum[0], '').trim();
    }
  }

  return { name: cleanName, weight, reps };
}

// ── Exercise Name Normalization ──

const EXERCISE_CANONICAL = {
  // Pull exercises
  'lat pull down': 'Lat Pulldown',
  'lat pull downs': 'Lat Pulldown',
  'lat pulldown': 'Lat Pulldown',
  'lat pulldowns': 'Lat Pulldown',
  'pull down': 'Lat Pulldown',
  'pull downs': 'Lat Pulldown',
  'pull downs lat': 'Lat Pulldown',
  'pull down good form': 'Lat Pulldown',
  'pull downs last': 'Lat Pulldown',

  'bent over rows': 'Bent Over Rows',
  'bent over rows olympic': 'Bent Over Rows',
  'bent over rows olympic ex bar': 'Bent Over Rows',
  'bent iver rows': 'Bent Over Rows',
  'bent iver rows olympic': 'Bent Over Rows',
  'bor olympic ex bar': 'Bent Over Rows',
  'bor olympic': 'Bent Over Rows',
  'bent over row machine 5 each s': 'Bent Over Row Machine',

  'low rows': 'Low Rows',
  'rope low rows': 'Low Rows',

  'machine rows': 'Machine Rows',
  'machine rows close grip': 'Machine Rows',

  't bar rows': 'T-Bar Rows',
  't bar row': 'T-Bar Rows',
  'tbar': 'T-Bar Rows',
  't bar rows narrow grip': 'T-Bar Rows',

  'fixed bb curls': 'Barbell Curls',
  'bb curls fixed': 'Barbell Curls',
  'bb curls': 'Barbell Curls',
  'fixed bar curls': 'Barbell Curls',
  'barbell curls': 'Barbell Curls',
  'fixed barbell curls': 'Barbell Curls',
  'biceps curls fixed': 'Barbell Curls',
  'fixed bb curls fixed': 'Barbell Curls',
  'ez curls': 'EZ Bar Curls',
  'olympic ez curls': 'EZ Bar Curls',

  'rope curls': 'Rope Curls',
  'rope curls - finisher': 'Rope Curls',
  'cable curls ez bar': 'Cable Curls',
  'cable curls rope': 'Cable Curls',
  'cable rope curls': 'Cable Curls',
  'ez curls cable': 'Cable Curls',
  'rope hammer curls': 'Hammer Curls',
  'hammer curls': 'Hammer Curls',
  'hammer ropes': 'Hammer Curls',

  'db curls': 'Dumbbell Curls',
  'db curls standing': 'Dumbbell Curls',
  'seated db curls': 'Seated Dumbbell Curls',

  'assisted pull ups': 'Assisted Pull-Ups',
  'assisted pull up': 'Assisted Pull-Ups',
  'assisted chin ups': 'Assisted Pull-Ups',
  'pull ups asssisted purple': 'Assisted Pull-Ups',
  'pulls up assisted purple': 'Assisted Pull-Ups',
  'pull ups': 'Pull-Ups',
  'pull-ups': 'Pull-Ups',
  'pull-ups assisted': 'Assisted Pull-Ups',
  'pull ups biceps black band': 'Pull-Ups (Bicep)',
  'pull up biceps black band': 'Pull-Ups (Bicep)',
  'pulls ups biceps': 'Pull-Ups (Bicep)',
  'hammer pull ups purple band': 'Hammer Pull-Ups',
  'hammer pull up purple band': 'Hammer Pull-Ups',
  'purple pull ups': 'Hammer Pull-Ups',
  'knee pull ups': 'Pull-Ups',
  'assisted putple pull ups': 'Hammer Pull-Ups',
  'assisted black biceps pull up': 'Pull-Ups (Bicep)',

  'reverse flies': 'Reverse Flies',
  'reverse back flies': 'Reverse Flies',
  'reverse db flies': 'Reverse Flies',
  'bent over flies': 'Reverse Flies',
  'bent over floes': 'Reverse Flies',
  'bent over fly': 'Reverse Flies',
  'machine flies back': 'Reverse Flies',

  'shrugs': 'Shrugs',
  'shrugs machine': 'Shrugs (Machine)',
  'shrugs db': 'Shrugs (DB)',

  'gun slingers': 'Gunslingers',
  'gunslinger': 'Gunslingers',
  'gunslinger finisher': 'Gunslingers',

  // Push exercises
  'flat db press': 'DB Bench Press',
  'flat db curls': 'DB Bench Press',
  'flat db press .s kb swing d': 'DB Bench Press',
  'db press': 'DB Bench Press',
  'flat bench db press': 'DB Bench Press',
  'flat bench db': 'DB Bench Press',
  'flat bench press': 'Barbell Bench Press',
  'flat bench': 'Barbell Bench Press',
  'bench press': 'Barbell Bench Press',
  'flat bb press': 'Barbell Bench Press',
  'flat machine press': 'Machine Bench Press',

  'incline machine press': 'Incline Machine Press',
  'incline machine': 'Incline Machine Press',
  'inc machine press': 'Incline Machine Press',
  'inc machine': 'Incline Machine Press',
  'machine inc press': 'Incline Machine Press',
  'machine incline press': 'Incline Machine Press',
  'machine incline': 'Incline Machine Press',
  'incline press machine': 'Incline Machine Press',
  'incline mech press': 'Incline Machine Press',
  'incl machine press': 'Incline Machine Press',
  'incline press': 'Incline Machine Press',
  'incline bb press': 'Incline Barbell Press',
  'incline bench': 'Incline Barbell Press',
  'incline olympic press': 'Incline Barbell Press',
  'seated incline press': 'Incline Machine Press',

  'dips': 'Dips',
  'dips weighted': 'Dips',
  'weighted dips': 'Dips',
  'dips no weight': 'Dips',
  'dips only was taking a little easier focussing on form': 'Dips',
  'dips triceps': 'Dips',

  'skull crusher': 'Skull Crushers',
  'skull crushers': 'Skull Crushers',
  'skull crush': 'Skull Crushers',
  'skull crusher fixed': 'Skull Crushers',
  'skull crusher olympic': 'Skull Crushers',
  'olympic skull crusher': 'Skull Crushers',
  'fixed bar skull crusher': 'Skull Crushers',
  'crusher': 'Skull Crushers',

  'push ups': 'Push-Ups',
  'pushups': 'Push-Ups',
  'pushups normal': 'Push-Ups',
  'press ups': 'Push-Ups',
  'press-ups': 'Push-Ups',
  'push up': 'Push-Ups',
  'push-up': 'Push-Ups',
  'diamond push up': 'Diamond Push-Ups',
  'diamond push ups': 'Diamond Push-Ups',
  'diamond pushups': 'Diamond Push-Ups',
  'diamond press-ups': 'Diamond Push-Ups',
  'diamond': 'Diamond Push-Ups',
  'diamonds': 'Diamond Push-Ups',
  '0ushup': 'Push-Ups',

  'rope extensions': 'Tricep Rope Extensions',
  'rope push down': 'Tricep Rope Pushdown',
  'rope push downs': 'Tricep Rope Pushdown',
  'rope pull downs': 'Tricep Rope Pushdown',
  'roper pull down': 'Tricep Rope Pushdown',
  'v bar push down': 'V-Bar Pushdown',
  'v bar push downs': 'V-Bar Pushdown',
  'v bar triceps push down': 'V-Bar Pushdown',
  'v bar extensions': 'V-Bar Pushdown',
  'triceps push down rope': 'Tricep Rope Pushdown',
  'tricep push down': 'Tricep Pushdown',
  'tricep push down straight at': 'Tricep Pushdown',
  'triceps extension s': 'Tricep Extensions',
  'triceps extension olympic': 'Tricep Extensions',
  'triceps extensions': 'Tricep Extensions',
  'reverse extensions': 'Reverse Tricep Extensions',
  'reverse extension rope s ball slams': 'Reverse Tricep Extensions',
  'reverse extension ez bar': 'Reverse Tricep Extensions',
  'reverse extension triceps': 'Reverse Tricep Extensions',
  'reverse rope extension': 'Reverse Tricep Extensions',
  'reverse rope pulls': 'Reverse Tricep Extensions',
  'reverse cable': 'Reverse Tricep Extensions',
  'reverse recipes push ez curl': 'Reverse Tricep Extensions',
  'reverse triceps': 'Reverse Tricep Extensions',
  'cable reverse pull down': 'Reverse Tricep Extensions',
  'rope extensions reverse': 'Reverse Tricep Extensions',
  'single arm triceps ext': 'Tricep Extensions',
  'triceps push down': 'Tricep Pushdown',

  'standing db press': 'Standing DB Press',
  'standing arnold press': 'Arnold Press',
  'standing arnold press db': 'Arnold Press',
  'standing arnold': 'Arnold Press',
  'arnold press rotation': 'Arnold Press',
  'arnold rotation': 'Arnold Press',
  'arnold press rotation seated': 'Arnold Press (Seated)',
  'arnold seated rotation press': 'Arnold Press (Seated)',
  'arnold standing press': 'Arnold Press',
  'db arnold press': 'Arnold Press',
  'db arnold': 'Arnold Press',
  'standing presses db': 'Standing DB Press',
  'seated shoulder press': 'Seated Shoulder Press',
  'shoulder press': 'Standing DB Press',
  'shoulder press standing': 'Standing DB Press',
  'shoulder press db hammer': 'Standing DB Press',
  'db press shoulder seated': 'Seated Shoulder Press',
  'seated db press': 'Seated Shoulder Press',
  'standard db shoulder press': 'Standing DB Press',

  'disk raises': 'Plate Raises',
  'disk rises': 'Plate Raises',
  'plate raises': 'Plate Raises',
  'plate rises': 'Plate Raises',
  'raises': 'Plate Raises',
  'delt raises': 'Lateral Raises',
  'deltoid raises': 'Lateral Raises',
  'delt side raises': 'Lateral Raises',
  'deltoid takes side': 'Lateral Raises',
  'side raises': 'Lateral Raises',
  'side raises shoulder': 'Lateral Raises',
  'raises side': 'Lateral Raises',
  'front raises': 'Front Raises',

  'boxer press': 'Boxer Press',
  'boxer landmine press': 'Boxer Press',

  'machine flies': 'Machine Flies',

  // Leg exercises
  'squat': 'Squats',
  'squats': 'Squats',
  'squat (great form)': 'Squats',
  'squats only': 'Squats',
  'sqaut': 'Squats',

  'leg press': 'Leg Press',
  'squat press': 'Leg Press',
  'squat press machine': 'Leg Press',
  'squat machine': 'Leg Press',
  'machine squat press': 'Leg Press',
  'squat machine press': 'Leg Press',

  'trap bar deadlifts': 'Trap Bar Deadlifts',
  'trap bar deadlift': 'Trap Bar Deadlifts',
  'deadlifts trap bar': 'Trap Bar Deadlifts',
  'deadlifts traditional': 'Traditional Deadlifts',
  'deadlift trap bar': 'Trap Bar Deadlifts',
  'kb deadlift': 'KB Deadlifts',

  'stiffies': 'Stiff Leg Deadlifts',
  'stiffies olympic': 'Stiff Leg Deadlifts',
  'stiff leg deadlift': 'Stiff Leg Deadlifts',
  'stiff legged deadlifts': 'Stiff Leg Deadlifts',
  'stiff legged deadlifts  good stretch and form': 'Stiff Leg Deadlifts',
  'stuff leg deadlifts': 'Stiff Leg Deadlifts',

  'seated calf': 'Seated Calf Raises',
  'seated calf raises': 'Seated Calf Raises',
  'seated raises': 'Seated Calf Raises',
  'seater calf raises': 'Seated Calf Raises',
  'standing calf raises': 'Standing Calf Raises',

  'lunges db': 'DB Lunges',
  'lunge db': 'DB Lunges',
  'db lunges': 'DB Lunges',
  'lunges kb': 'KB Lunges',

  'cossach squats': 'Cossack Squats',
  'cosach squats': 'Cossack Squats',
  'cosaach squats': 'Cossack Squats',
  'crossach squats': 'Cossack Squats',
  'cassoaxh squat': 'Cossack Squats',
  'cossach': 'Cossack Squats',
  'cossach squat': 'Cossack Squats',

  'bosu squat': 'Bosu Squats',
  'bosu squats': 'Bosu Squats',
  'bosu': 'Bosu Squats',
  'kb bosu squat': 'Bosu Squats',
  'bosu squat with kb uneven load': 'Bosu Squats',
  'bosu squat body weight': 'Bosu Squats',
  'bosu squat kb': 'Bosu Squats',
  'bosu heel/ toe / squat': 'Bosu Squats',
  'bosu each side': 'Bosu Squats',
  'boss squatcossach squats': 'Cossack Squats',

  'sled push': 'Sled Push',
  'sled pushes': 'Sled Push',
  'sled pushes 2 lengths': 'Sled Push',

  'single leg squats': 'Single Leg Squats',
  'one legged squats': 'Single Leg Squats',
  'one legged squat': 'Single Leg Squats',
  'single leg lunges on red bix': 'Single Leg Lunges',
  'red box single lunge': 'Single Leg Lunges',
  'one legged squat on blue box': 'Single Leg Lunges',
  'one legged squat in green box': 'Single Leg Lunges',

  'glute drive': 'Glute Drive',
  'glute bridge': 'Glute Bridge',
  'prone leg curls': 'Leg Curls',
  'leg curls machine': 'Leg Curls',
  'leg extension': 'Leg Extensions',

  'single db rdl': 'Single Leg RDL',

  // Superset secondary exercises
  'kbs': 'Kettlebell Swings',
  'kb swings': 'Kettlebell Swings',
  'kb swing': 'Kettlebell Swings',
  'kbs swings': 'Kettlebell Swings',
  'kb swig swings': 'Kettlebell Swings',
  'lbs wings': 'Kettlebell Swings',
  's kbs': 'Single Kettlebell Swings',
  'skbs': 'Single Kettlebell Swings',
  's kb swings': 'Single Kettlebell Swings',
  's kbs x': 'Single Kettlebell Swings',
  'kbs x': 'Kettlebell Swings',
  'd kbs': 'Double KB Swings',
  'd kbs x': 'Double KB Swings',
  'single kbs': 'Single Kettlebell Swings',
  'single kb': 'Single Kettlebell Swings',
  's kbs seattle': 'Single Kettlebell Swings',
  'lbs': 'Kettlebell Swings',
  'kb drags': 'KB Drags',
  'kb pulls': 'KB Drags',
  'kb drags x': 'KB Drags',

  'ball throws': 'Ball Throws',
  'ball throw': 'Ball Throws',
  'ball slams': 'Ball Slams',
  'ball slam': 'Ball Slams',
  'ball slams x': 'Ball Slams',
  'ball slams side to side': 'Ball Slams (Side)',
  'ball side slams x': 'Ball Slams (Side)',
  'ball side slam': 'Ball Slams (Side)',
  'ball sides': 'Ball Slams (Side)',
  'ball side': 'Ball Slams (Side)',
  'side ball throws': 'Ball Throws (Side)',
  'ball trow side to side': 'Ball Throws (Side)',
  'ball throws side to side': 'Ball Throws (Side)',
  'rotation slam': 'Rotational Slams',
  'rotational slam': 'Rotational Slams',
  'rotational slams': 'Rotational Slams',
  'ball rotation': 'Rotational Slams',
  'ball side slams': 'Ball Slams (Side)',
  'ball slam side to side': 'Ball Slams (Side)',
  'ball throws wall': 'Ball Throws',

  'box jump black': 'Box Jumps',
  'box jumps black': 'Box Jumps',
  'box jump red': 'Box Jumps',
  'box jumps': 'Box Jumps',

  'clean press kb': 'KB Clean Press',
  'clean press': 'KB Clean Press',
  'kb clean press': 'KB Clean Press',
  'kb clean press strict': 'KB Clean Press',

  'man makers': 'Man Makers',
  'kb go-around': 'KB Go-Around',

  'skip': 'Skipping',
  'skipping': 'Skipping',
  'skip 50s': 'Skipping',
  'skip 30s': 'Skipping',
  'skip 1 min': 'Skipping',
  'skip 1.3 m': 'Skipping',

  'convict pulls': 'Convict Leg Pulls',
  'convict pulls knee': 'Convict Leg Pulls',
  'convict leg pulls': 'Convict Leg Pulls',
  'leg pulls convict': 'Convict Leg Pulls',

  'good mornings': 'Good Mornings',
  'foam rollout': 'Foam Rollout',
  'free motion rows finisher': 'Free Motion Rows',

  'sit ups': 'Sit-Ups',
  'sit-ups with plate': 'Sit-Ups',

  'single db rows': 'Single Arm DB Rows',
  'upright rows 55 fixed bar': 'Upright Rows',

  'straight bar cable curls': 'Cable Curls',

  'razors': 'Lateral Raises',

  // 2024 file additions
  'bench': 'Barbell Bench Press',
  'b3nch': 'Barbell Bench Press',
  'flat fb press': 'DB Bench Press',
  'flat bench press db': 'DB Bench Press',
  'flat db bench press': 'DB Bench Press',
  'dumbbell press flat': 'DB Bench Press',
  'db press flat': 'DB Bench Press',
  'bench pushes': 'Push-Ups',
  'bosu ball press ups': 'Push-Ups',

  'overhead press': 'Overhead Press',
  'overhead pres': 'Overhead Press',
  'overhead press olympic': 'Overhead Press',
  'overhead press form not great': 'Overhead Press',
  'seated db shoulder press': 'Seated Shoulder Press',
  'seated arnold press': 'Arnold Press (Seated)',

  'tbar rows': 'T-Bar Rows',
  'bb rows': 'T-Bar Rows',
  'bent over row': 'Bent Over Rows',
  'bent over rows (do on flat bench setup)': 'Bent Over Rows',
  'trx rows': 'TRX Rows',
  'hammer iso lateral rows machine': 'Machine Rows',

  'arm curls fixed': 'Barbell Curls',
  'seated db curls palm up': 'Seated Dumbbell Curls',
  'seated curls strict palm up': 'Seated Dumbbell Curls',
  'rope bicep curls': 'Rope Curls',
  'dumbbell': 'Dumbbell Curls',

  'triceps push down seattle': 'Tricep Pushdown',
  'triceps push down small straight bar': 'Tricep Pushdown',
  'machine dips triceps seattle': 'Tricep Pushdown',
  'triceps rope pull down': 'Tricep Rope Pushdown',
  'triceps rope push down': 'Tricep Rope Pushdown',
  'rope press down': 'Tricep Rope Pushdown',
  'v grip tricep push down': 'V-Bar Pushdown',
  'v bar triceps push downs': 'V-Bar Pushdown',
  'cable cross over triceps push down': 'Tricep Pushdown',
  'cable cross machine triceps push down reverse': 'Reverse Tricep Extensions',
  'free motion triceps push down reverse on cable cross machine': 'Reverse Tricep Extensions',
  'triceps extensions reverse': 'Reverse Tricep Extensions',
  'triceps rope reverse extensions': 'Reverse Tricep Extensions',
  'review triceps extensions aka cable skull crusher': 'Cable Skull Crushers',
  'cable skull crusher': 'Cable Skull Crushers',
  'skull crusher fixed bar': 'Skull Crushers',
  'skull crusher fixed bar ez': 'Skull Crushers',
  'fixed ez skip crisher': 'Skull Crushers',
  'rope ext reasons': 'Tricep Rope Extensions',
  'rope triceps extension': 'Tricep Rope Extensions',
  'triceps dips': 'Dips',
  'dips in righted': 'Dips',
  'dips 30 weighted': 'Dips',
  'weighted dips and boxer press': 'Dips',
  'triceps bench dip (red box and tyre)': 'Bench Dips',
  'bench dips tire and red box': 'Bench Dips',
  'bench dips': 'Bench Dips',

  'chin up assisted': 'Assisted Pull-Ups',
  'assisted pull-ups': 'Assisted Pull-Ups',
  'assisted pulls purple': 'Assisted Pull-Ups',
  'assisted pulls ups purple': 'Assisted Pull-Ups',
  'assisted pull ups purple band': 'Assisted Pull-Ups',
  'assisted pull ups purple': 'Assisted Pull-Ups',
  'assisted pull ups (72)': 'Assisted Pull-Ups',
  'pull ups purple band': 'Hammer Pull-Ups',
  'pulls ups purple band': 'Hammer Pull-Ups',

  'lat pull down front': 'Lat Pulldown',
  'lay pull down front': 'Lat Pulldown',
  'lay pull does': 'Lat Pulldown',
  'pul downs and kb swings': 'Lat Pulldown',

  'flat flies': 'Machine Flies',
  'flies flat': 'Machine Flies',

  'explosive landmine press': 'Landmine Press',
  'incline bench machine': 'Incline Machine Press',
  'incline machine press we': 'Incline Machine Press',

  'squats air': 'Squats',
  'air squat': 'Squats',
  'crossair squats': 'Squats',
  'corsair squats': 'Squats',
  'squats  6 reps': 'Squats',
  'squats back olympic': 'Squats',
  'squat and ball throws 5 straight 10 sides': 'Squats',
  'squat and ball throws': 'Squats',
  'squat. ball throws': 'Squats',
  'squat maxine': 'Leg Press',
  'squat machine 3p': 'Leg Press',
  'squat press : kb swings': 'Leg Press',
  'leg press and kb swings': 'Leg Press',
  'leg press 4.5p': 'Leg Press',
  'leg press machine normal': 'Leg Press',
  'hack squats': 'Hack Squats',
  'hack squat': 'Hack Squats',

  'deadlifts': 'Traditional Deadlifts',
  'deadlift with olympic bar': 'Traditional Deadlifts',
  'deadlifts straight bar trap bar not avail': 'Traditional Deadlifts',
  'trap deadlifts': 'Trap Bar Deadlifts',
  'turkish deadlift': 'Turkish Get-Ups',
  'turkish get ups 6 reps': 'Turkish Get-Ups',
  'turkish': 'Turkish Get-Ups',

  'seated calf raises 14-16': 'Seated Calf Raises',
  'seated calf 3p': 'Seated Calf Raises',
  'seated calf 3 plates': 'Seated Calf Raises',
  'seated calf press 2.5 plates': 'Seated Calf Raises',
  'seated calf 2.35 plates': 'Seated Calf Raises',
  'standing calf': 'Standing Calf Raises',
  'standing calf raises seattle': 'Standing Calf Raises',

  'leg extension cybex': 'Leg Extensions',
  'roc-it leg extension': 'Leg Extensions',
  'leg extension free motion': 'Leg Extensions',
  'seated leg curl seat': 'Leg Curls',
  'seated leg curl life fitness good': 'Leg Curls',
  'leg curl life fitness': 'Leg Curls',
  'alternate db lunge': 'DB Lunges',
  'lunges db alternate': 'DB Lunges',
  'db lunches': 'DB Lunges',

  'single arm kb': 'Single Kettlebell Swings',
  'single arm kbs': 'Single Kettlebell Swings',
  'single arm kb swings': 'Single Kettlebell Swings',
  'single arms kb swings': 'Single Kettlebell Swings',
  'single kb swings': 'Single Kettlebell Swings',
  'kbs single': 'Single Kettlebell Swings',
  'kb swings single': 'Single Kettlebell Swings',
  'kb sgl': 'Single Kettlebell Swings',
  'kb swing dbl': 'Kettlebell Swings',
  'kwsings double': 'Kettlebell Swings',
  'kb dbl': 'Kettlebell Swings',
  'dbl kb': 'Kettlebell Swings',
  'double kb swings': 'Kettlebell Swings',
  'kb snatch press': 'KB Snatch Press',
  'snatch press kb': 'KB Snatch Press',
  'snatch press kb single arm': 'KB Snatch Press',
  'snatch press kb light': 'KB Snatch Press',
  'rack-press kb': 'KB Rack Press',
  'guns-up kb': 'KB Guns-Up',
  'clean push kb': 'KB Clean Press',

  'slams': 'Ball Slams',
  'med ball slams': 'Ball Slams',
  'bal slams': 'Ball Slams',
  'ball throws side 12 x': 'Ball Throws (Side)',
  'burpees': 'Burpees',
  'jump lunges': 'Jump Lunges',
  'leg pull from hollowhold': 'Leg Pull Hollow Hold',

  'handing leg raises': 'Hanging Leg Raises',
  'hanging leg raise': 'Hanging Leg Raises',
  'leg raises': 'Hanging Leg Raises',
  'situps': 'Sit-Ups',
  'sit-ups ball': 'Sit-Ups',
  'kick thru': 'Kick Thru',
  'rotation anti clock': 'Rotational Work',
  'box jumps red': 'Box Jumps',

  'angled grip change': null,
  'really good combo': null,
  'side dungeon white lines shirt': null,
  'too light': null,
  'something with throws to make it more challenging.': null,
  'machine finisher 60 x 8 (9) had in tank': null,
  'o x 6 good form': null,

  'pull up purple': 'Hammer Pull-Ups',
  'pull ups purple': 'Hammer Pull-Ups',
  'gun slingers 50!': 'Gunslingers',
  'flat bench - kb swings': 'Barbell Bench Press',
  'side slams': 'Ball Slams (Side)',
  'side slam': 'Ball Slams (Side)',
  'ez curl fixed': 'Barbell Curls',
  'kb swings 24kb': 'Kettlebell Swings',
  'db press with palm rotation': 'DB Shoulder Press',

  // Garbage — should be null
  'wrmup': null,
  'warming': null,
  'warming bar': null,
  'stretch': null,
  'stretch no weight x': null,
  'light weight no tow turn': null,
  '?': null,
  'loop 1p x': null,
  '1p': null,
  '70 warmup': null,
  '20 x': null,
  '90 each side x': null,
  '65 each side x': null,
  '36kg x 6 (9)': null,
  '4.5 player each': null,
  '15 x 10 little pain': null,
};

function normalizeExerciseName(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();

  // Direct lookup
  if (EXERCISE_CANONICAL.hasOwnProperty(lower)) {
    return EXERCISE_CANONICAL[lower];
  }

  // Try removing trailing descriptors
  const stripped = lower
    .replace(/\s*(ex bar|olympic|fixed|good form|only|finisher|bonus)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (EXERCISE_CANONICAL.hasOwnProperty(stripped)) {
    return EXERCISE_CANONICAL[stripped];
  }

  // Check if name looks like garbage (set data, warmup, etc.)
  if (/^\d+\.?\d*\s*(x\s*\d+|warmup|each side|kg|p\s|lbs?)?\s*$/i.test(lower)) return null;
  if (/^\?+$/.test(lower)) return null;
  if (/^(wrmup|warming|warming bar|stretch|foam rollout)$/i.test(lower)) return null;
  if (/^loop\s/i.test(lower)) return null;
  if (/^light weight/i.test(lower)) return null;
  if (/little pain/i.test(lower)) return null;
  if (/player each/i.test(lower)) return null;
  if (/^stretch\s+no\s+weight/i.test(lower)) return null;

  // Title case the original if no match
  return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// ── Main ──

function main() {
  const files = fs.readdirSync(NOTES_DIR).filter(f => f.endsWith('.txt'));
  const allSets = [];
  const warnings = [];
  let totalSessions = 0;

  for (const file of files.sort()) {
    const sets = processFile(file, warnings);
    allSets.push(...sets);

    // Count unique dates as sessions
    const dates = new Set(sets.map(s => s.date));
    totalSessions += dates.size;
  }

  // Renumber sessions globally by date
  const dateToSessions = {};
  for (const set of allSets) {
    const key = `${set.date}-${set.workout_type}`;
    if (!dateToSessions[key]) dateToSessions[key] = [];
    dateToSessions[key].push(set);
  }

  // Sort all sets by date
  allSets.sort((a, b) => a.date.localeCompare(b.date));

  // Fix KB swing weights that are clearly misparsed (drop set artifacts)
  allSets.forEach(s => {
    if ((s.exercise === 'Kettlebell Swings' || s.exercise === 'Single Kettlebell Swings' || s.exercise === 'Double KB Swings') && s.weight_lbs > 100) {
      s.weight_lbs = 0; // Will be filtered or use previous weight
    }
  });

  // Filter out sets with null/garbage exercise names
  const cleanedSets = allSets.filter(s => {
    if (!s.exercise) return false;
    const lower = s.exercise.toLowerCase();
    if (/^\d/.test(lower)) return false;
    if (/^[\?\s]+$/.test(lower)) return false;
    if (/^(wrmup|warming|stretch|foam rollout)/.test(lower)) return false;
    if (/warmup|loop\s|player each|little pain|each side x|no weight|light weight|no tow/i.test(lower)) return false;
    if (/really good combo|side dungeon|angled grip|too light|something with|had in tank|good form$|18kb light/i.test(lower)) return false;
    if (s.reps === 0 && s.weight_lbs === 0) return false;
    // KB exercises always have weight — 0 means missing data
    if (s.weight_lbs === 0 && /kettlebell|kb swing/i.test(s.exercise)) return false;
    return true;
  });

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cleanedSets, null, 2));

  // Print summary
  const uniqueDates = new Set(cleanedSets.map(s => s.date));
  const uniqueExercises = new Set(cleanedSets.map(s => s.exercise));

  console.log('\n=== Parser Summary ===');
  console.log(`Total files processed: ${files.length}`);
  console.log(`Total sessions found: ${uniqueDates.size}`);
  console.log(`Total sets parsed: ${cleanedSets.length}`);
  console.log(`Unique exercises: ${uniqueExercises.size}`);
  console.log(`Date range: ${cleanedSets[0]?.date} to ${cleanedSets[cleanedSets.length - 1]?.date}`);

  if (warnings.length > 0) {
    console.log(`\nWarnings (${warnings.length}):`);
    warnings.forEach(w => console.log(`  ⚠ ${w}`));
  } else {
    console.log('\nNo warnings.');
  }

  // Workout type breakdown
  const byType = {};
  for (const d of uniqueDates) {
    const set = cleanedSets.find(s => s.date === d);
    byType[set.workout_type] = (byType[set.workout_type] || 0) + 1;
  }
  console.log('\nWorkout type breakdown:');
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
    console.log(`  ${t}: ${c} sessions`);
  });

  // Top exercises by frequency
  const exFreq = {};
  for (const s of cleanedSets) {
    exFreq[s.exercise] = (exFreq[s.exercise] || 0) + 1;
  }
  console.log('\nTop 15 exercises by set count:');
  Object.entries(exFreq).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([e, c]) => {
    console.log(`  ${e}: ${c} sets`);
  });
}

main();
