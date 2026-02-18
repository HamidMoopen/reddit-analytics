#!/usr/bin/env node
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "public", "data.json");
const USERNAME = "Bulky-Possibility216";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location).then(resolve, reject);
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200)
          return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`JSON parse error: ${body.slice(0, 200)}`));
        }
      });
      res.on("error", reject);
    });
  });
}

function soma(text) {
  return /soma[-\s]?health|soma[_.]?health|soma-health\.co/i.test(text || "");
}

async function fetchAll(baseUrl, kind) {
  const items = [];
  let after = null;
  do {
    const url = `${baseUrl}${after ? `&after=${after}` : ""}`;
    const data = await get(url);
    for (const child of data.data.children) {
      if (child.kind === kind) items.push(child.data);
    }
    after = data.data.after;
  } while (after);
  return items;
}

async function main() {
  console.log(`Scraping u/${USERNAME}...`);

  const [rawPosts, rawComments] = await Promise.all([
    fetchAll(
      `https://www.reddit.com/user/${USERNAME}/submitted.json?limit=100&sort=new&raw_json=1`,
      "t3"
    ),
    fetchAll(
      `https://www.reddit.com/user/${USERNAME}/comments.json?limit=100&sort=new&raw_json=1`,
      "t1"
    ),
  ]);

  const posts = rawPosts.map((d) => ({
    id: d.id,
    title: d.title,
    subreddit: d.subreddit,
    score: d.score,
    numComments: d.num_comments,
    createdUtc: d.created_utc,
    selftext: d.selftext || "",
    permalink: d.permalink,
    mentionsSoma: soma(d.selftext) || soma(d.title),
  }));

  const comments = rawComments.map((d) => ({
    id: d.id,
    subreddit: d.subreddit,
    score: d.score,
    body: d.body || "",
    createdUtc: d.created_utc,
    linkTitle: d.link_title || "",
    permalink: d.permalink,
    mentionsSoma: soma(d.body),
  }));

  const output = { posts, comments, fetchedAt: Date.now() };
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2));

  console.log(`Done: ${posts.length} posts, ${comments.length} comments`);
  console.log(`Saved to ${OUT}`);
}

main().catch((e) => {
  console.error("Scrape failed:", e.message);
  process.exit(1);
});
