# Design: Nudlers MCP Skills for Hermes Agent

**Date**: 2026-05-17  
**Author**: Yoni Gelfman  
**Status**: Implemented

---

## Problem

Hermes agent connects to Nudlers via MCP but has no guidance on which of the 12 tools to use, what parameters they expect, or how to handle common financial workflows.

## Solution

Two Hermes skills in `skills/` directory (project-local; user installs to Hermes manually):

| Skill | File | Purpose |
|---|---|---|
| `nudlers-data-access` | `skills/nudlers-data-access/SKILL.md` | API reference layer — all 12 tools with exact parameters |
| `nudlers-financial-analyst` | `skills/nudlers-financial-analyst/SKILL.md` | Workflow layer — how to handle 4 use cases |

## Architecture

Two-layer design:
- **`nudlers-data-access`** is the reference layer — what tools exist, exact parameter names, date formats, error codes
- **`nudlers-financial-analyst`** is the behavior layer — step-by-step workflows for financial queries, budgets, subscriptions, and trends

This separation means:
- Adding a new MCP tool only requires updating `nudlers-data-access`
- Workflow improvements only require updating `nudlers-financial-analyst`

## Use Cases Covered

1. **שאילתות פיננסיות** — category breakdown, drill-down, search, raw transaction list
2. **ניהול תקציב** — budget vs actual, overage alerts, status reporting
3. **ניהול מינויים** — recurring payments, installments vs subscriptions, monthly cost calc
4. **ניתוח ותובנות** — month-over-month comparison, trend identification

## Installation

Copy skills to Hermes:
```bash
cp -r skills/nudlers-data-access ~/.hermes/skills/yonis/
cp -r skills/nudlers-financial-analyst ~/.hermes/skills/yonis/
```

Start a new Hermes session (skills are cached in-session).

## Key Design Decisions

- **Billing cycle over calendar month**: Skills explain that `billingCycle: "YYYY-MM"` uses day 10 as cutoff, not calendar month boundaries
- **Write-op safety**: `add_manual_expense` is the only write tool; `nudlers-financial-analyst` requires user confirmation before calling it
- **Hebrew-first presentation**: Financial analyst skill instructs Hermes to respond in Hebrew with ₪ formatting
- **Error handling**: Both skills cover vault locked (401), stale data, and no-accounts scenarios

## MCP Connection

- URL: `http://localhost:6969/api/mcp`
- Transport: SSE (Server-Sent Events)
- Requires Nudlers app running locally
