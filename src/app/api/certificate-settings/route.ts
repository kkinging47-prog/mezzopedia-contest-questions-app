import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { DEFAULT_CERTIFICATE_SETTINGS, normalizeCertificateSettings } from '@/lib/certificatePdf';
import { certificateDateForStage } from '@/lib/certificateDate';

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('app_config')
    .select('key,value')
    .in('key', ['certificateSettings', 'stageSettings']);

  if (error) return Response.json({ success: true, settings: DEFAULT_CERTIFICATE_SETTINGS });

  const config: Record<string, any> = {};
  for (const row of data || []) config[row.key] = row.value;

  const settings = normalizeCertificateSettings((config.certificateSettings || DEFAULT_CERTIFICATE_SETTINGS));
  settings.certificateDate = certificateDateForStage(config.stageSettings, '', settings.certificateDate);

  return Response.json({ success: true, settings });
}
