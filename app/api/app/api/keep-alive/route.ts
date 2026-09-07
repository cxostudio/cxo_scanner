import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await supabase
    .from("user_progress")
    .select("id")
    .limit(1);

  if (error) console.error("Keep-alive failed:", error.message);

  return Response.json({ ok: !error, at: new Date().toISOString() });
}
