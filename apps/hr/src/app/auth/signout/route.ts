import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase";

// POST only, so a link or image elsewhere cannot sign someone out.
export async function POST(request: NextRequest) {
  const db = await createClient();
  await db.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
