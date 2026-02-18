"use client";

import { useState, useMemo, useEffect } from "react";
import { RedditData } from "@/lib/types";
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
type Metric = "upvotes" | "comments" | "impressions";

const TIME_RANGES: { key: TimeRange; label: string }[] = [
  { key: "7d", label: "7D" },
  { key: "14d", label: "14D" },
  { key: "30d", label: "30D" },
  { key: "all", label: "All" },
];

const METRICS: { key: Metric; label: string }[] = [
  { key: "upvotes", label: "Upvotes" },
  { key: "comments", label: "Comments" },
  { key: "impressions", label: "Impressions" },
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

function fillDateRange(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  while (cur <= e) {
    dates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export default function Dashboard() {
  const [data, setData] = useState<RedditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [metric, setMetric] = useState<Metric>("upvotes");
  const [somaFilter, setSomaFilter] = useState(false);
  const [commentsOnly, setCommentsOnly] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/reddit");
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const cutoff = useMemo(() => {
    const now = Date.now() / 1000;
    const days: Record<TimeRange, number> = {
      "7d": 7,
      "14d": 14,
      "30d": 30,
      all: 9999,
    };
    return now - days[timeRange] * 86400;
  }, [timeRange]);

  const { posts, comments } = useMemo(() => {
    if (!data) return { posts: [], comments: [] };
    let p = data.posts.filter((x) => x.createdUtc >= cutoff);
    let c = data.comments.filter((x) => x.createdUtc >= cutoff);
    if (somaFilter) {
      p = p.filter((x) => x.mentionsSoma);
      c = c.filter((x) => x.mentionsSoma);
    }
    if (commentsOnly) p = [];
    return { posts: p, comments: c };
  }, [data, cutoff, somaFilter, commentsOnly]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const chartData = useMemo(() => {
    const map = new Map<string, { upvotes: number; comments: number }>();

    for (const p of posts) {
      const day = new Date(p.createdUtc * 1000).toISOString().split("T")[0];
      const cur = map.get(day) || { upvotes: 0, comments: 0 };
      cur.upvotes += p.score;
      cur.comments += p.numComments;
      map.set(day, cur);
    }
    for (const c of comments) {
      const day = new Date(c.createdUtc * 1000).toISOString().split("T")[0];
      const cur = map.get(day) || { upvotes: 0, comments: 0 };
      cur.upvotes += c.score;
      cur.comments += 1;
      map.set(day, cur);
    }

    const now = new Date();
    const days = { "7d": 7, "14d": 14, "30d": 30, all: 90 }[timeRange];
    const start =
      timeRange === "all" && map.size > 0
        ? new Date(Array.from(map.keys()).sort()[0])
        : new Date(now.getTime() - days * 86400000);

    return fillDateRange(start, now).map((d) => {
      const v = map.get(d) || { upvotes: 0, comments: 0 };
      return {
        date: new Date(d).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        raw: d,
        upvotes: v.upvotes,
        comments: v.comments,
      };
    });
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
    return items.sort((a, b) => b.ts - a.ts).slice(0, 25);
  }, [posts, comments]);

  const activeMetricKey =
    metric === "impressions" ? "upvotes" : (metric as "upvotes" | "comments");
  const chartMax = Math.max(...chartData.map((d) => d[activeMetricKey]), 1);

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
        <p className="text-zinc-500 text-[11px]">{label}</p>
        <p className="text-zinc-50 text-sm font-semibold tabular-nums">
          {payload[0].value.toLocaleString()}{" "}
          <span className="text-zinc-500 font-normal">{metric}</span>
        </p>
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

          <button
            onClick={() => setCommentsOnly(!commentsOnly)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg border transition-all duration-200 ${
              commentsOnly
                ? "bg-blue-500/8 text-blue-400 border-blue-500/25"
                : "text-zinc-600 border-zinc-800/50 hover:border-zinc-700 hover:text-zinc-400"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full transition-colors ${commentsOnly ? "bg-blue-400" : "bg-zinc-700"}`}
            />
            Comments only
          </button>
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
              {metric === "impressions"
                ? "Impressions"
                : metric === "upvotes"
                  ? "Upvotes"
                  : "Comments"}{" "}
              over time
            </h2>
            <span className="text-[11px] text-zinc-700 tabular-nums">
              {chartData.length} days
            </span>
          </div>

          {metric === "impressions" ? (
            <div className="h-[280px] flex items-center justify-center">
              <div className="text-center max-w-sm">
                <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-3">
                  <svg
                    className="w-5 h-5 text-zinc-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
                <p className="text-zinc-400 text-sm mb-1">
                  Impressions not available via API
                </p>
                <p className="text-zinc-600 text-xs leading-relaxed">
                  Reddit doesn&apos;t expose view counts publicly. Check your{" "}
                  <a
                    href="https://www.reddit.com/user/Bulky-Possibility216"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-orange-500/70 hover:text-orange-400 underline underline-offset-2"
                  >
                    Reddit Creator Dashboard
                  </a>{" "}
                  for impression data.
                </p>
              </div>
            </div>
          ) : (
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
                  <Area
                    type="monotone"
                    dataKey={activeMetricKey}
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
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
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

          {/* Recent Activity */}
          <div className="lg:col-span-3 bg-[#111116] border border-[#1c1c24] rounded-xl p-5">
            <h2 className="text-[13px] font-medium text-zinc-400 mb-4">
              Recent Activity
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
            Data refreshes every 30 minutes via ISR · Cron configured for Vercel
            Pro · Impressions require Reddit Creator Dashboard
          </p>
        </div>
      </div>
    </div>
  );
}
