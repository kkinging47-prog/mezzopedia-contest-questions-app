import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, safeText } from '@/lib/utils';
import { buildSeedQuestions } from '@/lib/seedQuestions';
import { CONTEST_STAGES } from '@/lib/constants';

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const phase = safeText(body.phase || 'Stage 1');
  if (!(CONTEST_STAGES as readonly string[]).includes(phase)) return jsonError('Invalid stage selected.');

  const seeded = buildSeedQuestions(phase);
  const texts = seeded.map(q => q.question_text);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('questions')
    .select('category,phase,question_text')
    .eq('phase', phase)
    .in('question_text', texts);

  if (existingError) return jsonError(existingError.message, 500);

  const existingKeys = new Set((existing || []).map((row: any) => `${row.category}|${row.phase}|${row.question_text}`));
  const rowsToInsert = seeded.filter(q => !existingKeys.has(`${q.category}|${q.phase}|${q.question_text}`));

  if (!rowsToInsert.length) {
    return Response.json({ success: true, inserted: 0, skipped: seeded.length, message: `Seed questions already exist for ${phase}.` });
  }

  const { error } = await supabaseAdmin.from('questions').insert(rowsToInsert);
  if (error) return jsonError(error.message, 500);

  return Response.json({ success: true, inserted: rowsToInsert.length, skipped: seeded.length - rowsToInsert.length, phase });
}
