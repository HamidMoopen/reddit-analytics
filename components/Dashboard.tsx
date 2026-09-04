"use client";

import { useState, useMemo, useEffect } from "react";
import { RedditData, RedditPost, RedditComment } from "@/lib/types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type TimeRange = "7d" | "14d" | "30d" | "all";
type Metric = "upvotes" | "comments";
type KindFilter = "all" | "posts" | "comments";

const TIME_RANGES: { key: TimeRange; label: string }[] = [
  { key: "7d", label: "7D" },
  { key: "14d", label: "14D" },
  { key: "30d", label: "30D" },
  { key: "all", label: "All" },
];

const KIND_FILTERS: { key: KindFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "posts", label: "Posts" },
  { key: "comments", label: "Comments" },
];

const RANGE_DAYS: Record<TimeRange, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  all: 9999,
};

const METRICS: { key: Metric; label: string }[] = [
  { key: "upvotes", label: "Upvotes" },
  { key: "comments", label: "Comments" },
];

const SUB_COLORS = [
  "#f97316",
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#eab308",
  "#ef4444",
  "#6366f1",
  "#84cc16",
];

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const CST = "America/Chicago";

function toCSTDateString(d: Date): string {
  // en-CA locale gives YYYY-MM-DD format
  return d.toLocaleDateString("en-CA", { timeZone: CST });
}

type Bucket = "day" | "week" | "month";

// Daily points over a multi-year span are unreadable, so widen the bucket
// as the window grows.
function bucketFor(spanDays: number): Bucket {
  if (spanDays <= 60) return "day";
  if (spanDays <= 400) return "week";
  return "month";
}

// YYYY-MM-DD -> the key its bucket is filed under.
function bucketKey(day: string, unit: Bucket): string {
  if (unit === "day") return day;
  if (unit === "month") return day.slice(0, 7);
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return d.toISOString().slice(0, 10);
}

