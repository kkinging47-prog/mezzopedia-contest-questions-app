# Mezzopedia National Mathematics Contest App

This is a GitHub/Vercel-ready rebuild of the Figma Make contest app. It uses **Next.js + Supabase** so admin uploads, participants, questions, proctoring logs and results are saved permanently and do not disappear when the admin page is closed.

## Main features

- Public welcome page editable by admin
- Participant sign-in by category, usercode and password
- Passwords are stored as bcrypt hashes, not plain text
- One active attempt per participant, with resume support until submission
- Completed users cannot retake the test
- Randomized test questions per participant
- 70-minute countdown timer
- One-question-at-a-time test interface with skipped-question navigation
- Server-side scoring so correct answers are not exposed to participants
- Basic proctoring logs: camera/mic permission, tab switching, copy/paste blocking, suspicious browser panels and keyboard shortcuts
- Student results lookup with print/download and rule-based AI-style analysis
- Admin dashboard for welcome settings, participants, questions, results export and certificates
- Supabase Storage support for uploaded images
- High-traffic contest settings for large simultaneous login days

## 1. Create Supabase database

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Paste and run `supabase/schema.sql`.
4. Optional: run `supabase/sample_seed.sql` for demo data only.

## 2. Prepare admin password hash

On your computer, install dependencies and generate a password hash:

```bash
npm install
npm run hash:password
```

Copy the generated hash. You will use it as `ADMIN_PASSWORD_HASH` in Vercel.

## 3. Add environment variables in Vercel

Add these in Vercel Project Settings → Environment Variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
JWT_SECRET=use-a-long-random-secret-at-least-32-characters
ADMIN_EMAIL=your-admin-email@example.com
ADMIN_PASSWORD_HASH=the-bcrypt-hash-you-generated
NEXT_PUBLIC_APP_NAME=Mezzopedia National Mathematics Contest
```

Do **not** expose `SUPABASE_SERVICE_ROLE_KEY` in the browser or commit a real `.env` file to GitHub.

## 4. Push to GitHub

```bash
git init
git add .
git commit -m "Initial Mezzopedia contest app"
git branch -M main
```
