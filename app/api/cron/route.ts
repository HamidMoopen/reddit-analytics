import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  // Cron endpoint — hits the reddit API route to refresh the edge cache
  try {
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    const res = await fetch(`${base}/api/reddit`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json({
      success: true,
      posts: data.posts?.length ?? 0,
      comments: data.comments?.length ?? 0,
      fetchedAt: new Date(data.fetchedAt).toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
