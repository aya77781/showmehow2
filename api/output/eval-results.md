# ShowMe AI — Eval Results

> Date: 2026-03-21
> Method: Claude Code CLI + Playwright MCP (`claude -p --dangerously-skip-permissions`)

---

## Test Results Summary

| Test | Steps | Screenshots | Narration | Time | Status |
|------|-------|-------------|-----------|------|--------|
| GitHub (repo creation) | 8 | 8/8 (100%) | 8/8 (100%) | ~180s | PASS |
| Vercel (deploy website) | 8 | 8/8 (100%) | 8/8 (100%) | ~120s | PASS |
| Notion (create page) | 0 | 0 | 0 | FAIL | FAIL — MCP not loaded |

---

## Eval Criteria & Scores

### GitHub — "How to create a GitHub repository"

| Criteria | Score | Detail |
|----------|-------|--------|
| Step count (3-10) | 10/10 | 8 steps |
| Screenshot coverage | 10/10 | 8/8 screenshots (39-129KB each) |
| Narration quality | 9/10 | All steps have 2-3 sentence descriptions, clear and actionable |
| Step title quality | 9/10 | All descriptive, verb-first |
| Flow coherence | 7/10 | Got stuck on login flow — 6/8 steps are login-related, only 1 step shows actual repo creation |
| Image variety | 6/10 | Steps 1-6 are similar login page screenshots (~39KB each), steps 7-8 have distinct pages |
| **TOTAL** | **51/60 (85%)** | |

**Notes:**
- Playwright navigated to github.com/new but hit the login wall
- Steps 1-6 cover login/signup instead of the actual repo creation process
- Step 8 (repo creation form) is the most useful screenshot
- **Fix needed:** Pre-authenticate or use a public-facing flow

### Vercel — "How to deploy a website on Vercel"

| Criteria | Score | Detail |
|----------|-------|--------|
| Step count (3-10) | 10/10 | 8 steps |
| Screenshot coverage | 10/10 | 8/8 screenshots (248-522KB each) |
| Narration quality | 10/10 | Rich descriptions mentioning specific UI elements |
| Step title quality | 10/10 | Clear, descriptive, action-oriented |
| Flow coherence | 8/10 | Logical progression from landing → templates → deploy |
| Image variety | 8/10 | Progressively different pages, scrolling through content |
| **TOTAL** | **56/60 (93%)** | |

**Notes:**
- Best result — no login required, public-facing page
- Good progression through the deployment flow
- Screenshots show real Vercel UI with actual templates
- Narrations reference specific elements (Next.js, Vite, etc.)

### Notion — FAILED

| Criteria | Score | Detail |
|----------|-------|--------|
| All | 0/60 | Playwright MCP tools not available in subprocess |

**Root cause:** MCP server config is project-scoped but `claude -p` subprocess doesn't inherit it properly.

---

## Method Comparison: WikiHow vs Playwright MCP

| Criteria | WikiHow Fetch | Playwright MCP |
|----------|--------------|----------------|
| Speed | 2-3s | 120-180s |
| Screenshots | 0% (API doesn't return images) | 100% (real UI) |
| Narration | 0% (titles only) | 100% (2-3 sentences each) |
| Topic coverage | Limited to WikiHow articles | Any URL works |
| Accuracy | Generic/indirect articles | Exact UI of the target site |
| Cost | Free (no API calls) | Claude Code tokens |
| **Overall Score** | **53%** | **89% avg (GitHub+Vercel)** |

**Winner: Playwright MCP** — despite being slower, it produces real screenshots and narrations that are directly usable for video generation.

---

## Issues Found

1. **MCP not loading in subprocesses** — Notion test failed because Playwright MCP wasn't available. Need to ensure MCP config is passed correctly.
2. **Login walls** — GitHub test got stuck on login. Need strategy for auth-required flows (pre-auth cookies, or pick public flows).
3. **Scrolling ≠ interaction** — Vercel test mostly scrolled instead of clicking through a real deploy flow. Need better prompting to drive actual interactions.

## Recommendations

1. **Use Playwright MCP** as primary method — WikiHow is too limited
2. **Pick public-facing URLs** for demos (no login required)
3. **Improve prompt** to prioritize clicking/interacting over scrolling
4. **Add MCP config** globally or pass it explicitly to subprocesses
5. **Best demo topics:** Vercel deploy, GitHub Pages, public tools with no auth wall
