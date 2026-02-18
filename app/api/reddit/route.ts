import { NextResponse } from "next/server";

const USERNAME = "Bulky-Possibility216";
const USER_AGENT = "RedditAnalytics/1.0 (Next.js)";

function containsSoma(text: string): boolean {
  return /soma[-\s]?health|soma[_.]?health|soma-health\.co/i.test(text);
}

async function fetchJSON(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Reddit API error: ${res.status}`);
  return res.json();
}

async function fetchAllPages(baseUrl: string, kind: string) {
  const items: any[] = [];
  let after: string | null = null;
  do {
    const url = `${baseUrl}${after ? `&after=${after}` : ""}`;
    const data = await fetchJSON(url);
    for (const child of data.data.children) {
      if (child.kind === kind) items.push(child.data);
    }
    after = data.data.after;
  } while (after);
  return items;
}

export async function GET() {
  try {
    const [rawPosts, rawComments] = await Promise.all([
      fetchAllPages(
        `https://www.reddit.com/user/${USERNAME}/submitted.json?limit=100&sort=new`,
        "t3"
      ),
      fetchAllPages(
        `https://www.reddit.com/user/${USERNAME}/comments.json?limit=100&sort=new`,
        "t1"
      ),
    ]);

    const posts = rawPosts.map((d: any) => ({
      id: d.id,
      title: d.title,
      subreddit: d.subreddit,
      score: d.score,
      numComments: d.num_comments,
      createdUtc: d.created_utc,
      selftext: d.selftext || "",
      permalink: d.permalink,
      mentionsSoma:
        containsSoma(d.selftext || "") || containsSoma(d.title || ""),
    }));

    const comments = rawComments.map((d: any) => ({
      id: d.id,
      subreddit: d.subreddit,
      score: d.score,
      body: d.body || "",
      createdUtc: d.created_utc,
      linkTitle: d.link_title || "",
      permalink: d.permalink,
      mentionsSoma: containsSoma(d.body || ""),
    }));

    return NextResponse.json(
      { posts, comments, fetchedAt: Date.now() },
      {
        headers: {
          "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error), posts: [], comments: [], fetchedAt: Date.now() },
      { status: 502 }
    );
  }
}
