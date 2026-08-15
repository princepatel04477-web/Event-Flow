---
name: Royal Ivory & Gold
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#4d4635'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#7f7663'
  outline-variant: '#d0c5af'
  surface-tint: '#735c00'
  primary: '#735c00'
  on-primary: '#ffffff'
  primary-container: '#d4af37'
  on-primary-container: '#554300'
  inverse-primary: '#e9c349'
  secondary: '#5d5e61'
  on-secondary: '#ffffff'
  secondary-container: '#e2e2e5'
  on-secondary-container: '#636467'
  tertiary: '#006b59'
  on-tertiary: '#ffffff'
  tertiary-container: '#6ec2ad'
  on-tertiary-container: '#004f41'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffe088'
  primary-fixed-dim: '#e9c349'
  on-primary-fixed: '#241a00'
  on-primary-fixed-variant: '#574500'
  secondary-fixed: '#e2e2e5'
  secondary-fixed-dim: '#c6c6c9'
  on-secondary-fixed: '#1a1c1e'
  on-secondary-fixed-variant: '#454749'
  tertiary-fixed: '#9df3dc'
  tertiary-fixed-dim: '#81d6c0'
  on-tertiary-fixed: '#00201a'
  on-tertiary-fixed-variant: '#005143'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  display-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Be Vietnam Pro
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  title-md:
    fontFamily: Be Vietnam Pro
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Be Vietnam Pro
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 40px
  container-max-width: 1440px
---

## Brand & Style
The design system embodies the precision and elegance of high-end event operations. It targets professional event planners and luxury venue managers who require a tool that feels as sophisticated as the galas they curate. 

The aesthetic is **Corporate Modern with a Minimalist Luxury** lean. It prioritizes clarity, spaciousness, and high-end precision. The emotional response is one of calm authority and "back-of-house" efficiency. By replacing harsh blacks with deep charcoals and utilizing a warm ivory base, the interface maintains a premium, soft-touch professional feel without the clinical coldness of standard SaaS platforms.

## Colors
The palette is rooted in **Warm Ivory (#F8F9FA)** to create a welcoming, high-end surface that reduces eye strain during long operational shifts. 

- **Primary Gold (#D4AF37):** Used sparingly for key actions, brand moments, and active states to denote premium status and focus.
- **Deep Charcoal/Navy (#1A1C1E):** Serves as the primary text and high-emphasis color, providing legible contrast while appearing softer than pure black.
- **Deep Teal/Emerald (#006D5B):** Used for success states and confirmation, aligning with a "luxury jewel tone" logic rather than standard "traffic light" green.
- **Neutral Grays:** Derived from a warm saturation to ensure consistency with the Ivory surface.

## Typography
**Be Vietnam Pro** is utilized across all tiers for its contemporary, friendly, yet professional character. 

- **Headlines:** Use SemiBold (600) or Bold (700) weights with slightly tightened letter spacing for a structured, editorial look.
- **Body Text:** Standardized on 16px for readability, using the Regular (400) weight. 
- **Labels:** Utilize Medium or SemiBold weights with an uppercase transformation and increased letter spacing (0.05em) for secondary metadata and table headers to mimic luxury signage.
- **Hierarchy:** Maintain a clear distinction between "Display" (for branding/marketing) and "Functional" (for operations and data) typography.

## Layout & Spacing
The layout follows a **Fixed-Fluid hybrid grid** model. On desktop, content is contained within a 1440px max-width container to maintain a composed, organized appearance.

- **Rhythm:** An 8px base unit (the "Step") governs all spacing.
- **Desktop Grid:** 12-column system with 24px gutters. Use generous margins (40px) to evoke the "whitespace" found in luxury layouts.
- **Mobile Grid:** 4-column system with 16px gutters and margins.
- **Operational Density:** For data-heavy views (event schedules, guest lists), use a "Compact" mode where the base unit scales to 4px to maximize information density without sacrificing clarity.

## Elevation & Depth
Elevation is conveyed through **Tonal Layering** and **Subtle Ambient Shadows**. We avoid heavy, dark shadows in favor of light, tinted depth.

- **Planes:** The base layer is `Surface-dim`. Active containers and cards use `Surface-bright` (White).
- **Shadows:** Use extra-diffused shadows with a 2%–4% opacity, tinted with the primary charcoal color. Shadows should feel like a soft glow rather than a hard drop.
- **Borders:** Use 1px borders in `Surface-dim` for structural separation on `Surface-bright` elements. This provides "precision" lines characteristic of technical blueprints or luxury stationary.

## Shapes
The shape language is defined by **Rounded Eight (8px)** corners. This provides a balance between the "sharpness" of professional architecture and the "softness" of modern premium interfaces.

- **Buttons & Inputs:** Follow the 8px (0.5rem) standard.
- **Cards & Modals:** Use `rounded-lg` (16px/1rem) for larger containers to create a distinct structural hierarchy.
- **Status Pills:** Use fully rounded (pill-shaped) ends to differentiate them from interactive buttons.

## Components
- **Buttons:** Primary buttons use a Champagne Gold background with White text for maximum prominence. Secondary buttons use a Ghost style (Charcoal border and text) to maintain a clean aesthetic.
- **Input Fields:** Use the Ivory base with a 1px Charcoal border (20% opacity). On focus, the border transitions to Gold.
- **Chips/Status Tags:** For "Confirmed" states, use the Deep Teal at 10% opacity for the background and 100% for the text. This maintains the "Luxury Jewel" aesthetic.
- **Cards:** Elevate cards slightly on hover using the ambient shadow profile. Ensure card headers use the `label-md` uppercase style for a formal look.
- **Navigation:** Vertical navigation is preferred for operations. Use the Deep Charcoal background for the sidebar with Gold accents for the active state indicator.
- **Data Tables:** Use horizontal rules only (no vertical lines) in `Surface-dim` to maintain an airy, sophisticated flow.