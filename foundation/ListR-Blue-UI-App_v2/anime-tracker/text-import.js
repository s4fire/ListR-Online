export const IMPORT_CATEGORIES = Object.freeze({ watching: 'Watching', completed: 'Completed', interested: 'Interested' });

function cleanLine(line) {
  return line
    .replace(/^\s*(?:[-*•▪◦‣]+|\d+[.)])\s*/, '')
    .replace(/^\s*[▸►→]\s*/, '')
    .trim();
}

function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function headingCategory(line) {
  const match = line.match(/^(watching|completed|interested)(?:\s+(?:anime|list))?\s*:?$/i);
  return match ? match[1].toLocaleLowerCase() : null;
}

function parseEpisodeAnnotation(value) {
  const text = value.trim();
  let match = text.match(/^(.*?)[\s\u00a0]*(?:\(|\[)\s*(\d+)\s*\/\s*(\d+|\?)\s*(?:episodes?|eps?|ep)?\s*(?:\)|\])\s*$/i);
  if (match) return { title: match[1].trim(), watched: Number(match[2]), annotation: `${match[2]}/${match[3]}` };

  match = text.match(/^(.*?)[\s\u00a0]*(?:\(|\[)\s*(\d+)\s*(?:episodes?|eps?|ep)\s*(?:\)|\])\s*$/i);
  if (match) return { title: match[1].trim(), watched: Number(match[2]), annotation: `${match[2]} episodes` };

  match = text.match(/^(.*?)\s*[-–—|:]\s*(\d+)\s*(?:episodes?|eps?|ep)?\s*$/i);
  if (match) return { title: match[1].trim(), watched: Number(match[2]), annotation: `${match[2]} episodes` };

  match = text.match(/^(.*?)\s+(\d+)\s*(?:episodes?|eps?|ep)\s*$/i);
  if (match) return { title: match[1].trim(), watched: Number(match[2]), annotation: `${match[2]} episodes` };

  match = text.match(/^(.*?)\s+(\d+)\s*$/);
  if (match && !(Number(match[2]) >= 1900 && Number(match[2]) <= 2099)) {
    return { title: match[1].trim(), watched: Number(match[2]), annotation: `${match[2]} episodes` };
  }

  return { title: text, watched: null, annotation: '' };
}

export function parseTextList(text, defaultCategory = 'watching') {
  const lines = String(text || '').split(/\r?\n/);
  const hasHeadings = lines.some((line) => Boolean(headingCategory(line.trim().replace(/^#+\s*/, ''))));
  const items = [];
  let category = IMPORT_CATEGORIES[defaultCategory] ? defaultCategory : 'watching';

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const heading = headingCategory(trimmed.replace(/^#+\s*/, ''));
    if (heading) {
      category = heading;
      continue;
    }

    if (/^(anime|title|list|my anime|my list)\s*:?$/i.test(trimmed)) continue;

    const cleaned = cleanLine(trimmed);
    if (!cleaned) continue;

    const parsed = parseEpisodeAnnotation(cleaned);
    if (!parsed.title || parsed.title.length < 2) continue;

    items.push({
      sourceTitle: parsed.title,
      category,
      watched: parsed.watched,
      annotation: parsed.annotation,
      sourceLine: rawLine,
      explicitCategory: hasHeadings
    });
  }

  return items;
}

export function titleVariants(media) {
  return [media?.title?.userPreferred, media?.title?.english, media?.title?.romaji, media?.title?.native].filter(Boolean);
}

export function matchScore(query, media) {
  const q = normalize(query);
  if (!q) return 0;
  let best = 0;

  for (const title of titleVariants(media)) {
    const t = normalize(title);
    if (!t) continue;
    if (t === q) best = Math.max(best, 100);
    else if (t.startsWith(q) || q.startsWith(t)) best = Math.max(best, 82);
    else if (t.includes(q) || q.includes(t)) best = Math.max(best, 68);
    else {
      const qw = new Set(q.split(' '));
      const tw = new Set(t.split(' '));
      const overlap = [...qw].filter((word) => tw.has(word)).length / Math.max(qw.size, tw.size);
      best = Math.max(best, Math.round(overlap * 60));
    }
  }

  return best;
}

export function rankMatches(query, mediaList) {
  return [...mediaList]
    .filter((media) => media?.id != null)
    .map((media) => ({ media, score: matchScore(query, media) }))
    .sort((a, b) => b.score - a.score || (Number(b.media?.seasonYear) || 0) - (Number(a.media?.seasonYear) || 0));
}
