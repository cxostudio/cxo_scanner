import { createClient } from "@supabase/supabase-js";
import { noStoreFetch } from "@/lib/supabaseFetch";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: noStoreFetch } } // a cached answer would mean Supabase is never pinged
  );

  const { error } = await supabase
    .from("user_progress")
    .select("id")
    .limit(1);

  if (error) console.error("Keep-alive failed:", error.message);

  return Response.json({ ok: !error, at: new Date().toISOString() });
}
