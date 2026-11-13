-- Migration: 20261113100000_call_kind.sql
-- Distinguish first intake calls from reminder calls so reminders are not recorded or transcribed.

alter table public.call_attempts add column if not exists call_kind text not null
  default 'first' constraint call_attempts_call_kind_check check (call_kind in ('first','reminder'));

comment on column public.call_attempts.call_kind is 'Distinguishes first calls that record RSVP details from reminder calls that skip audio recording and transcription.';
