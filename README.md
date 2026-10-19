# HireFlow – Mini Applicant Tracking System

Built for the **EarlyJobs.ai Full Stack Developer Intern** assignment.

**Live demo:** _add your deployed URL_ · **Demo video:** _add link_

## Features
- Candidate CRUD with server-side validation (required fields, email format, unique email)
- Hiring pipeline: Applied → Screening → Interview → Offer → Hired / Rejected, drag-and-drop Kanban board + table view, full stage history per candidate
- Search (name, email, role, skills, source), stage/role filters, sorting (`GET /api/candidates?q=&stage=&role=&sort=`)
- Dashboard: totals, active, new this week, hire rate, stage breakdown, funnel conversion, by source, by role (`GET /api/stats`)
- CSV export, dark mode, responsive layout

## Tech
Node.js + Express REST API, SQLite (built-in node:sqlite, transactions, indexes, foreign keys), vanilla JS frontend, Docker.

## Run locally (Node 22.5 or newer)
```bash
npm install
npm start        # http://localhost:3000 (seeds 10 sample candidates)
```

## API
| Method | Route | Purpose |
|---|---|---|
| GET | /api/candidates | list, search, filter, sort |
| POST | /api/candidates | create |
| GET/PUT/DELETE | /api/candidates/:id | read, update, delete |
| PATCH | /api/candidates/:id/stage | move stage (records history) |
| GET | /api/stats | dashboard metrics |

## Deploy (Render)
New Web Service → connect repo → Build `npm install` → Start `npm start`, and set env var `NODE_VERSION=22`. For persistent data attach a disk and set `DB_PATH=/data/ats.db`. A `Dockerfile` is included for any Docker host.

## Design decisions
- SQLite keeps setup to zero config; the data layer is isolated so it can swap to Postgres.
- Stage changes and history are written in one transaction so the audit trail never drifts.
- All input is validated and normalised on the server, and rendered output is HTML-escaped.
