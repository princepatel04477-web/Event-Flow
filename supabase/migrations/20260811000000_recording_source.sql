-- =====================================================================
-- call_recordings: add source column (harvested / voice_note)
-- =====================================================================
-- Needed by H5 (post-call voice note) so the extraction prompt can weight
-- them differently: a voice note is staff paraphrasing, a harvested call is
-- the guest's own words. The enum is deliberately two-valued — if more
-- sources appear later (manual upload, etc.), add them then.
-- =====================================================================

do $$ begin
  create type app.recording_source as enum ('harvested', 'voice_note');
exception when duplicate_object then null;
end $$;

alter table public.call_recordings
  add column if not exists source app.recording_source not null default 'harvested';

comment on column public.call_recordings.source is
  'How this recording was obtained. ''harvested'' = pulled from the OEM dialer '
  'folder (guest''s own words). ''voice_note'' = staff summarised the call aloud '
  'after hanging up (staff paraphrasing). The extraction prompt weights these '
  'differently.';
