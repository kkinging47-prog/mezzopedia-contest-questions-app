import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const BUCKET = 'contest-assets';

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const form = await request.formData();
  const file = form.get('file');
  const folder = String(form.get('folder') || 'uploads').replace(/[^a-z0-9-_]/gi, '').toLowerCase() || 'uploads';

  if (!(file instanceof File)) return jsonError('No file uploaded.');
  if (!ALLOWED_TYPES.has(file.type)) return jsonError('Only PNG, JPG, WEBP and GIF images are allowed.');
  if (file.size > MAX_FILE_SIZE) return jsonError('File must be 5MB or less.');

  await supabaseAdmin.storage.createBucket(BUCKET, { public: true }).catch(() => null);

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const filename = `${folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(filename, buffer, {
    contentType: file.type,
    upsert: false
  });

  if (error) return jsonError(error.message, 500);
  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(filename);
  return Response.json({ success: true, url: data.publicUrl, path: filename });
}
