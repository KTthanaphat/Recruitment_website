# Home banner artwork

Asset: [home-recruitment-banner-v2.png](../../../public/images/home-recruitment-banner-v2.png), RGBA 2172 × 724 with genuine alpha (0–255). Created with built-in `image_gen.imagegen`, then copied unchanged into the KT project. The initial concept was adapted to a transparent right-side scene; native SVG waves supply the full 6:1 background without stretching/cropping the recruiter. [Design contract](../../design/home.md#banner); [owner](../../../src/components/dashboard/HomeView.tsx).

Flat 2D semi-chibi recruiter, laptop and three candidate cards follow the supplied `design-system.txt`. One teal selection check is illustrative; there are no fabricated ratings, metrics or text. The original banner file remains available; greeting, glass opacity, summary logic, permissions and banner height stay unchanged. No SQL changes or push/deployment.

## Final prompt set

### Initial concept

> Use case: illustration-story. Asset type: production HOME PAGE BANNER for an internal recruitment website, replacing an older banner.
> Canvas: EXACT ultra-wide 6:1 landscape, ideally 3072 x 512 pixels. A very shallow horizontal header, not a 16:9 scene. Full banner background is white with very pale cool-blue tones. Keep the LEFT 56% almost empty, quiet white/light blue, because real HTML greeting text is overlaid there later. Absolutely no baked-in words, numbers or logos anywhere.
> Composition: place the entire meaningful recruitment scene in the RIGHT 42%, with a small clear margin around it. One friendly young adult female HR recruiter, waist-up, working confidently at an open pale-blue laptop, with a compact floating panel of three simplified candidate-profile cards beside/behind her to the left of the laptop. One restrained teal checkmark on the selected candidate card communicates organized hiring. No fabricated ratings or charts. Keep the complete face, tidy hair and laptop unclipped. Three major groups maximum: recruiter with laptop, candidate-card panel, single selection check.
> Character and art direction: modern expressive flat 2D corporate vector illustration, approachable semi-chibi proportions (oversized head, compact torso, rounded shoulders, simple hands). Neat flowing deep-navy hair, warm peach skin, simple solid navy oval eyes, minimal nose, soft blush cheeks, focused friendly smile. Electric-blue #146EFA blazer with a white inner shirt; vivid-purple #411EDC secondary accents. Pale-blue/white candidate-card surfaces, navy silhouettes and horizontal pill shapes instead of writing. Match a premium unified HRIS illustration family. Mostly flat rounded geometric shapes with very subtle directional grain-gradient texture, no thick black outlines and no 3D gloss.
> Background treatment: a restrained flowing wave along the lower edge, fading vertically from white into light blue with fine subtle grain; low contrast on the left so navy text stays readable. Blue/purple can be slightly stronger beneath the right-side scene. No busy decoration in the left text area. No office environment, scenery, furniture beyond the laptop, realistic room or ground shadows.
> Avoid: words, letters, digits, logos, watermarks, embedded checkerboard, detective hat, magnifying glass, messy hair, extra people, detailed fingers or irises, photorealism, 3D/clay/plastic rendering, hard shadows, glow, dramatic lighting, dense UI, ratings, stars, noisy gradients, cropped important elements. Banner should feel welcoming, calm, professional and subtly playful.

### Transparent integration edit

> Use case: background-extraction and precise-object-edit for website banner integration. Edit the supplied new Home illustration into a transparent, close-fitted RIGHT-SIDE ARTWORK asset. Preserve the same recruiter identity and face, tidy navy hair, warm peach skin, electric-blue blazer, white shirt, laptop, three candidate cards with one teal checkmark, flat 2D corporate style and subtle grain.
> Remove ALL of the empty left text area and ALL background waves/background color. Recompose the existing meaningful elements into a wide 3:1 horizontal grouping that occupies almost the whole canvas: candidate-card panel on the left, open laptop near the middle/bottom, recruiter on the right. Keep her original seated/working-at-laptop pose and natural semi-chibi proportions; no stretching. Make the panel wider rather than stretching the woman if needed for the composition. The person, laptop and panel should be complete and unclipped, with only 2–3% transparent edge padding. The website will place this asset on the right half of a shallow 6:1 banner and draw the background separately.
> Keep mostly flat blue/purple fills and fine restrained grain-gradient texture. Absolutely no words, digits, ratings, logos, new objects, extra people, shadows, furniture, scene or environmental background. Genuine alpha transparency everywhere outside the recruiter/laptop/card grouping. Keep the friendly calm professional expression and all important forms clearly readable when reduced to about 440px wide by 150px high.

## Verification

The existing `home-aggregate-summaries.spec.ts -g "Home banner uses"` check passed (1/1), preserving returned header-scope counts and retry behavior with synthetic data. Captured and inspected desktop and Thai 360px phone views; the 6:1 banner stays shallow, the complete recruiter is visible, and greeting text remains separate/readable. TypeScript and documentation link/graph validation passed. Home preview, stylesheet and artwork served successfully from the active KT checkout. No SQL changes, push or deployment.
## Half-banner floral refinement

The recruiter illustration is explicitly contained in the right 50%; the greeting and centered blue floral motif use the left 50%. The new transparent motif renders at 12% opacity with a soft radial edge fade. Removed the greeting's backdrop blur so the faint linework remains recognizable; its translucent background opacity is unchanged. [Floral asset and built-in prompt](floral.md).

The existing Home banner aggregate/retry browser check passed (1/1). Inspected desktop and Thai 360px phone captures; greeting and artwork remain readable/complete. TypeScript and documentation validation passed. No SQL changes, push or deployment.
## Restored glass and playful flowers

Replaced the monochrome motif with the transparent, colorful [playful floral artwork](../../../public/images/home-banner-floral-playful-v2.png). It renders at 18% opacity with the existing radial fade. Restored the greeting’s pale-blue glass at 20% tint with medium backdrop blur; the motif sits above the glass and below HTML text in an isolated banner stack. The recruiter remains in the right half, and greeting/data behavior is unchanged. [Prompt and asset provenance](floral.md).

Verification: the focused Home banner aggregate/retry browser check passed (1/1) after the layer adjustment. Inspected desktop and Thai 360px phone captures; text remains readable, colorful flowers stay faint, and the recruiter is complete. TypeScript and documentation link/graph validation passed. No SQL changes, push or deployment.

## Reference-led retro floral pattern

Replaced the floral motif with [retro v3](../../../public/images/home-banner-floral-retro-v3.png), generated from the user-supplied warm botanical reference. Rounded pink, peach and orange flowers with muted olive/taupe foliage replace the earlier blue/purple treatment. The existing 18% opacity, edge fade, glass layering and 50/50 banner layout are unchanged. [Built-in prompt and provenance](floral.md). Earlier refinements above are historical; current design is owned by the linked contract.

Verification for retro v3: existing focused Home banner aggregate/retry browser check passed (1/1); inspected the rendered desktop and Thai 360px phone screenshots. TypeScript and documentation link/graph checks passed. New asset is RGBA 2172×724 with alpha range 0–255. Home and asset localhost responses verified HTTP 200 from the active KT checkout. No SQL changes, push or deployment.


## Left-fill floral composition

Retained retro v3 artwork and its warm palette. The floral layer now fills the entire left half using `object-cover`, preserves the left edge, leaves a clear elliptical opening at its center, and gradually thins toward the right. Separate CSS masks provide the opening and directional fade without editing the asset. Blue glass, 18% floral opacity, greeting behavior and the right-half recruiter are retained. Current rules remain in the [Home contract](../../design/home.md#banner).

Verification: focused Home banner aggregate/retry browser check passed (1/1). Inspected desktop and Thai 360px phone layouts: flowers reach the left edge, the center stays clear, and the rightward fade leaves the recruiter area quiet. TypeScript and documentation link/graph validation passed. KT Home preview returned HTTP 200 at http://127.0.0.1:3100/home?lang=th. No SQL changes, push or deployment.

## Airier flowers and stronger color

New [sparse v4 artwork](../../../public/images/home-banner-floral-sparse-v4.png) replaces the dense pattern with fewer, larger flowers and generous transparent gaps, retaining the warm reference palette, central opening and rightward taper. Increased floral opacity from 18% to 42% for more visible color. The greeting now stacks above the floral layer, making its existing medium backdrop blur soften the flowers under the 20% blue glass. Right-half recruiter, banner dimensions and greeting/data behavior are preserved. [Current prompt/provenance](floral.md); current contract remains in the Home design owner.

Verification for sparse v4: focused Home banner aggregate/retry browser check passed (1/1). Inspected desktop and Thai 360px phone screenshots: fewer larger flowers remain visible outside the glass, the center stays open, and the greeting's frosted surface softens the underlying floral colors. TypeScript and documentation link/graph checks passed. Asset is RGBA 2172×724 with alpha range 0–255. No SQL changes, push or deployment.

## System-palette flowers with left padding

Installed [system-palette v5](../../../public/images/home-banner-floral-system-v5.png), a built-in palette-only edit of sparse v4. Blue, purple, cyan and navy follow existing system tokens. Removed the 42% opacity reduction so exposed flowers render at full strength. Added left insets matching the banner's responsive content rhythm: 16px phone, 24px sm, 28px lg. Central opening, right fade, glass blur/tint, greeting behavior and right-half recruiter remain. [Current prompt/provenance](floral.md); detailed current rules live in the Home design contract.

Rendered review found the full-strength navy leaves darkened supporting text through the old 20% glass. Increased only the pale glass tint to 80%, retaining medium backdrop blur. Exposed floral opacity stays 100%; the glass supplies local contrast protection.

Verification for system v5: focused Home banner aggregate/retry browser check passed (1/1), including rerun after glass contrast adjustment. Inspected final desktop and Thai 360px phone captures; left padding is visible, exposed flowers retain full color, greeting remains readable and medium glass blur is preserved. TypeScript and documentation link/graph validation passed. New asset is RGBA 2172×724 with alpha range 0–255. No SQL changes, push or deployment.

## Green leaves and multicolor flowers

Installed [colorful v6 artwork](../../../public/images/home-banner-floral-colorful-v6.png), a palette-only edit retaining sparse shapes/layout. Leaves/stems now use existing green #167A3D. The flowers mix system orange, amber, purple, electric blue, scarlet, cyan and lavender instead of a blue-dominant set. Full opacity, responsive left padding, central opening, right fade, glass surface and recruiter composition remain unchanged. [Current built-in prompt/provenance](floral.md); detailed rules remain in the Home contract.

Verification for colorful v6: focused Home banner aggregate/retry browser check passed (1/1). Inspected desktop and Thai 360px phone screenshots: green foliage and varied warm/cool flowers are visible around the glass, and the greeting stays readable. TypeScript and documentation link/graph validation passed. Asset is RGBA 2172×724 with alpha range 0–255. No SQL changes, push or deployment.

## Brighter harmonious floral palette

Installed [cheerful v7 artwork](../../../public/images/home-banner-floral-cheerful-v7.png), a built-in palette-only edit. Coordinated apricot, butter-gold, lavender, sky blue, coral-peach and turquoise replace the harder primary colors; fresh lighter green foliage and repeated pale centers unify brightness. Full opacity, sparse geometry, responsive left padding, central opening, right fade, glass blur/tint and right-half recruiter remain. [Current prompt/provenance](floral.md); canonical rules remain in the Home contract.

Verification for cheerful v7: focused Home banner aggregate/retry browser check passed (1/1). Inspected desktop and Thai 360px phone screenshots; coordinated lighter colors retain clear exposed petals, green foliage and readable glass-backed greeting. TypeScript and documentation link/graph checks passed. New asset is RGBA 2172×724 with alpha range 0–255. No SQL changes, push or deployment.

## Analogous warm flowers and green foliage

Installed [analogous v8 artwork](../../../public/images/home-banner-floral-analogous-v8.png), a built-in palette-only edit. Flowers now use adjacent yellow/apricot/tangerine/coral hues derived from the system amber/orange/scarlet family, with repeated warm cream centers. Green foliage remains. Full opacity, sparse geometry, responsive left padding, center opening, right fade, glass blur/tint and recruiter remain unchanged. [Current prompt/provenance](floral.md); canonical rules stay in the Home contract.

Verification for analogous v8: focused Home banner aggregate/retry browser check passed (1/1). Inspected desktop and Thai 360px phone screenshots: neighboring warm flower colors and green foliage are visible around the glass-backed greeting; layout remains unchanged. TypeScript and documentation link/graph checks passed. Asset is RGBA 2172×724 with alpha range 0–255. No SQL changes, push or deployment.

## Top banner matches the supplied flower stickers

Installed [flower-sticker v9](../../../public/images/home-banner-floral-stickers-v9.png), edited from sparse v8 using the supplied sticker sheet as the flower reference. Pink hibiscus, yellow plumeria/rose, purple bellflower, colorful small blossoms and green leaves now coordinate with Today’s Work. Only the floral asset changed: sparse composition, full opacity, left padding, clear center, right fade, glass-backed HTML greeting and separate recruiter remain. [Current prompt and provenance](floral.md). No SQL changes, push or deployment.

Sticker-banner verification: the focused Home banner aggregate/retry check passed 1/1. Inspected rendered desktop and Thai 360px phone views; the new sticker-shaped flowers coordinate with Today’s Work while the greeting remains readable through its existing glass surface. TypeScript and documentation link/graph validation passed. New asset is RGBA 2172×724 with alpha range 0–255. No SQL changes, push or deployment.