function bucketLabel(key: string, unit: Bucket): string {
  if (unit === "month") {
    return new Date(key + "-01T12:00:00Z").toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "short",
      year: "2-digit",
    });
  }
  return new Date(key + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

// Every bucket from start to end, so quiet stretches read as zero, not as a gap.
function fillBuckets(start: string, end: string, unit: Bucket): string[] {
  const keys: string[] = [];
  const cur = new Date(bucketKey(start, unit) + (unit === "month" ? "-01" : "") + "T12:00:00Z");
  const last = new Date(bucketKey(end, unit) + (unit === "month" ? "-01" : "") + "T12:00:00Z");
  while (cur <= last) {
    keys.push(unit === "month" ? cur.toISOString().slice(0, 7) : cur.toISOString().slice(0, 10));
    if (unit === "day") cur.setUTCDate(cur.getUTCDate() + 1);
    else if (unit === "week") cur.setUTCDate(cur.getUTCDate() + 7);
    else cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return keys;
}


export default function Dashboard() {
  const [data, setData] = useState<RedditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [metric, setMetric] = useState<Metric>("upvotes");
  const [somaFilter, setSomaFilter] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  useEffect(() => {
    async function load() {
      try {
        // Fetch static JSON (deployed via scrape script)
        const res = await fetch("/data.json");
        if (!res.ok) throw new Error("No data yet — run: npm run scrape");
        const json = await res.json();
        if (!json.posts?.length && !json.comments?.length) {
          throw new Error("No data yet — run: npm run scrape");
        }
        setData(json);

        // The account posts in bursts, so a fixed 30D default can land on a
        // stretch with nothing in it and look like the scrape is broken.
        // Open on the narrowest range that actually holds something.
        const newest = Math.max(
          0,
          ...(json.posts || []).map((p: RedditPost) => p.createdUtc),
          ...(json.comments || []).map((c: RedditComment) => c.createdUtc)
        );
        const ageDays = (Date.now() / 1000 - newest) / 86400;
        const firstWithData = TIME_RANGES.find((r) => RANGE_DAYS[r.key] >= ageDays);
        setTimeRange(firstWithData ? firstWithData.key : "all");
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const cutoff = useMemo(() => {
    const now = Date.now() / 1000;
    return now - RANGE_DAYS[timeRange] * 86400;
  }, [timeRange]);

  const { posts, comments } = useMemo(() => {
    if (!data) return { posts: [], comments: [] };
    let p = data.posts.filter((x) => x.createdUtc >= cutoff);
    let c = data.comments.filter((x) => x.createdUtc >= cutoff);
    if (somaFilter) {
      p = p.filter((x) => x.mentionsSoma);
      c = c.filter((x) => x.mentionsSoma);
    }
    if (kindFilter === "posts") c = [];
    if (kindFilter === "comments") p = [];
    return { posts: p, comments: c };
  }, [data, cutoff, somaFilter, kindFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(
    () => ({
      upvotes:
        posts.reduce((s, p) => s + p.score, 0) +
        comments.reduce((s, c) => s + c.score, 0),
      commentsReceived: posts.reduce((s, p) => s + p.numComments, 0),
      postCount: posts.length,
      commentCount: comments.length,
    }),
    [posts, comments]
  );

  const { chartData, bucketUnit } = useMemo(() => {
    const all = [...posts, ...comments];
    const nowCST = toCSTDateString(new Date());
    if (!all.length) return { chartData: [], bucketUnit: "day" as Bucket };

    const days = all.map((x) => toCSTDateString(new Date(x.createdUtc * 1000)));
    const firstCST = days.sort()[0];
    const spanDays =
      (Date.now() - new Date(firstCST + "T12:00:00Z").getTime()) / 86400000;
    const unit = bucketFor(Math.min(spanDays, RANGE_DAYS[timeRange]));

    const map = new Map<string, { posts: number; comments: number }>();
    const bump = (ts: number, key: "posts" | "comments") => {
      const k = bucketKey(toCSTDateString(new Date(ts * 1000)), unit);
      const cur = map.get(k) || { posts: 0, comments: 0 };
      cur[key]++;
      map.set(k, cur);
    };
    for (const p of posts) bump(p.createdUtc, "posts");
    for (const c of comments) bump(c.createdUtc, "comments");

    const startCST =
      timeRange === "all"
        ? firstCST
        : toCSTDateString(new Date(Date.now() - RANGE_DAYS[timeRange] * 86400000));

    const rows = fillBuckets(startCST, nowCST, unit).map((k) => {
      const v = map.get(k) || { posts: 0, comments: 0 };
      return { date: bucketLabel(k, unit), raw: k, posts: v.posts, comments: v.comments };
    });

    return { chartData: rows, bucketUnit: unit };
  }, [posts, comments, timeRange]);

  const subreddits = useMemo(() => {
    const map = new Map<
      string,
      { upvotes: number; comments: number; count: number }
    >();
    for (const p of posts) {
      const cur = map.get(p.subreddit) || {
        upvotes: 0,
        comments: 0,
        count: 0,
      };
      cur.upvotes += p.score;
      cur.comments += p.numComments;
      cur.count++;
      map.set(p.subreddit, cur);
    }
    for (const c of comments) {
      const cur = map.get(c.subreddit) || {
        upvotes: 0,
        comments: 0,
        count: 0,
      };
      cur.upvotes += c.score;
      cur.count++;
      map.set(c.subreddit, cur);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) =>
        metric === "comments"
          ? b.comments - a.comments
          : b.upvotes - a.upvotes
      );
  }, [posts, comments, metric]);

  const activity = useMemo(() => {
    const items = [
      ...posts.map((p) => ({
        type: "post" as const,
        label: p.title,
        sub: p.subreddit,
        score: p.score,
        ts: p.createdUtc,
        soma: p.mentionsSoma,
        link: p.permalink,
      })),
      ...comments.map((c) => ({
        type: "comment" as const,
        label: c.body.slice(0, 120) + (c.body.length > 120 ? "..." : ""),
        sub: c.subreddit,
        score: c.score,
        ts: c.createdUtc,
        soma: c.mentionsSoma,
        link: c.permalink,
      })),
    ];
    return items.sort((a, b) => b.ts - a.ts);
  }, [posts, comments]);



  const chartMax = Math.max(
    ...chartData.map((d) => Math.max(d.posts, d.comments)),
    1
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-zinc-600 text-sm">Loading Reddit data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-sm">
          <p className="text-red-400 text-sm mb-2">Failed to load data</p>
          <p className="text-zinc-600 text-xs">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 text-xs text-orange-500 hover:text-orange-400 underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-zinc-900/95 border border-zinc-700/50 rounded-lg px-3 py-2 shadow-2xl backdrop-blur-sm">
        <p className="text-zinc-500 text-[11px] mb-1">{label}</p>
        {payload.map((entry: any) => (
          <p
            key={entry.dataKey}
            className="text-zinc-50 text-sm font-semibold tabular-nums"
          >
            {entry.value.toLocaleString()}{" "}
            <span className="text-zinc-500 font-normal">{entry.dataKey}</span>
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-2 h-2 rounded-full bg-orange-500 animate-shimmer" />
              <h1 className="text-lg font-semibold tracking-tight">
                Reddit Analytics
              </h1>
            </div>
            <p className="text-zinc-600 text-[13px] pl-[18px]">
              u/Bulky-Possibility216{" "}
              <span className="text-zinc-700 mx-1">·</span>
              Updated {data ? timeAgo(data.fetchedAt) : "..."}
            </p>
          </div>
          <a
            href="https://reddit.com/user/Bulky-Possibility216"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-zinc-600 hover:text-zinc-300 transition-colors border border-zinc-800/60 rounded-lg px-3 py-1.5 hover:border-zinc-700"
          >
            View Profile ↗
          </a>
        </div>

        {/* ── Controls ── */}
        <div className="flex flex-wrap items-center gap-2.5 mb-8">
          <div className="flex bg-zinc-900/40 border border-zinc-800/40 rounded-lg p-0.5">
            {TIME_RANGES.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTimeRange(key)}
                className={`px-3.5 py-1.5 text-[11px] font-medium rounded-md transition-all duration-200 ${
                  timeRange === key
                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-zinc-800/50" />

          <div className="flex bg-zinc-900/40 border border-zinc-800/40 rounded-lg p-0.5">
            {METRICS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setMetric(key)}
                className={`px-3.5 py-1.5 text-[11px] font-medium rounded-md transition-all duration-200 ${
                  metric === key
                    ? "bg-orange-500/12 text-orange-400"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-zinc-800/50" />

          <button
            onClick={() => setSomaFilter(!somaFilter)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg border transition-all duration-200 ${
              somaFilter
                ? "bg-orange-500/8 text-orange-400 border-orange-500/25"
                : "text-zinc-600 border-zinc-800/50 hover:border-zinc-700 hover:text-zinc-400"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full transition-colors ${somaFilter ? "bg-orange-400" : "bg-zinc-700"}`}
            />
            Soma mentions
          </button>

          <div className="flex bg-zinc-900/40 border border-zinc-800/40 rounded-lg p-0.5">
            {KIND_FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setKindFilter(key)}
                className={`px-3.5 py-1.5 text-[11px] font-medium rounded-md transition-all duration-200 ${
                  kindFilter === key
                    ? "bg-blue-500/12 text-blue-400"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {[
            {
              label: "Total Upvotes",
              value: stats.upvotes,
              sub: `~${posts.length > 0 ? Math.round(stats.upvotes / Math.max(posts.length + comments.length, 1)) : 0} avg`,
            },
            {
              label: "Comments Received",
              value: stats.commentsReceived,
              sub: `on ${stats.postCount} posts`,
            },
            {
              label: "Posts Made",
              value: stats.postCount,
              sub: `${subreddits.length} subreddits`,
            },
            {
              label: "Comments Made",
              value: stats.commentCount,
              sub: `${stats.commentCount > 0 ? Math.round((comments.filter((c) => c.score > 1).length / stats.commentCount) * 100) : 0}% upvoted`,
            },
          ].map(({ label, value, sub }) => (
            <div
              key={label}
              className="bg-[#111116] border border-[#1c1c24] rounded-xl p-4 hover:border-[#2a2a35] transition-colors duration-200"
            >
              <p className="text-zinc-600 text-[11px] font-medium tracking-wide uppercase mb-2.5">
                {label}
              </p>
              <p className="text-[28px] font-bold tabular-nums tracking-tight leading-none mb-1">
                {value.toLocaleString()}
              </p>
              <p className="text-zinc-700 text-[11px]">{sub}</p>
            </div>
          ))}
        </div>

        {/* ── Main Chart ── */}
        <div className="bg-[#111116] border border-[#1c1c24] rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[13px] font-medium text-zinc-400">
              Posting frequency
            </h2>
            <span className="text-[11px] text-zinc-700 tabular-nums">
              {chartData.length} {bucketUnit}s
            </span>
          </div>

          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 5, right: 5, bottom: 0, left: -10 }}
              >
                <defs>
                  <linearGradient
                    id="chartGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="#f97316"
                      stopOpacity={0.2}
                    />
                    <stop
                      offset="100%"
                      stopColor="#f97316"
                      stopOpacity={0}
                    />
                  </linearGradient>
                  <linearGradient id="chartGradBlue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#1c1c24"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#3f3f46", fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#3f3f46", fontSize: 10 }}
                  width={35}
                  domain={[0, Math.ceil(chartMax * 1.15)]}
                  allowDecimals={false}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ stroke: "#27272a", strokeWidth: 1 }}
                />
                {kindFilter !== "comments" && (
                  <Area
                    type="monotone"
                    dataKey="posts"
                    stroke="#f97316"
                    strokeWidth={1.5}
                    fill="url(#chartGrad)"
                    dot={false}
                    activeDot={{
                      r: 3.5,
                      fill: "#f97316",
                      stroke: "#111116",
                      strokeWidth: 2,
                    }}
                  />
                )}
                {kindFilter !== "posts" && (
                  <Area
                    type="monotone"
                    dataKey="comments"
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                    fill="url(#chartGradBlue)"
                    dot={false}
                    activeDot={{
                      r: 3.5,
                      fill: "#3b82f6",
                      stroke: "#111116",
                      strokeWidth: 2,
                    }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Bottom Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Subreddit Breakdown */}
          <div className="lg:col-span-2 bg-[#111116] border border-[#1c1c24] rounded-xl p-5">
            <h2 className="text-[13px] font-medium text-zinc-400 mb-5">
              By Subreddit
            </h2>
            <div className="space-y-3.5">
              {subreddits.map((sub, i) => {
                const val =
                  metric === "comments" ? sub.comments : sub.upvotes;
                const maxVal = Math.max(
                  ...subreddits.map((s) =>
                    metric === "comments" ? s.comments : s.upvotes
                  ),
                  1
                );
                return (
                  <div key={sub.name} className="group">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] text-zinc-500 group-hover:text-zinc-300 transition-colors">
                        r/{sub.name}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-700">
                          {sub.count} items
                        </span>
                        <span className="text-[11px] text-zinc-400 tabular-nums font-medium w-8 text-right">
                          {val}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-zinc-900/80 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: `${(val / maxVal) * 100}%`,
                          backgroundColor:
                            SUB_COLORS[i % SUB_COLORS.length],
                          opacity: 0.6,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              {subreddits.length === 0 && (
                <p className="text-zinc-700 text-xs text-center py-8">
                  No data
                </p>
              )}
            </div>
          </div>

          {/* All Activity */}
          <div className="lg:col-span-3 bg-[#111116] border border-[#1c1c24] rounded-xl p-5">
            <h2 className="text-[13px] font-medium text-zinc-400 mb-4">
              All Activity
            </h2>
            <div className="space-y-0.5 max-h-[420px] overflow-y-auto pr-1">
              {activity.map((item, i) => (
                <a
                  key={`${item.type}-${i}`}
                  href={`https://reddit.com${item.link}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-900/40 transition-colors group"
                >
                  <div
                    className={`mt-0.5 w-[18px] h-[18px] rounded flex items-center justify-center text-[9px] font-bold shrink-0 ${
                      item.type === "post"
                        ? "bg-orange-500/10 text-orange-500/70"
                        : "bg-blue-500/10 text-blue-500/70"
                    }`}
                  >
                    {item.type === "post" ? "P" : "C"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-zinc-400 group-hover:text-zinc-200 truncate transition-colors leading-snug">
                      {item.label}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-zinc-700">
                        r/{item.sub}
                      </span>
                      <span className="text-[10px] text-zinc-800">·</span>
                      <span className="text-[10px] text-zinc-600 tabular-nums">
                        {item.score} pts
                      </span>
                      {item.soma && (
                        <>
                          <span className="text-[10px] text-zinc-800">·</span>
                          <span className="text-[10px] text-orange-600 font-medium">
                            soma
                          </span>
                        </>
                      )}
                      <span className="text-[10px] text-zinc-800 ml-auto">
                        {timeAgo(item.ts * 1000)}
                      </span>
                    </div>
                  </div>
                </a>
              ))}
              {activity.length === 0 && (
                <p className="text-zinc-700 text-xs text-center py-8">
                  No activity
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="mt-10 pt-6 border-t border-zinc-900/80">
          <p className="text-[11px] text-zinc-800 text-center">
            Data updated by the local scrape script (npm run scrape:push) via the
            Arctic Shift archive
          </p>
        </div>
      </div>
    </div>
  );
}
