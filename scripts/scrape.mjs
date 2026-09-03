#!/usr/bin/env node
// Data source: Arctic Shift (community Reddit archive, Pushshift successor).
// Reddit deprecated unauthenticated .json endpoints in May 2026 — www.reddit.com
// now returns 403 for every anonymous API call, so we read from the archive
// instead. Permalinks are kept relative and still point at real reddit.com
// threads, which is what the dashboard links out to.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "public", "data.json");
const USERNAME = "Bulky-Possibility216";
const API = "https://arctic-shift.photon-reddit.com/api";
const PAGE = 100;
const DELAY = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, attempt = 0) {
  const res = await fetch(url, {
    headers: { "User-Agent": "reddit-analytics/1.0 (personal dashboard)" },
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await sleep(2000 * 2 ** attempt);
    return get(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function soma(text) {
  return /soma[-\s]?health|soma[_.]?health|soma-health\.co/i.test(text || "");
}

// Page backwards through the archive by author, oldest-seen timestamp as cursor.
async function fetchAll(kind) {
  const items = [];
  const seen = new Set();
  let before = null;

  for (;;) {
    const qs = new URLSearchParams({
      author: USERNAME,
      limit: String(PAGE),
      sort: "desc",
    });
    if (before !== null) qs.set("before", String(before));

    const batch = (await get(`${API}/${kind}/search?${qs}`)).data || [];
    if (!batch.length) break;

    let added = 0;
    let oldest = before;
    for (const d of batch) {
      if (oldest === null || d.created_utc < oldest) oldest = d.created_utc;
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      items.push(d);
      added++;
    }

    // No new records or no cursor movement means we've reached the end.
    if (!added || oldest === before) break;
    before = oldest;
    if (batch.length < PAGE) break;
    await sleep(DELAY);
  }

  return items;
}

// Archive comments carry link_id but not link_title; resolve parent post titles.
async function fetchLinkTitles(comments) {
  const ids = [...new Set(comments.map((c) => (c.link_id || "").replace(/^t3_/, "")).filter(Boolean))];
  const titles = new Map();

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const posts = (await get(`${API}/posts/ids?ids=${chunk.join(",")}`)).data || [];
      for (const p of posts) titles.set(p.id, p.title || "");
    } catch (e) {
      console.warn(`  link title lookup failed for ${chunk.length} ids: ${e.message}`);
    }
    if (i + 50 < ids.length) await sleep(DELAY);
  }

  return titles;
}

// Union by id, freshly scraped record wins.
function mergeWithExisting(fresh) {
  if (!fs.existsSync(OUT)) return fresh;

  let prev;
  try {
    prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch {
    console.warn("  existing data.json unreadable, writing fresh data only");
    return fresh;
  }

  const union = (a = [], b = []) => {
    const byId = new Map(a.map((x) => [x.id, x]));
    for (const x of b) if (!byId.has(x.id)) byId.set(x.id, x);
    return [...byId.values()];
  };

  return {
    posts: union(fresh.posts, prev.posts),
    comments: union(fresh.comments, prev.comments),
  };
}

async function main() {
  console.log(`Scraping u/${USERNAME} via Arctic Shift...`);

  const [rawPosts, rawComments] = await Promise.all([
    fetchAll("posts"),
    fetchAll("comments"),
  ]);

  const linkTitles = await fetchLinkTitles(rawComments);

  const posts = rawPosts.map((d) => ({
    id: d.id,
    title: d.title,
    subreddit: d.subreddit,
    score: d.score,
    numComments: d.num_comments,
    createdUtc: d.created_utc,
    selftext: d.selftext || "",
    permalink: d.permalink,
    url: `https://www.reddit.com${d.permalink}`,
    mentionsSoma: soma(d.selftext) || soma(d.title),
  }));

  const comments = rawComments.map((d) => ({
    id: d.id,
    subreddit: d.subreddit,
    score: d.score,
    body: d.body || "",
    createdUtc: d.created_utc,
    linkTitle: linkTitles.get((d.link_id || "").replace(/^t3_/, "")) || "",
    permalink: d.permalink,
    url: `https://www.reddit.com${d.permalink}`,
    mentionsSoma: soma(d.body),
  }));

  // Merge into whatever we already have instead of overwriting. Once a post or
  // comment is deleted its author becomes [deleted] in the archive, so an author
  // search can no longer find it — the only surviving copy is our last snapshot.
  const merged = mergeWithExisting({ posts, comments });

  merged.posts.sort((a, b) => b.createdUtc - a.createdUtc);
  merged.comments.sort((a, b) => b.createdUtc - a.createdUtc);

  const output = { ...merged, fetchedAt: Date.now() };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2));

  const keptPosts = merged.posts.length - posts.length;
  const keptComments = merged.comments.length - comments.length;
  if (keptPosts || keptComments) {
    console.log(`Kept ${keptPosts} post(s), ${keptComments} comment(s) only present in the previous snapshot`);
  }
  console.log(`Done: ${merged.posts.length} posts, ${merged.comments.length} comments`);
  console.log(`Saved to ${OUT}`);
}

main().catch((e) => {
  console.error("Scrape failed:", e.message);
  process.exit(1);
});
