# Traeco — Agent Optimization Platform

AI agent cost intelligence platform. USC LavaLab startup, April 2026.

## Repo structure

```
backend/       FastAPI + SQLAlchemy API
frontend/      Next.js 14 + Tailwind dashboard
website/       Static HTML marketing site (index, pricing, integrate)
.github/       GitHub Actions (deploy-website.yml → GitHub Pages)
```

## Website (`website/`)

Three connected static HTML pages — no build step, no framework.

- `index.html` — main landing (hero, trace story, features, CTA)
- `pricing.html` — pricing tiers + FAQ
- `integrate.html` — SDK setup steps + provider grid

**Design tokens (shared across all 3 pages):**
```css
--bg:#050506; --g:#0E714A; --g2:#1BA86F; --g3:#2de080; --tx:#EFEFEF;
--mu:rgba(239,239,239,.42); --di:rgba(239,239,239,.18);
--mono:'SF Mono','Fira Code','Cascadia Code',monospace;
--ease:cubic-bezier(.16,1,.3,1);
```

**Logo SVG (use this exact version everywhere):**
```html
<svg width="20" height="22" viewBox="0 0 52 56" fill="none">
  <defs><radialGradient id="lg0" cx="35%" cy="25%" r="75%">
    <stop offset="0%" stop-color="#2bdb82"/>
    <stop offset="45%" stop-color="#1BA86F"/>
    <stop offset="100%" stop-color="#084830"/>
  </radialGradient></defs>
  <circle cx="16" cy="12" r="12" fill="url(#lg0)"/>
  <circle cx="37" cy="14" r="10" fill="url(#lg0)"/>
  <circle cx="11" cy="36" r="9" fill="url(#lg0)"/>
  <circle cx="34" cy="42" r="8" fill="url(#lg0)"/>
  <ellipse cx="24" cy="27" rx="11" ry="13" fill="url(#lg0)"/>
</svg>
```

**Typography rules:**
- Headings: font-weight 600, letter-spacing -.028em (not tighter, not bolder)
- No custom cursor (cursor:none is banned)
- Font: Clash Display via `https://api.fontshare.com/v2/css?f[]=clash-display@400,500,600,700&display=swap`

**Word cycle animation (hero):**
- Per-character blur-wipe reveal — each `.sc` span: opacity 0 + translateY(72%) + blur(6px) → transitions to visible with 42ms stagger per char
- Exit: `#sw.sw-exit` keyframe — blur + scale up + opacity 0 in 180ms
- Words: "bleeding money.", "flying blind.", "scaling wrong."
- Space chars must use `.sc-sp` with `white-space:pre`

**Hosting:** GitHub Pages via `.github/workflows/deploy-website.yml`. Deploys `website/` on push to main. Enable once at: repo Settings → Pages → Source: GitHub Actions.

## Pricing model

- Starter: **20% of verified savings**, up to 5 agents
- Growth: **15% of verified savings**, up to 25 agents  
- Enterprise: Custom rate, unlimited agents
- Zero savings = zero charge

## Brand voice

"Stop paying for AI agent waste." Direct, technical, confident. Not "you might save money" — specific dollar amounts, confidence scores, exact function names.
