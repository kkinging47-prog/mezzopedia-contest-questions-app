import { supabaseAdmin } from '@/lib/supabaseAdmin';

const defaultConfig = {
  welcomeTitle: 'Welcome to the Mezzopedia National Mathematics Contest',
  welcomeSubtitle: 'Ghana\'s mathematics champions start here.',
  welcomeBody: 'Read the instructions carefully, sign in with your unique code, and complete the test within the allowed time.',
  bannerImageUrl: '',
  certificateTemplateUrl: '',
  activePhase: 'Stage 1',
  registrationDeadline: '2026-07-25'
};

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('app_config')
    .select('key,value')
    .in('key', Object.keys(defaultConfig));

  if (error) {
    return Response.json({ success: true, config: defaultConfig });
  }

  const config = { ...defaultConfig } as Record<string, string>;
  for (const row of data || []) {
    if (row.key in config) config[row.key] = String(row.value ?? '');
  }

  return Response.json({ success: true, config });
}
