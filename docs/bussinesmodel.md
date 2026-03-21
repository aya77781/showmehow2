# ShowMe AI — Business Model & Strategy

---

## Executive Summary

**ShowMe AI** is a SaaS platform that turns any topic into a personalized video tutorial in under 2 minutes. Instead of reading a wall of text or watching a generic YouTube video, users get a step-by-step video narrated by their own AI avatar — generated on demand, always up to date, always personalized.

**Market:** $370B global e-learning market, growing 14% YoY.
**Beachhead:** Individual developers and tech professionals who learn by doing.
**Moat:** Personalized avatar + automated Playwright capture = a tutorial product that no individual creator can compete with on speed or personalization.

---

## Problem & Solution

### The Learning Gap

| Situation | What exists | What's missing |
|---|---|---|
| You don't know how to do X | ChatGPT gives you text | Visual, step-by-step guidance |
| You search YouTube | Generic 20-min video | Personalized to your exact case |
| You use an AI agent | Does it for you | You learn nothing |
| You read documentation | Dense, no visuals | Engaging, narrated walkthrough |

### Our Solution

> An AI that generates a personalized video tutorial for any topic — in under 2 minutes — narrated by your own avatar.

**Core loop:**
1. User types a topic
2. Agent fetches WikiHow context + navigates the real UI with Playwright
3. Claude maps each step from screenshots
4. VEED renders the video with the user's avatar
5. User watches, learns, and keeps it in their library

---

## Business Model

### Revenue Streams

#### 1. Freemium SaaS (B2C)

| Plan | Price | Limits | Target |
|---|---|---|---|
| **Free** | €0/month | 5 tutorials/month, basic avatar, public library | Individual learners, trial users |
| **Pro** | €12/month | Unlimited tutorials, premium avatar, multilingual, PDF export, private library | Developers, professionals, creators |
| **Power** | €29/month | Everything in Pro + team sharing, analytics, custom avatar voice, priority rendering | Power users, educators, freelancers |

#### 2. Teams & Enterprise (B2B)

| Plan | Price | Includes | Target |
|---|---|---|---|
| **Teams** | €49/seat/month | All Power features + admin dashboard, onboarding flows, branded avatar | Startups, SMBs |
| **Enterprise** | Custom | SSO, private deployment, custom integrations, SLA | Corporates, training companies |

#### 3. Marketplace (Phase 2)

- Users can **publish tutorials publicly**
- Other users can **purchase or subscribe** to tutorial packs
- ShowMe takes 30% commission
- Example: "Complete React Native course — 40 tutorials — €29"

#### 4. API Access (Phase 3)

- Developers integrate ShowMe's tutorial engine into their own products
- Pay-per-render: €0.50 per video generated
- Target: LMS platforms, documentation tools, SaaS onboarding flows

---

## Unit Economics

### B2C Pro (€12/month)

| Metric | Value |
|---|---|
| VEED render cost / tutorial | ~€0.15 |
| Claude API cost / tutorial | ~€0.05 |
| Playwright infra / tutorial | ~€0.02 |
| **Total COGS / tutorial** | **~€0.22** |
| Avg tutorials/user/month (Pro) | 15 |
| **Total COGS / user / month** | **~€3.30** |
| **Gross margin** | **~72%** |

### B2B Teams (€49/seat/month)

| Metric | Value |
|---|---|
| Avg tutorials / seat / month | 10 |
| COGS / seat / month | ~€2.20 |
| **Gross margin** | **~95%** |

---

## Go-To-Market Strategy

### Phase 1 — Hackathon (Day 0)

- Win or place at AMS GenAI & Video Hackathon
- Post demo video on LinkedIn + Twitter/X
- Submit to Product Hunt immediately after
- Target: 500 signups in first week from hackathon buzz

### Phase 2 — Developer Beachhead (Month 1–3)

**Why developers first:**
- High willingness to pay for tools
- High volume of "how do I do X" queries
- Share tools with their networks
- Validate the product loop fast

**Channels:**
- Product Hunt launch
- Hacker News "Show HN" post
- Dev Twitter/X + LinkedIn
- Reddit: r/webdev, r/learnprogramming, r/SideProject
- Dev Discord communities

**Content strategy:**
- Post 1 generated tutorial daily on LinkedIn showing the product in action
- "We just generated a tutorial for X in 90 seconds" — viral format
- Comparison posts: ShowMe vs YouTube vs ChatGPT for learning

### Phase 3 — LATAM Expansion (Month 3–6)

**Why LATAM:**
- Massive underserved market for quality tech content in Spanish/Portuguese
- YouTube tutorials in Spanish are often outdated or low quality
- Strong appetite for affordable professional upskilling tools
- Santiago's network and cultural context = unfair advantage

**Channels:**
- TikTok + Instagram Reels: short clips of tutorials being generated
- Spanish-language LinkedIn
- Partnerships with LATAM tech bootcamps and communities
- Localized avatar voices (Argentine Spanish, Mexican Spanish, Brazilian Portuguese)

### Phase 4 — B2B Pivot (Month 6–12)

**Target buyers:**
- HR/L&D teams replacing written onboarding with video
- SaaS companies that need automated product tutorials for their users
- Bootcamps and online education platforms
- Consulting firms that deliver training

