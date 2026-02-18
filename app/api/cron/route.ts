import { fetchRedditData } from "@/lib/reddit";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const data = await fetchRedditData();
    return NextResponse.json({
      success: true,
      posts: data.posts.length,
      comments: data.comments.length,
      fetchedAt: new Date(data.fetchedAt).toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
