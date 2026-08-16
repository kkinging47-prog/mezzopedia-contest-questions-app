import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONFIG_KEY = 'liveFinalsVisibility';

function normalizeVisibility(value: any) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    isOpen: Boolean(raw.isOpen || raw.resultsOpen || raw.visible),
    updatedAt: String(raw.updatedAt || ''),
    note: String(raw.note || 'Controls whether candidates can see Live Finals promotion or not-selected messages on the Results page.')
  };
}

async function readVisibility() {
  const { data, error } = await supabaseAdmin
    .from('app_config')
    .select('key,value')
    .eq('key', CONFIG_KEY)
    .maybeSingle();

  if (error) return { settings: normalizeVisibility({}), error };
  return { settings: normalizeVisibility(data?.value), error: null };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const { settings, error } = await readVisibility();
  if (error) return jsonError(error.message, 500);
  return Response.json({ success: true, settings });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const isOpen = Boolean(body.isOpen || body.resultsOpen || body.visible);
  const now = new Date().toISOString();
  const value = normalizeVisibility({
    isOpen,
    updatedAt: now,
    note: isOpen
      ? 'Live Finals promotion and not-selected messages are visible to candidates on the Results page.'
      : 'Live Finals promotion and not-selected messages are hidden from candidates on the Results page.'
  });

  const { error } = await supabaseAdmin
    .from('app_config')
    .upsert({ key: CONFIG_KEY, value, updated_at: now }, { onConflict: 'key' });

  if (error) return jsonError(error.message, 500);

  await supabaseAdmin.from('admin_audit_logs').insert({
    action: isOpen ? 'OPEN_LIVE_FINALS_RESULTS_VISIBILITY' : 'CLOSE_LIVE_FINALS_RESULTS_VISIBILITY',
    entity_type: 'app_config',
    details: {
      key: CONFIG_KEY,
      isOpen,
      note: value.note
    }
  }).then(() => null);

  return Response.json({ success: true, settings: value });
}
