-- Supabase Storage fix for certificate/question image uploads
-- Safe to run more than once. It creates/updates the public contest-assets bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contest-assets',
  'contest-assets',
  true,
  15728640,
  array['image/png','image/jpeg','image/jpg','image/webp','image/gif']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 15728640,
  allowed_mime_types = array['image/png','image/jpeg','image/jpg','image/webp','image/gif'];

-- Public bucket read access, so certificate templates can load in generated PDFs.
drop policy if exists "Public read contest assets" on storage.objects;
create policy "Public read contest assets"
  on storage.objects
  for select
  using (bucket_id = 'contest-assets');

-- Upload/update access for authenticated admin API using the service role key.
-- The service role bypasses RLS, but these policies also keep the bucket usable if RLS checks are applied.
drop policy if exists "Service uploads contest assets" on storage.objects;
create policy "Service uploads contest assets"
  on storage.objects
  for insert
  with check (bucket_id = 'contest-assets');

drop policy if exists "Service updates contest assets" on storage.objects;
create policy "Service updates contest assets"
  on storage.objects
  for update
  using (bucket_id = 'contest-assets')
  with check (bucket_id = 'contest-assets');
