# Duplicate merge — final (19 Nov 2026, night)

Nothing is left to merge in Miami or Orlando.

- **Orlando:** 849 merged, 0 left.
- **Miami:** 10,468 merged, 0 left. The last 3 pairs (Mr Jeff Cleaners, United Janitors, Centre for Braces — both contacts
  held their own open deal) were merged by hand in GHL by Eric; the site already follows the surviving contacts.
- **Tags:** the "duplicate" tag was left on 14 kept Miami contacts (12 from automatic merges where the tag removal did not
  stick, 2 carried over by the manual merges). Removed 19 Nov night; Miami now has 0 contacts with the tag.
- **Orlando tag check:** 2 contacts "TruGreen Lawn Care" still carry the tag; they are not listings and not in the merge
  queue (probably hidden by the competitor or area rules) — left alone.
- **Cause to fix later:** `ghlRemoveTag` ignores a failed call, so under heavy parallel load the "duplicate" tag can stay on a
  kept contact. Re-check with a GHL search for tag "duplicate" after any big merge run.
