import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  try {
    const { error } = await supabaseAdmin.from('app_config').select('key').limit(1);
    const latencyMs = Date.now() - started;
    if (error) {
      return Response.json({ success: false, status: 'supabase_error', latencyMs, error: error.message }, { status: 500 });
    }
    return Response.json({ success: true, status: 'ok', latencyMs });
  } catch (error) {
    return Response.json({ success: false, status: 'server_error', error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
