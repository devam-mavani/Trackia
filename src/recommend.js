/* ---------------------------------------------------------------------- */
/*  Recommendation planning                                                */
/*  Looks at YOUR library and decides which Home rows to show. Each plan:  */
/*  { key, title, personal, fetchPage(page) -> Promise<hit[]> }            */
/* ---------------------------------------------------------------------- */

import { browseManga, mangaRecommendations, browseBooks } from './sources.js';

const STATUS_WEIGHT = { completed: 1, progress: 0.8, plan: 0.3, hold: 0.2, dropped: -0.8 };

// How much one entry says "I like this kind of thing".
//  - rated 7 => x1, 10 => x2, 4 => 0, 1 => negative; unrated => x1
//  - dropped titles count against their genres
export function entryWeight(e) {
  const base = STATUS_WEIGHT[e.status] ?? 0.3;
  if (base < 0) return base; // dropped: always a negative signal
  const mult = e.rating > 0 ? Math.max(-1, Math.min(2, (e.rating - 4) / 3)) : 1;
  return base * mult;
}

// Ranked list of [name, score] pairs from a string-array field on entries.
export function rankBy(list, field) {
  const scores = new Map();
  list.forEach((e) => {
    const w = entryWeight(e);
    (e[field] || []).forEach((name) => scores.set(name, (scores.get(name) || 0) + w));
  });
  return [...scores.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
}

// Best "seed" titles to recommend from: liked, most recently touched first.
function pickSeeds(list, idField, n) {
  return list
    .filter((e) => e[idField] && e.status !== 'dropped' && (e.rating === 0 || e.rating >= 7))
    .sort((a, b) => (b.rating || 6) - (a.rating || 6) || (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, n);
}

const PAGE = 20;

/* ------------------------------- Manga ------------------------------- */

const MANGA_DEFAULT_GENRES = [
  'Action', 'Romance', 'Fantasy', 'Comedy', 'Horror', 'Slice of Life',
  'Psychological', 'Mystery', 'Sports', 'Sci-Fi', 'Supernatural', 'Drama',
];

const COUNTRY_ROWS = [
  { code: 'KR', tag: 'manhwa', label: 'Trending manhwa' },
  { code: 'JP', tag: 'manga', label: 'Trending manga' },
  { code: 'CN', tag: 'manhua', label: 'Trending manhua' },
];

export function planMangaRows(entries) {
  const mine = entries.filter((e) => e.type === 'manga');
  const plans = [];

  // 1. "Because you liked X" — real AniList community recommendations
  pickSeeds(mine, 'anilistId', 2).forEach((seed) => {
    plans.push({
      key: `m:rec:${seed.anilistId}`,
      title: `Because you liked ${seed.title}`,
      personal: true,
      fetchPage: (p) => mangaRecommendations(seed.anilistId, p, PAGE),
    });
  });

  // 2. Your top genres
  const topGenres = rankBy(mine, 'genres').slice(0, 3).map(([g]) => g);
  topGenres.forEach((g) => {
    plans.push({
      key: `m:genre:${g}`,
      title: `More ${g} for you`,
      personal: true,
      fetchPage: (p) => browseManga({ genre: g, sort: 'POPULARITY_DESC', page: p }),
    });
  });

  // 3. Format rows — whichever of manga/manhwa/manhua you read most goes first
  const hasTag = (e, tag) => (e.tags || []).some((t) => t.toLowerCase() === tag);
  const formatCount = (c) => mine.filter((e) =>
    c.tag === 'manga' ? !hasTag(e, 'manhwa') && !hasTag(e, 'manhua') : hasTag(e, c.tag)).length;
  [...COUNTRY_ROWS].sort((a, b) => formatCount(b) - formatCount(a)).forEach((c) => {
    plans.push({
      key: `m:trend:${c.code}`,
      title: c.label,
      personal: false,
      fetchPage: (p) => browseManga({ country: c.code, sort: 'TRENDING_DESC', page: p }),
    });
  });

  // 4. Variety rows
  plans.push(
    { key: 'm:finished', title: 'Binge-worthy: completed series', personal: false,
      fetchPage: (p) => browseManga({ status: 'FINISHED', sort: 'SCORE_DESC', popMin: 20000, page: p }) },
    { key: 'm:new', title: 'New & releasing now', personal: false,
      fetchPage: (p) => browseManga({ status: 'RELEASING', sort: 'TRENDING_DESC', page: p }) },
    { key: 'm:gems', title: 'Hidden gems', personal: false,
      fetchPage: (p) => browseManga({ sort: 'SCORE_DESC', popMin: 5000, popMax: 30000, page: p }) },
    { key: 'm:top', title: 'All-time top rated', personal: false,
      fetchPage: (p) => browseManga({ sort: 'SCORE_DESC', popMin: 40000, page: p }) },
  );

  // 5. Fill with genres you haven't shown yet
  MANGA_DEFAULT_GENRES.filter((g) => !topGenres.includes(g)).forEach((g) => {
    plans.push({
      key: `m:def:${g}`,
      title: g,
      personal: false,
      fetchPage: (p) => browseManga({ genre: g, sort: 'POPULARITY_DESC', page: p }),
    });
  });

  return plans;
}

/* ------------------------------- Books ------------------------------- */

const BOOK_DEFAULT_SUBJECTS = [
  'Fantasy', 'Science Fiction', 'Mystery', 'Thriller', 'Romance', 'Historical Fiction',
  'Young Adult Fiction', 'Horror', 'Biography & Autobiography', 'Business & Economics',
  'Psychology', 'Self-Help', 'History', 'Science',
];

export function planBookRows(entries) {
  const mine = entries.filter((e) => e.type === 'book');
  const plans = [];

  // 1. More from authors you rate highly
  const authors = rankBy(mine, 'authors').slice(0, 2).map(([a]) => a);
  authors.forEach((a) => {
    plans.push({
      key: `b:author:${a}`,
      title: `More from ${a}`,
      personal: true,
      fetchPage: (p) => browseBooks({ author: a, page: p }),
    });
  });

  // 2. Your top genres
  const topGenres = rankBy(mine, 'genres').slice(0, 3).map(([g]) => g);
  topGenres.forEach((g) => {
    plans.push({
      key: `b:genre:${g}`,
      title: `Because you like ${g}`,
      personal: true,
      fetchPage: (p) => browseBooks({ subject: g, page: p }),
    });
  });

  // 3. Variety rows
  const thisYear = new Date().getFullYear();
  plans.push(
    { key: 'b:pop-fic', title: 'Popular fiction', personal: false,
      fetchPage: (p) => browseBooks({ subject: 'Fiction', page: p }) },
    { key: 'b:new', title: 'New releases', personal: false,
      fetchPage: (p) => browseBooks({ subject: 'Fiction', orderBy: 'newest', page: p })
        .then((list) => list.filter((b) => !b.year || b.year >= thisYear - 1)) },
    { key: 'b:pop-non', title: 'Popular non-fiction', personal: false,
      fetchPage: (p) => browseBooks({ q: 'subject:nonfiction', page: p }) },
  );

  // 4. Fill with subjects you haven't shown yet
  BOOK_DEFAULT_SUBJECTS.filter((g) => !topGenres.includes(g)).forEach((g) => {
    plans.push({
      key: `b:def:${g}`,
      title: g,
      personal: false,
      fetchPage: (p) => browseBooks({ subject: g, page: p }),
    });
  });

  return plans;
}
