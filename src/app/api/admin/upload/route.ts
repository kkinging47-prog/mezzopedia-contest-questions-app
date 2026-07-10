import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { jsonError } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);
const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const BUCKET = 'contest-assets';

function cleanFolder(value: FormDataEntryValue | null) {
  return String(value || 'uploads').replace(/[^a-z0-9-_]/gi, '').toLowerCase() || 'uploads';
}

function getFileExtension(file: File) {
  const fromName = file.name.split('.').pop()?.toLowerCase() || '';
  if (ALLOWED_EXTENSIONS.has(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'image/gif') return 'gif';
  return 'jpg';
}

function getContentType(file: File) {
  if (file.type === 'image/jpg') return 'image/jpeg';
  if (ALLOWED_TYPES.has(file.type)) return file.type;
  const ext = getFileExtension(file);
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

async function ensureBucket() {
  const { data: bucket } = await supabaseAdmin.storage.getBucket(BUCKET).catch(() => ({ data: null } as any));
  if (bucket) return;
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_FILE_SIZE,
    allowedMimeTypes: Array.from(ALLOWED_TYPES)
  });
  if (error && !error.message.toLowerCase().includes('already exists')) throw error;
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return jsonError('Unauthorized.', 401);

  const form = await request.formData();
  const file = form.get('file');
  const folder = cleanFolder(form.get('folder'));

  if (!(file instanceof File)) return jsonError('No file uploaded. Choose a PNG, JPG or WEBP file and try again.');

  const ext = getFileExtension(file);
  const contentType = getContentType(file);
  if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_TYPES.has(contentType)) return jsonError('Only PNG, JPG, WEBP and GIF images are allowed.');
  if (file.size > MAX_FILE_SIZE) return jsonError('File is too large. Please upload an image that is 15MB or less.');

  try {
    await ensureBucket();
  } catch (error: any) {
    return jsonError(`Could not prepare Supabase Storage bucket: ${error?.message || 'unknown error'}. Run supabase/run-this-storage-upload-fix.sql in Supabase SQL Editor, then try again.`, 500);
  }

  const filename = `${folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(filename, buffer, {
    contentType,
    cacheControl: '3600',
    upsert: true
  });

  if (error) {
    return jsonError(`${error.message}. If this is a storage bucket error, run supabase/run-this-storage-upload-fix.sql in Supabase SQL Editor, then try again.`, 500);
  }

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(filename);
  if (!data.publicUrl) return jsonError('Image uploaded but no public URL was returned from Supabase Storage.', 500);

  return Response.json({ success: true, url: data.publicUrl, path: filename, size: file.size, contentType });
}
