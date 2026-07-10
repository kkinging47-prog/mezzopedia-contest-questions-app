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

create policy if not exists "Public read contest assets"
  on storage.objects
  for select
  using (bucket_id = 'contest-assets');

create policy if not exists "Service uploads contest assets"
  on storage.objects
  for insert
  with check (bucket_id = 'contest-assets');

create policy if not exists "Service updates contest assets"
  on storage.objects
  for update
  using (bucket_id = 'contest-assets')
  with check (bucket_id = 'contest-assets');
