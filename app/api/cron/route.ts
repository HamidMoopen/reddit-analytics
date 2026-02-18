import { NextResponse } from "next/server";

// Health check endpoint — data updates happen via local scrape + git push
export async function GET() {
  return NextResponse.json({
    status: "ok",
    note: "Data is updated via local scrape script. Run: npm run scrape:push",
  });
}
