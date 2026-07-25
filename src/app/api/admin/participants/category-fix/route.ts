import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { DEFAULT_CATEGORIES } from '@/lib/constants';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError, safeText } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type CategoryUpdateInput = {
  usercode?: unknown;
  user_code?: unknown;
  unique_code?: unknown;
  code?: unknown;
  category?: unknown;
  class?: unknown;
  level?: unknown;
};

const VALID_CATEGORIES = new Set(DEFAULT_CATEGORIES.map(category => category.toLowerCase()));

function codeKey(value: unknown) {
  return safeText(value).toLowerCase();
}

function normalizeCategory(value: unknown) {
  const raw = safeText(value);
  if (!raw) return '';
  const exact = DEFAULT_CATEGORIES.find(category => category.toLowerCase() === raw.toLowerCase());
  return exact || '';
}

function isValidContestCategory(value: unknown) {
  return VALID_CATEGORIES.has(safeText(value).toLowerCase());
}

function cleanUpdate(row: CategoryUpdateInput) {
  const usercode = safeText(row.usercode || row.user_code || row.unique_code || row.code);
  const category = normalizeCategory(row.category || row.class || row.level);
  if (!usercode || !category) return null;
  return { usercode, category };
}

async function invalidCategoryRows() {
  const { data, error } = await supabaseAdmin
    .from('participants')
    .select('id,name,usercode,category,payment_status,contest_stage,created_at')
    .order('created_at', { ascending: false });
  if (error) return { rows: [], error };
  const rows = (data || []).filter((row: any) => !isValidContestCategory(row.category));
  return { rows, error: null };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const { rows, error } = await invalidCategoryRows();
  if (error) return jsonError(error.message, 500);

  return Response.json({
    success: true,
    validCategories: DEFAULT_CATEGORIES,
    invalidCount: rows.length,
    invalidRows: rows.slice(0, 200)
  });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const body = await request.json().catch(() => ({}));
  const action = safeText(body.action || 'updateByCodes');
  const now = new Date().toISOString();

  if (action === 'bulkUpdateInvalid') {
    const targetCategory = normalizeCategory(body.targetCategory || body.category);
    if (!targetCategory) return jsonError('Choose a valid contest category before updating.', 400);

    const { rows, error } = await invalidCategoryRows();
    if (error) return jsonError(error.message, 500);
    if (!rows.length) return Response.json({ success: true, updated: 0, message: 'No invalid participant categories found.' });

    let updated = 0;
    for (const row of rows) {
      const { error: updateError } = await supabaseAdmin
        .from('participants')
        .update({ category: targetCategory, updated_at: now })
        .eq('id', row.id);
      if (updateError) return jsonError(updateError.message, 500);
      updated += 1;
    }

    await supabaseAdmin.from('admin_audit_logs').insert({
      action: 'BULK_FIX_INVALID_PARTICIPANT_CATEGORIES',
      entity_type: 'participant',
      details: { targetCategory, updated }
    }).then(() => null);

    return Response.json({ success: true, updated, skipped: 0, invalidCategories: 0 });
  }

  const rawUpdates = Array.isArray(body.updates) ? body.updates : [];
  const cleaned = rawUpdates.map(cleanUpdate).filter(Boolean) as Array<{ usercode: string; category: string }>;
  if (!cleaned.length) return jsonError('No valid category updates found. Use columns: usercode and category.', 400);

  const seen = new Set<string>();
  const duplicateCodes: string[] = [];
  for (const item of cleaned) {
    const key = codeKey(item.usercode);
    if (seen.has(key)) duplicateCodes.push(item.usercode);
    seen.add(key);
  }
  if (duplicateCodes.length) {
    return jsonError(`Duplicate usercode(s) found inside the uploaded file: ${Array.from(new Set(duplicateCodes)).join(', ')}. Each code should appear once.`, 409);
  }

  let updated = 0;
  let skippedNotFound = 0;
  let skippedMultiple = 0;
  const notFound: string[] = [];
  const multipleMatches: string[] = [];

  for (const item of cleaned) {
    const { data: matches, error: findError } = await supabaseAdmin
      .from('participants')
      .select('id,usercode,name,category')
      .ilike('usercode', item.usercode)
      .limit(5);
    if (findError) return jsonError(findError.message, 500);
    if (!matches?.length) {
      skippedNotFound += 1;
      if (notFound.length < 50) notFound.push(item.usercode);
      continue;
    }
    if (matches.length > 1) {
      skippedMultiple += 1;
      if (multipleMatches.length < 50) multipleMatches.push(item.usercode);
      continue;
    }

    const { error: updateError } = await supabaseAdmin
      .from('participants')
      .update({ category: item.category, updated_at: now })
      .eq('id', matches[0].id);
    if (updateError) return jsonError(updateError.message, 500);
    updated += 1;
  }

  await supabaseAdmin.from('admin_audit_logs').insert({
    action: 'FIX_PARTICIPANT_CATEGORIES_BY_CODE',
    entity_type: 'participant',
    details: { requested: cleaned.length, updated, skippedNotFound, skippedMultiple }
  }).then(() => null);

  return Response.json({
    success: true,
    requested: cleaned.length,
    updated,
    skippedNotFound,
    skippedMultiple,
    notFound,
    multipleMatches
  });
}
