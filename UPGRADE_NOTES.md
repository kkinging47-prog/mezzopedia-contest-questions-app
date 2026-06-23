# Mezzopedia Contest App Upgrade Notes

This version adds the requested admin and proctoring improvements.

## Added

- Edit already-saved questions from the admin Questions table.
- Mathematical symbol toolbar for question text and all answer options.
- Primary 5 category.
- Saved question images no longer remain visibly selected on the question form after saving.
- Question order reshuffles per participant session/login while keeping saved answers by question ID.
- Duplicate answer option text is blocked on the client and server.
- Participant payment status dropdown: `paid` / `unpaid`.
- Participant stage dropdown: `Stage 1`, `Stage 2`, `Stage 3`.
- Results ordering by category/class, highest score and fastest time.
- Admin AI Proctoring tab with events and evidence links.
- Repeat/multiple login detection for the same usercode. The newest login invalidates older browser sessions.
- Participant sign-in fields are cleared and autocomplete is disabled as much as browsers allow.
- Proctoring evidence upload support for face and screen snapshots.

## Important Supabase SQL update

If you already ran the old schema, open `supabase/schema.sql`, copy the full file and run it again in Supabase SQL Editor. The file includes `create table if not exists` and `alter table add column if not exists` helpers, so it is safe for an existing project.

## Browser proctoring limits

A web app cannot secretly see all external apps, record the full device, or capture the screen unless the participant grants screen-sharing permission. This version requires camera/microphone, and on supported desktop browsers it also requests screen sharing. It logs suspicious signs such as tab switching, blur/external focus, fullscreen exit, split/small window, copy/paste, screenshot key attempts, devtools-like panels, surrounding audio spikes, possible spoken answer clues and covered/blocked camera.

## Storage warning

Ten-second face/screen evidence snapshots can consume storage quickly during a national contest. Before launch, estimate the number of participants and test duration, then decide whether to keep 10-second snapshots on for all candidates or only for flagged candidates.