**Sales motion:**
- Inbound from freemium users who work at companies
- Outbound to L&D managers on LinkedIn
- Partner with HR tech platforms (Workday, BambooHR integrations)

---

## Competitive Landscape

| Competitor | What they do | Why we win |
|---|---|---|
| **Loom** | Screen recording + sharing | No AI, no automation, no avatar, manual work |
| **Scribe** | Auto-generates written guides from screen recording | Text only, no video, no avatar |
| **Synthesia** | AI avatar video generation | No tutorial intelligence, no Playwright, you write the script manually |
| **Tango** | Step-by-step screenshot guides | Static screenshots, no video, no narration |
| **YouTube** | Video tutorials | Not personalized, not instant, not specific to your version/context |
| **ChatGPT** | Text instructions | No video, no visual proof, no avatar |

**Our unique combination that no competitor has:**
- ✅ Automated screen capture (Playwright)
- ✅ AI-generated narration (Claude)
- ✅ Personalized avatar (VEED)
- ✅ Pre-loaded context (WikiHow)
- ✅ On-demand, instant generation

---

## Metrics & KPIs

### North Star Metric
**Tutorials Generated per Month** — reflects product usage, COGS, and value delivered.

### Acquisition
| Metric | Month 1 | Month 3 | Month 6 |
|---|---|---|---|
| Signups | 500 | 3,000 | 15,000 |
| Free → Pro conversion | 5% | 8% | 12% |
| Paid users | 25 | 240 | 1,800 |

### Revenue
| Metric | Month 1 | Month 3 | Month 6 |
|---|---|---|---|
| MRR | €300 | €2,880 | €21,600 |
| ARR | €3,600 | €34,560 | €259,200 |

### Engagement
| Metric | Target |
|---|---|
| Tutorials/user/month (active) | > 8 |
| Day-7 retention | > 40% |
| Day-30 retention | > 25% |
| NPS | > 50 |

---

## Funding Strategy

### Hackathon → Bootstrapped (Month 0–6)
- Use prize money + early revenue to fund infra
- Keep costs minimal: VEED + Anthropic API + Vercel
- Target: €5K MRR before raising

### Pre-Seed (Month 6–12)
- Target: €300K–€500K
- From: Dutch/European angel investors + accelerators (YC, Antler, EF)
- Use of funds: team (1 engineer + 1 growth), marketing, infra scaling

### Seed (Month 12–24)
- Target: €1.5M–€2M
- Trigger: €20K+ MRR, clear B2B traction
- Use of funds: sales team, enterprise features, LATAM expansion

---

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| VEED API limits / cost increase | Medium | High | Evaluate alternatives (HeyGen, D-ID), negotiate volume pricing |
| Playwright blocked by bot detection | High | Medium | WikiHow fallback, demo on safe sites, use stealth plugins |
| Anthropic API cost at scale | Medium | Medium | Batch calls, compress screenshots, cache common topics |
| Low free→paid conversion | Medium | High | Strong free tier to drive sharing, aggressive onboarding emails |
| Competitor copies the idea | Medium | Medium | Speed to market, avatar personalization as moat, community |

---

## 12-Month Roadmap

### Q1 2026 (Months 1–3) — Launch
- [ ] Hackathon demo + launch
- [ ] Product Hunt launch
- [ ] Core agent working: WikiHow + Playwright + Claude + VEED
- [ ] Basic dashboard: generate + view tutorials
- [ ] Free + Pro plans live
- [ ] 500 users, 25 paying

### Q2 2026 (Months 4–6) — Growth
- [ ] LATAM content push (Spanish/Portuguese)
- [ ] Tutorial library + sharing features
- [ ] Marketplace alpha
- [ ] Mobile-friendly dashboard
- [ ] 3,000 users, 240 paying

### Q3 2026 (Months 7–9) — B2B
- [ ] Teams plan launch
- [ ] Admin dashboard + analytics
- [ ] Custom branded avatars
- [ ] First 5 B2B clients
- [ ] API beta for developers

### Q4 2026 (Months 10–12) — Scale
- [ ] Pre-seed raise
- [ ] Enterprise plan
- [ ] API public launch
- [ ] 15,000 users, 1,800 paying
- [ ] €20K+ MRR

---

## Team

| Role | Who | Responsibility |
|---|---|---|
| **Technical Lead** | Santiago | MCP agent, Playwright, Claude integration, Node.js backend |
| **Product & GTM** | Co-founder | Business strategy, landing page, onboarding, marketing |

**Advisors needed:**
- L&D industry expert (for B2B positioning)
- LATAM SaaS operator (for expansion)

---

## The Pitch in 3 Sentences

The way people learn new skills online is broken — text is hard to follow, YouTube is generic, and AI agents do the work for you without teaching you anything.

ShowMe AI generates a personalized video tutorial for any topic in under 2 minutes, narrated by your own AI avatar, built from real screenshots of the actual UI.

We are the missing layer between knowing what to do and knowing how to do it.

---

*ShowMe AI — Built at AMS GenAI & Video Hackathon 2026*
*Contact: [your email] | showme.ai*