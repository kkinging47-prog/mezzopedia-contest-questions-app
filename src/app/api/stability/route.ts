import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { DEFAULT_RUNTIME_SETTINGS } from '@/lib/runtimeSettings';

export async function GET() {
  const { data } = await supabaseAdmin.from('app_config').select('value').eq('key', 'runtimeSettings').limit(1);
  const value = data?.[0]?.value;
  let settings = DEFAULT_RUNTIME_SETTINGS;
  if (value && typeof value === 'object') settings = { ...DEFAULT_RUNTIME_SETTINGS, ...(value as Record<string, unknown>) };
  if (typeof value === 'string') {
    try { settings = { ...DEFAULT_RUNTIME_SETTINGS, ...JSON.parse(value) }; } catch {}
  }
  return Response.json({ success: true, settings });
}
