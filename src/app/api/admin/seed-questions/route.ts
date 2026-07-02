import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, safeText } from '@/lib/utils';
import { buildSeedQuestions } from '@/lib/seedQuestions';
import { CONTEST_STAGES } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const OLD_TOPIC_PREFIXES = ['[Algebra] ', '[Aptitude] ', '[Statistics] ', '[Geometry] '];

function normalizedText(text: string) {
  return OLD_TOPIC_PREFIXES.reduce((value, prefix) => value.startsWith(prefix) ? value.slice(prefix.length) : value, text);
}

async function insertRowsInChunks(rows: ReturnType<typeof buildSeedQuestions>) {
  const chunkSize = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabaseAdmin.from('questions').insert(chunk);
    if (error) return { error, inserted };
    inserted += chunk.length;
  }
  return { error: null, inserted };
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  try {
    const body = await request.json().catch(() => ({}));
    const phase = safeText(body.phase || 'Stage 1');
    if (!(CONTEST_STAGES as readonly string[]).includes(phase)) return jsonError('Invalid stage selected.');

    const seeded = buildSeedQuestions(phase);

    // Do not use a very large .in('question_text', [...]) filter here.
    // With 50 questions per category it can make the Supabase URL too long and return Bad Request.
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('questions')
      .select('category,phase,question_text')
      .eq('phase', phase);

    if (existingError) return jsonError(existingError.message, 500);

    const existingKeys = new Set((existing || []).map((row: any) => `${row.category}|${row.phase}|${normalizedText(row.question_text)}`));
    const rowsToInsert = seeded.filter(q => !existingKeys.has(`${q.category}|${q.phase}|${q.question_text}`));

    if (!rowsToInsert.length) {
      return Response.json({ success: true, inserted: 0, skipped: seeded.length, message: `Seed questions already exist for ${phase}.` });
    }

    const result = await insertRowsInChunks(rowsToInsert);
    if (result.error) return jsonError(result.error.message, 500);

    return Response.json({ success: true, inserted: result.inserted, skipped: seeded.length - rowsToInsert.length, phase });
  } catch (error) {
    console.error('Question seeding failed:', error);
    return jsonError('Could not seed questions. Please redeploy and try again.', 500);
  }
}
