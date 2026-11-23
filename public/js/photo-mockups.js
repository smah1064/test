/* Photo mockups: real product photos (generated with Creative Claw, white
 * products on a light background, with a cut-out mask) and where the print
 * goes on each one. Coordinates are pixels of the 1000-px-wide photos.
 *
 *   rect   {cx, top, w}: print area centred at cx; its height follows the
 *          product's print-area proportions.
 *   box    {x, y, w, h} with fit "cover": the design fills the box and is
 *          cropped to it (edge-to-edge products whose photo proportions
 *          differ slightly from the print area).
 *   warp   fabric (follows folds) | cylinder (wraps around cx/R) | pillow | flat
 *   keepDark  photo pixels darker than this (camera lenses) are never printed over
 *   paper  area that keeps its white colour when the product colour changes
 *   base   colour of the product in the photo (default white)
 */
(function () {
  'use strict';
  const P = (name) => ({ src: `/mockups/photos/${name}.webp`, mask: `/mockups/photos/${name}-mask.png` });

  window.POD_PHOTOS = {
    'tshirt:front': { ...P('tshirt-front'), rect: { cx: 499, top: 322, w: 315 }, warp: 'fabric' },
    'tshirt:back': { ...P('tshirt-back'), rect: { cx: 499, top: 300, w: 306 }, warp: 'fabric' },
    'kidstee:front': { ...P('tshirt-front'), rect: { cx: 499, top: 315, w: 236 }, warp: 'fabric' },
    'kidstee:back': { ...P('tshirt-back'), rect: { cx: 499, top: 295, w: 230 }, warp: 'fabric' },
    'hoodie:front': { ...P('hoodie-front'), rect: { cx: 500, top: 368, w: 255 }, warp: 'fabric' },
    'hoodie:back': { ...P('hoodie-back'), rect: { cx: 502, top: 405, w: 290 }, warp: 'fabric' },
    'sweatshirt:front': { ...P('sweatshirt-front'), rect: { cx: 500, top: 330, w: 290 }, warp: 'fabric' },
    'sweatshirt:back': { ...P('sweatshirt-back'), rect: { cx: 500, top: 300, w: 290 }, warp: 'fabric' },
    'cap:front': { ...P('cap-front'), rect: { cx: 497, top: 390, w: 300 }, warp: 'cylinder', cyl: { cx: 497, R: 340 } },
    'mug:front': { ...P('mug-front'), rect: { cx: 447, top: 393, w: 587 }, warp: 'cylinder', cyl: { cx: 447.5, R: 238.5 } },
    'bottle:front': { ...P('bottle-front'), rect: { cx: 499.5, top: 540, w: 351 }, warp: 'cylinder', cyl: { cx: 499.5, R: 141.5 } },
    'cushion:front': { ...P('cushion-front'), rect: { cx: 501, top: 278, w: 680 }, warp: 'pillow' },
    'cushion:back': { ...P('cushion-front'), rect: { cx: 501, top: 278, w: 680 }, warp: 'pillow' },
    'poster:front': { ...P('poster-front'), box: { x: 220, y: 224, w: 562, h: 788 }, fit: 'cover', warp: 'flat', paper: { x: 218, y: 222, w: 566, h: 792 } },
    'tote:front': { ...P('tote-front'), rect: { cx: 502, top: 540, w: 420 }, warp: 'fabric', base: '#efe4cc' },
    'tote:back': { ...P('tote-front'), rect: { cx: 502, top: 540, w: 420 }, warp: 'fabric', base: '#efe4cc' },
    'phonecase:back': { ...P('phonecase-back'), box: { x: 286, y: 199, w: 428, h: 851 }, fit: 'cover', warp: 'flat', keepDark: 0.4 },
    'mousepad:front': { ...P('mousepad-front'), box: { x: 102, y: 280, w: 796, h: 682 }, fit: 'cover', warp: 'flat' },
    'notebook:front': { ...P('notebook-front'), box: { x: 180, y: 154, w: 666, h: 939 }, fit: 'cover', warp: 'flat' },
  };

  /** Print rectangle in photo pixels for a product side. */
  window.POD_PHOTOS.rectFor = function (cfg, aspect) {
    if (cfg.box) return { ...cfg.box };
    const h = cfg.rect.w / aspect;
    return { x: cfg.rect.cx - cfg.rect.w / 2, y: cfg.rect.top, w: cfg.rect.w, h };
  };
})();
