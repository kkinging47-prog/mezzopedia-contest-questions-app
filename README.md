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
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## 5. Deploy in Vercel

1. Go to Vercel → Add New Project.
2. Import the GitHub repository.
3. Add the environment variables listed above.
4. Deploy.

## Important production notes before the national contest

This rebuild is much stronger than a Figma Make preview because data is stored in Supabase and sensitive logic runs server-side. Before the live national competition, still do a dedicated security phase:

- Add rate limiting to participant/admin login endpoints.
- Add Cloudflare Turnstile or reCAPTCHA to stop brute-force login attempts.
- Use a separate production Supabase project.
- Run a full pilot on Android phones, iPhones, tablets, Chromebooks and laptops.
- Create admin roles instead of one environment-based admin account.
- Add a locked contest window so students can only begin during approved dates/times.
- Review Supabase logs and Vercel logs during test runs.
- Have backup internet/power/admin support on contest day.

## CSV participant import format

Paste lines in this order:

```csv
category,name,usercode,password,payment_status
Primary 6,Ama Mensah,MZP001,secret123,paid
JHS 1,Kofi Mensah,MZP002,secret456,unpaid
```

For production, use strong unique passwords/codes and share them privately with participants.

## 2026 Security/Admin Upgrade

This build includes question editing, Primary 5 category, math-symbol entry buttons, dropdowns for payment/stage, result sorting, an AI Proctoring admin tab, repeat-login detection, duplicate option blocking, and participant login field clearing.

For an existing Supabase project, run `supabase/schema.sql` again in Supabase SQL Editor. It includes migration-safe `alter table ... add column if not exists` lines.

Important browser limitation: screen evidence requires participant screen-share permission. Browsers cannot secretly monitor other apps without that permission.


## Windows npm install note
This package intentionally does not include `package-lock.json` so Windows installs packages from the public npm registry instead of any machine-specific cached registry. If `npm install` fails, delete `node_modules` and run `npm install --no-audit --no-fund --legacy-peer-deps`.
