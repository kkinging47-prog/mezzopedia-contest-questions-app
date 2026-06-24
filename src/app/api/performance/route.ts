import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { DEFAULT_PERFORMANCE_SETTINGS, sanitizePerformanceSettings } from '@/lib/performance';

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('app_config')
    .select('value')
    .eq('key', 'performanceSettings')
    .maybeSingle();

  if (error) {
    return Response.json({ success: true, settings: DEFAULT_PERFORMANCE_SETTINGS });
  }

  return Response.json({ success: true, settings: sanitizePerformanceSettings(data?.value) });
}
