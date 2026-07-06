-- P0 · 0-2 final step: close the last anon write path.
--
-- The iOS Shortcut now reports through the device-report Edge Function
-- (shared secret; verified landing data at 2026-07-06 03:03 UTC), so the
-- anon-key INSERT policy on device_status is no longer needed by anything.
-- With this drop the anon role has zero read or write surface in public.

drop policy if exists "Allow insert for anon" on public.device_status;
