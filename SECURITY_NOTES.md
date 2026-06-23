# Security Notes for Mezzopedia Contest App

This project has a safer deployment foundation than the original Figma Make preview:

- Admin and participant sessions use HTTP-only cookies.
- Participant/admin passwords are verified server-side with bcrypt.
- Correct answers are never sent to the browser during the test.
- Results are scored on the server.
- Supabase service role key is used only in API routes, not in the frontend.
- Public table access is locked with Row Level Security and no public policies.
- Proctoring events are logged to the database for admin review.

## Must-do before national launch

1. **Rate limiting:** Protect `/api/admin/login`, `/api/auth/participant`, and `/api/results/lookup`.
2. **Captcha:** Add Cloudflare Turnstile/reCAPTCHA to admin and participant login forms.
3. **Contest window locks:** Add start/end time validation on the server.
4. **Admin roles:** Move admin users into a database table with individual accounts and audit logs.
5. **Secure storage:** Avoid public buckets for sensitive assets. Contest images can be public; private data must not be public.
6. **Device pilot:** Test with iOS Safari, Chrome Android, Edge/Chrome desktop, slow networks and low-end phones.
7. **Data backup:** Export participants/questions/results before each stage.
8. **Monitoring:** Keep Supabase and Vercel logs open during the contest.
9. **Incident plan:** Prepare a manual fallback if some students cannot access camera/mic due to device policy.

## Important limitation

Browser-based proctoring cannot guarantee complete cheat prevention. It can deter and flag suspicious behavior, but determined users can bypass browser checks. Treat proctoring logs as review signals, not absolute proof.
