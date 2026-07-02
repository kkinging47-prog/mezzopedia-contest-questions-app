import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { DEFAULT_CERTIFICATE_SETTINGS } from '@/lib/certificatePdf';

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('app_config')
    .select('value')
    .eq('key', 'certificateSettings')
    .maybeSingle();
  if (error) return Response.json({ success: true, settings: DEFAULT_CERTIFICATE_SETTINGS });
  return Response.json({ success: true, settings: data?.value || DEFAULT_CERTIFICATE_SETTINGS });
}
