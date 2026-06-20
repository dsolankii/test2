import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  return NextResponse.json(
    {
      ok: true,
      status: "disabled",
      message: "Background prefetch is disabled. Use Next 50 to run the next strict LLM batch.",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
