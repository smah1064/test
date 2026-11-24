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
    'polo:front': { ...P('polo-front'), rect: { cx: 658, top: 345, w: 122 }, warp: 'fabric' },
    'polo:back': { ...P('polo-back'), rect: { cx: 502, top: 272, w: 379 }, warp: 'fabric' },
    'oversized:front': { ...P('oversized-front'), rect: { cx: 500, top: 341, w: 405 }, warp: 'fabric' },
    'oversized:back': { ...P('oversized-back'), rect: { cx: 500, top: 311, w: 413 }, warp: 'fabric' },
    'ziphoodie:front': { ...P('ziphoodie-front'), rect: { cx: 631, top: 410, w: 124 }, warp: 'fabric' },
    'ziphoodie:back': { ...P('hoodie-back'), rect: { cx: 504, top: 402, w: 339 }, warp: 'fabric' },
    'kidshoodie:front': { ...P('hoodie-front'), rect: { cx: 502, top: 372, w: 250 }, warp: 'fabric' },
    'kidshoodie:back': { ...P('hoodie-back'), rect: { cx: 504, top: 401, w: 320 }, warp: 'fabric' },
    'denim:back': { ...P('denim-back'), rect: { cx: 502, top: 470, w: 340 }, warp: 'fabric', base: '#4a6fa5' },
    'apron:front': { ...P('apron-front'), rect: { cx: 493, top: 330, w: 320 }, warp: 'fabric' },
    'onesie:front': { ...P('onesie-front'), rect: { cx: 501, top: 378, w: 290 }, warp: 'fabric' },
    'shorts:front': { ...P('shorts-front'), rect: { cx: 703, top: 661, w: 174 }, warp: 'fabric' },
    'jersey:front': { ...P('jersey-front'), rect: { cx: 505, top: 330, w: 300 }, warp: 'fabric' },
    'jersey:back': { ...P('jersey-back'), rect: { cx: 505, top: 262, w: 330 }, warp: 'fabric' },
    'magicmug:front': { ...P('mug-front'), rect: { cx: 447, top: 393, w: 587 }, warp: 'cylinder', cyl: { cx: 447.5, R: 238.5 } },
    'couplemugs:mug1': { ...P('mug-front'), rect: { cx: 447, top: 393, w: 587 }, warp: 'cylinder', cyl: { cx: 447.5, R: 238.5 } },
    'couplemugs:mug2': { ...P('mug-front'), rect: { cx: 447, top: 393, w: 587 }, warp: 'cylinder', cyl: { cx: 447.5, R: 238.5 } },
    // Mugs printed all the way round (products.js mugWrapSide): the mug seen from the side opposite the
    // handle (a sliver of it shows behind), so the middle of the print faces you. The print rect is the
    // whole wrap laid round the cylinder: 21.93 cm of the 25.93 cm round the mug = 0.8457 of 2πR.
    'mug:front:wrap': { ...P('mug-wrap-front'), rect: { cx: 493.5, top: 407, w: 1225 }, warp: 'cylinder', cyl: { cx: 493.5, R: 230.5 } },
    'magicmug:front:wrap': { ...P('mug-wrap-front'), rect: { cx: 493.5, top: 407, w: 1225 }, warp: 'cylinder', cyl: { cx: 493.5, R: 230.5 } },
    'couplemugs:mug1:wrap': { ...P('mug-wrap-front'), rect: { cx: 493.5, top: 407, w: 1225 }, warp: 'cylinder', cyl: { cx: 493.5, R: 230.5 } },
    'couplemugs:mug2:wrap': { ...P('mug-wrap-front'), rect: { cx: 493.5, top: 407, w: 1225 }, warp: 'cylinder', cyl: { cx: 493.5, R: 230.5 } },
    'tumbler:front': { ...P('tumbler-front'), rect: { cx: 499.5, top: 372, w: 405 }, warp: 'cylinder', cyl: { cx: 499.5, R: 163.5 } },
    'coasters:front': { ...P('coaster-front'), box: { x: 197, y: 314, w: 606, h: 600 }, fit: 'cover', warp: 'flat' },
    'tablecloth:front': { ...P('tablecloth-front'), box: { x: 122, y: 145, w: 754, h: 966 }, fit: 'cover', warp: 'fabric' },
    'prayermat:front': { ...P('prayermat-front'), box: { x: 234, y: 152, w: 532, h: 935 }, fit: 'cover', warp: 'fabric' },
    'eidenvelopes:front': { ...P('envelope-front'), box: { x: 314, y: 279, w: 371, h: 679 }, fit: 'cover', warp: 'flat' },
    'greetingcard:front': { ...P('card-front'), rect: { cx: 470, top: 306, w: 428 }, warp: 'flat' },
    'plaque:front': { ...P('plaque-front'), box: { x: 240, y: 240, w: 524, h: 760 }, fit: 'cover', warp: 'flat' },
    'sign:front': { ...P('sign-front'), box: { x: 280, y: 193, w: 441, h: 602 }, fit: 'cover', warp: 'flat' },
    'deskmat:front': { ...P('deskmat-front'), box: { x: 58, y: 430, w: 884, h: 376 }, fit: 'cover', warp: 'flat' },
    'keychain:front': { ...P('keychain-front'), rect: { cx: 500, top: 528, w: 340 }, warp: 'flat' },
    'stickersheet:front': { ...P('stickers-front'), box: { x: 210, y: 212, w: 580, h: 816 }, fit: 'cover', warp: 'flat' },
    'namelabels:front': { ...P('labels-front'), box: { x: 178, y: 385, w: 643, h: 468 }, fit: 'cover', warp: 'flat' },
    'lunchbag:front': { ...P('lunchbag-front'), rect: { cx: 502, top: 500, w: 470 }, warp: 'fabric' },
    'pencilcase:front': { ...P('pencilcase-front'), rect: { cx: 500, top: 450, w: 640 }, warp: 'fabric', base: '#efe4cc' },
    'bizcards:front': { ...P('bizcard-front'), box: { x: 185, y: 422, w: 630, h: 392 }, fit: 'cover', warp: 'flat' },
    'bizcards:back': { ...P('bizcard-front'), box: { x: 185, y: 422, w: 630, h: 392 }, fit: 'cover', warp: 'flat' },
    'flyers:front': { ...P('flyer-front'), box: { x: 222, y: 245, w: 545, h: 760 }, fit: 'cover', warp: 'flat' },
    'flyers:back': { ...P('flyer-front'), box: { x: 222, y: 245, w: 545, h: 760 }, fit: 'cover', warp: 'flat' },
    'letterhead:front': { ...P('letterhead-front'), box: { x: 187, y: 168, w: 627, h: 906 }, fit: 'cover', warp: 'flat' },
    'dlenvelopes:front': { ...P('dlenvelope-front'), rect: { cx: 500, top: 433, w: 748 }, warp: 'flat' },
    'logostickers:front': { ...P('roundsticker-front'), box: { x: 202, y: 324, w: 592, h: 592 }, fit: 'cover', warp: 'flat' },
    'rollup:front': { ...P('rollup-front'), box: { x: 306, y: 158, w: 388, h: 912 }, fit: 'cover', warp: 'flat' },
    'paperbags:front': { ...P('paperbag-front'), rect: { cx: 499, top: 520, w: 380 }, warp: 'flat' },
    'invoicebook:front': { ...P('invoicebook-front'), rect: { cx: 498, top: 252, w: 523 }, warp: 'flat' },
    'idcards:front': { ...P('idcard-front'), box: { x: 335, y: 482, w: 330, h: 520 }, fit: 'cover', warp: 'flat' },
    'idcards:back': { ...P('idcard-front'), box: { x: 335, y: 482, w: 330, h: 520 }, fit: 'cover', warp: 'flat' },
    'invitations:front': { ...P('invitation-front'), box: { x: 219, y: 227, w: 563, h: 790 }, fit: 'cover', warp: 'flat' },
    'invitations:back': { ...P('invitation-front'), box: { x: 219, y: 227, w: 563, h: 790 }, fit: 'cover', warp: 'flat' },
    'certificates:front': { ...P('certificate-front'), box: { x: 85, y: 326, w: 832, h: 587 }, fit: 'cover', warp: 'flat' },
    // Canvas prints: the front stays white under the print; the visible edge takes the edge colour.
    'canvas:front': { ...P('canvas-front'), box: { x: 221, y: 202, w: 559, h: 837 }, fit: 'cover', warp: 'flat', paper: { x: 221, y: 202, w: 559, h: 837 } },
    'canvaswide:front': { ...P('canvaswide-front'), box: { x: 100, y: 354, w: 801, h: 534 }, fit: 'cover', warp: 'flat', paper: { x: 100, y: 354, w: 801, h: 534 } },
  };

  /*
   * Model photos (the "On a model" view): people wearing the blank white
   * garment, with a mask of the garment only (skin, hair and backdrop are
   * never recoloured or printed on). Same coordinates as above: pixels of the
   * 1000-px-wide photo. `who` names the model for the chips (pv.who.*).
   */
  const M = (name, who, rect) => ({ src: `/mockups/models/${name}.webp`, mask: `/mockups/models/${name}-mask.png`, who, rect, warp: 'fabric' });
  window.POD_MODELS = {
    'tshirt:front': [M('tshirt-man-front', 'man', { cx: 507, top: 433, w: 218 }), M('tshirt-woman-front', 'woman', { cx: 501, top: 459, w: 216 })],
    'tshirt:back': [M('tshirt-man-back', 'man', { cx: 504, top: 363, w: 196 }), M('tshirt-woman-back', 'woman', { cx: 505, top: 396, w: 198 })],
    'oversized:front': [M('oversized-man-front', 'man', { cx: 510, top: 422, w: 214 }), M('oversized-woman-front', 'woman', { cx: 504, top: 448, w: 246 })],
    'oversized:back': [M('oversized-man-back', 'man', { cx: 503, top: 354, w: 223 }), M('oversized-woman-back', 'woman', { cx: 501, top: 388, w: 234 })],
    'kidstee:front': [M('kidstee-boy-front', 'boy', { cx: 505, top: 467, w: 190 }), M('kidstee-girl-front', 'girl', { cx: 507, top: 471, w: 199 })],
    'kidstee:back': [M('kidstee-boy-back', 'boy', { cx: 506, top: 411, w: 170 }), M('kidstee-girl-back', 'girl', { cx: 506, top: 410, w: 168 })],
    'kidshoodie:back': [M('kidshoodie-boy-back', 'boy', { cx: 503, top: 535, w: 184 }), M('kidshoodie-girl-back', 'girl', { cx: 507, top: 558, w: 182 })],
    'hoodie:front': [M('hoodie-man-front', 'man', { cx: 503, top: 412, w: 191 }), M('hoodie-woman-front', 'woman', { cx: 502, top: 435, w: 189 })],
    'hoodie:back': [M('hoodie-man-back', 'man', { cx: 504, top: 495, w: 196 }), M('hoodie-woman-back', 'woman', { cx: 510, top: 522, w: 188 })],
    'kidshoodie:front': [M('kidshoodie-boy-front', 'boy', { cx: 504, top: 459, w: 168 }), M('kidshoodie-girl-front', 'girl', { cx: 507, top: 461, w: 176 })],
    'ziphoodie:front': [M('ziphoodie-man-front', 'man', { cx: 580, top: 443, w: 73 })],
    'sweatshirt:front': [M('sweatshirt-man-front', 'man', { cx: 503, top: 439, w: 218 }), M('sweatshirt-woman-front', 'woman', { cx: 501, top: 457, w: 216 })],
    'sweatshirt:back': [M('sweatshirt-man-back', 'man', { cx: 504, top: 355, w: 196 }), M('sweatshirt-woman-back', 'woman', { cx: 517, top: 384, w: 189 })],
    'polo:front': [M('polo-man-front', 'man', { cx: 584, top: 452, w: 63 })],
    'polo:back': [M('polo-man-back', 'man', { cx: 509, top: 326, w: 193 })],
    'jersey:front': [M('jersey-man-front', 'man', { cx: 509, top: 420, w: 178 })],
    'jersey:back': [M('jersey-man-back', 'man', { cx: 508, top: 342, w: 185 })],
    'ziphoodie:back': [M('ziphoodie-man-back', 'man', { cx: 502, top: 498, w: 203 })],
  };

  /*
   * Turning models (the "On a model" view's 360° turn): the same model photographed
   * every 45°. The design is wrapped round the torso, taken as an upright elliptical
   * cylinder: `ref` is the straight-on photo the print rect belongs to (torso centre,
   * half-width, collar and hem rows), `depth` the torso's half-depth (from the side
   * views), and each turned photo gives its own torso centre, half-width, collar and
   * hem plus the turn angle of the printed side (+ = that side faces the picture's right).
   * Measured from the garment masks.
   */
  const TURNS = {
    'tshirt:man': {
      front: { cx: 506.5, a: 191.5, top: 324, bot: 1023 },
      back: { cx: 505, a: 172, top: 309, bot: 1027 },
      frames: { 45: { cx: 504, half: 168, top: 324, bot: 1026 }, 135: { cx: 499.5, half: 167.5, top: 305, bot: 1028 }, 225: { cx: 514, half: 172, top: 297, bot: 1028 }, 315: { cx: 515.5, half: 162.5, top: 321, bot: 1024 } },
    },
    'tshirt:woman': {
      front: { cx: 500.5, a: 181.5, top: 351, bot: 1024 },
      back: { cx: 501, a: 172, top: 341, bot: 1037 },
      frames: { 45: { cx: 512.5, half: 170.5, top: 349, bot: 1027 }, 135: { cx: 490, half: 147, top: 337, bot: 1038 }, 225: { cx: 512, half: 159, top: 334, bot: 1037 }, 315: { cx: 522, half: 168, top: 349, bot: 1028 } },
    },
    'oversized:man': {
      front: { cx: 509, a: 180, top: 327, bot: 1020 },
      back: { cx: 503, a: 187, top: 305, bot: 1032 },
      frames: { 45: { cx: 514.5, half: 176.5, top: 327, bot: 1029 }, 135: { cx: 486, half: 183, top: 301, bot: 1034 }, 225: { cx: 531, half: 186, top: 298, bot: 1039 }, 315: { cx: 492.5, half: 162.5, top: 319, bot: 1023 } },
    },
    'oversized:woman': {
      front: { cx: 503.5, a: 192.5, top: 351, bot: 1074 },
      back: { cx: 501, a: 196, top: 337, bot: 1087 },
      frames: { 45: { cx: 533.5, half: 166.5, top: 345, bot: 1078 }, 135: { cx: 481.5, half: 182.5, top: 334, bot: 1089 }, 225: { cx: 479.5, half: 172.5, top: 332, bot: 1092 }, 315: { cx: 479, half: 162, top: 347, bot: 1081 } },
    },
    'polo:man': {
      front: { cx: 504.5, a: 173.5, top: 307, bot: 1024 },
      back: { cx: 508.5, a: 170.5, top: 278, bot: 1042 },
      frames: { 45: { cx: 498, half: 170, top: 303, bot: 1030 }, 135: { cx: 498.5, half: 174.5, top: 276, bot: 1042 }, 225: { cx: 513.5, half: 182.5, top: 273, bot: 1048 }, 315: { cx: 510, half: 165, top: 300, bot: 1029 } },
    },
    'jersey:man': {
      front: { cx: 509, a: 173, top: 324, bot: 1018 },
      back: { cx: 508.5, a: 166.5, top: 304, bot: 1040 },
      frames: { 45: { cx: 501.5, half: 168.5, top: 322, bot: 1019 }, 135: { cx: 505, half: 171, top: 301, bot: 1040 }, 225: { cx: 516, half: 168, top: 295, bot: 1032 }, 315: { cx: 516.5, half: 164.5, top: 316, bot: 1018 } },
    },
    'kidstee:boy': {
      front: { cx: 506.5, a: 171.5, top: 370, bot: 1016 },
      back: { cx: 507, a: 164, top: 358, bot: 1025 },
      frames: { 45: { cx: 520, half: 141, top: 360, bot: 1014 }, 135: { cx: 485, half: 153, top: 353, bot: 1023 }, 225: { cx: 514.5, half: 160.5, top: 356, bot: 1025 }, 315: { cx: 496, half: 148, top: 366, bot: 1022 } },
    },
    'kidstee:girl': {
      front: { cx: 507.5, a: 171.5, top: 368, bot: 994 },
      back: { cx: 506.5, a: 162.5, top: 358, bot: 1016 },
      frames: { 45: { cx: 516.5, half: 153.5, top: 364, bot: 999 }, 135: { cx: 494, half: 157, top: 359, bot: 1016 }, 225: { cx: 508.5, half: 162.5, top: 354, bot: 1015 }, 315: { cx: 490.5, half: 151.5, top: 364, bot: 1004 } },
    },
    // Hoodies and sweatshirts: widths measured at the sleeve-to-body seam (the sleeves hang against the body).
    'hoodie:man': {
      front: { cx: 503, a: 188, top: 260, bot: 1034 },
      back: { cx: 510, a: 185, top: 268, bot: 1032 },
      frames: { 45: { cx: 510, half: 184, top: 257, bot: 1058 }, 135: { cx: 454.5, half: 160.5, top: 261, bot: 1034 }, 225: { cx: 521, half: 191, top: 264, bot: 1047 }, 315: { cx: 495.5, half: 170.5, top: 252, bot: 1053 } },
    },
    'hoodie:woman': {
      front: { cx: 502, a: 187, top: 281, bot: 1052 },
      back: { cx: 516, a: 177, top: 266, bot: 1055 },
      frames: { 45: { cx: 538, half: 147, top: 283, bot: 1078 }, 135: { cx: 461, half: 153, top: 275, bot: 1065 }, 225: { cx: 533.5, half: 159.5, top: 270, bot: 1057 }, 315: { cx: 483.5, half: 160.5, top: 277, bot: 1067 } },
    },
    'ziphoodie:man': {
      front: { cx: 503.5, a: 190.5, top: 286, bot: 1033 },
      back: { cx: 508, a: 192, top: 272, bot: 1034 },
      frames: { 45: { cx: 510.5, half: 185.5, top: 288, bot: 1048 }, 135: { cx: 471.5, half: 176.5, top: 273, bot: 1045 }, 225: { cx: 518.5, half: 186.5, top: 271, bot: 1047 }, 315: { cx: 508, half: 174, top: 283, bot: 1044 } },
    },
    'sweatshirt:man': {
      front: { cx: 507, a: 188, top: 327, bot: 1030 },
      back: { cx: 506, a: 184, top: 305, bot: 1039 },
      frames: { 45: { cx: 526.5, half: 164.5, top: 325, bot: 1056 }, 135: { cx: 484, half: 186, top: 302, bot: 1052 }, 225: { cx: 539, half: 169, top: 298, bot: 1047 }, 315: { cx: 482, half: 161, top: 319, bot: 1049 } },
    },
    'sweatshirt:woman': {
      front: { cx: 506, a: 185, top: 348, bot: 1054 },
      back: { cx: 518.5, a: 177.5, top: 335, bot: 1058 },
      frames: { 45: { cx: 537.5, half: 157.5, top: 342, bot: 1073 }, 135: { cx: 500, half: 180, top: 334, bot: 1069 }, 225: { cx: 526.5, half: 171.5, top: 332, bot: 1072 }, 315: { cx: 488, half: 168, top: 345, bot: 1070 } },
    },
    'kidshoodie:boy': {
      front: { cx: 502, a: 184, top: 300, bot: 1037 },
      back: { cx: 506, a: 177, top: 294, bot: 1039 },
      frames: { 45: { cx: 496, half: 165, top: 294, bot: 1049 }, 135: { cx: 462.5, half: 156.5, top: 298, bot: 1048 }, 225: { cx: 545.5, half: 155.5, top: 295, bot: 1050 }, 315: { cx: 490.5, half: 156.5, top: 295, bot: 1053 } },
    },
    'kidshoodie:girl': {
      front: { cx: 504.5, a: 178.5, top: 329, bot: 1032 },
      back: { cx: 512.5, a: 175.5, top: 323, bot: 1034 },
      frames: { 45: { cx: 538, half: 136, top: 326, bot: 1062 }, 135: { cx: 476.5, half: 156.5, top: 322, bot: 1045 }, 225: { cx: 532, half: 158, top: 320, bot: 1046 }, 315: { cx: 478, half: 148, top: 329, bot: 1059 } },
    },
  };
  // The torso's half-depth is about 0.7 of its half-width: what the 45° photos give for every
  // model (depth = √(2·half45² − a²)); side views can't show it, the arms hang in front.
  const DEPTH = 0.7;
  // Turn angle of the printed side in each photo (+ = that side faces the picture's right).
  const TURN_ANGLES = [[0, 'front', 0], [45, 'front', 45], [90, null, 0], [135, 'back', -45], [180, 'back', 0], [225, 'back', 45], [270, null, 0], [315, 'front', -45]];
  const modelFor = (pid, who, side) => (window.POD_MODELS[`${pid}:${side}`] || []).find((x) => x.who === who);
  window.POD_TURNS = {};
  for (const [key, T] of Object.entries(TURNS)) {
    const [pid, who] = key.split(':');
    window.POD_TURNS[key] = () => TURN_ANGLES.map(([deg, side, theta]) => {
      const straight = (deg === 0 || deg === 180) && modelFor(pid, who, side);
      if (straight) return { ...straight, deg, side };
      const file = `${pid}-${who}-t${String(deg).padStart(3, '0')}`;
      const base = (side && modelFor(pid, who, side)) || modelFor(pid, who, 'front'); // side views: the front box, for scale only
      return {
        deg, side: side && modelFor(pid, who, side) ? side : null, who, warp: 'fabric',
        src: `/mockups/models/${file}.webp`, mask: `/mockups/models/${file}-mask.png`,
        rect: base ? base.rect : null,
        turn: side && modelFor(pid, who, side) ? { theta, ...T.frames[deg], ref: T[side], depth: Math.round(T.front.a * DEPTH) } : null,
      };
    });
  }

  // ---------- Recoloured product photos (cards, editor, thumbnails) ----------
  const loadImg = (src) => new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Image failed to load: ' + src));
    im.src = src;
  });
  const hexRgb = (hex) => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const bases = new Map();
  /** Photo + mask pixels at a given width, with brightness stats and the product's bounding box. */
  function photoBase(cfg, width) {
    const key = cfg.src + '|' + width;
    if (!bases.has(key)) {
      bases.set(key, Promise.all([loadImg(cfg.src), loadImg(cfg.mask)]).then(([ph, mk]) => {
        // Coordinates are pixels of a 1000-px-wide photo; CDNs may serve it resized.
        const k = width / 1000;
        const W = Math.round(width);
        const H = Math.round((width * ph.naturalHeight) / ph.naturalWidth);
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(ph, 0, 0, W, H);
        const pd = ctx.getImageData(0, 0, W, H).data;
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(mk, 0, 0, W, H);
        const md = ctx.getImageData(0, 0, W, H).data;
        const lum = new Float32Array(W * H);
        const samples = [];
        let x0 = W; let y0 = H; let x1 = 0; let y1 = 0;
        for (let i = 0; i < W * H; i++) {
          lum[i] = (0.299 * pd[i * 4] + 0.587 * pd[i * 4 + 1] + 0.114 * pd[i * 4 + 2]) / 255;
          if (md[i * 4] > 200 && i % 5 === 0) samples.push(lum[i]);
          if (md[i * 4] > 20) {
            const x = i % W;
            const y = (i - x) / W;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
        samples.sort((a, b) => a - b);
        const white = samples.length ? samples[Math.floor(samples.length * 0.95)] : 1;
        return { W, H, k, pd, md, lum, white, bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
      }));
    }
    return bases.get(key);
  }

  const renders = new Map();
  /**
   * The product photo recoloured to `hex` (same shading model as the live
   * preview), as a canvas. Options: width (processing width, default 1000),
   * cutout (transparent background), crop (trim to the product + padding).
   * The canvas carries .scale (canvas px per original photo px) and .offset.
   */
  function render(cfg, hex, opts = {}) {
    const width = opts.width || 1000;
    const key = [cfg.src, cfg.base || '', hex, width, opts.cutout ? 1 : 0, opts.crop || 0].join('|');
    if (!renders.has(key)) {
      renders.set(key, photoBase(cfg, width).then((b) => {
        const { W, H, pd, md, lum, white } = b;
        const base = hexRgb(cfg.base || '#ffffff');
        const target = hexRgb(hex);
        const recolour = target.some((v, i) => Math.abs(v - base[i]) > 6);
        const dark = (0.299 * target[0] + 0.587 * target[1] + 0.114 * target[2]) / 255 < 0.35;
        const pk = cfg.paper ? {
          x: cfg.paper.x * b.k, y: cfg.paper.y * b.k, w: cfg.paper.w * b.k, h: cfg.paper.h * b.k,
        } : null;
        const keepDark = cfg.keepDark || 0;
        const img = new ImageData(W, H);
        const od = img.data;
        for (let i = 0; i < W * H; i++) {
          const m = md[i * 4] / 255;
          const o = i * 4;
          od[o] = pd[o];
          od[o + 1] = pd[o + 1];
          od[o + 2] = pd[o + 2];
          od[o + 3] = opts.cutout ? md[o] : 255;
          if (!recolour || m === 0 || lum[i] < keepDark) continue;
          if (pk) {
            const x = i % W;
            const y = (i - x) / W;
            if (x >= pk.x && x < pk.x + pk.w && y >= pk.y && y < pk.y + pk.h) continue;
          }
          const sh = lum[i] / white;
          for (let c = 0; c < 3; c++) {
            const base0 = base[c] / 255;
            let v = target[c] * Math.min(sh, 1) / Math.max(0.2, base0) * base0;
            if (sh > 1) v += (255 - v) * (sh - 1) * 2;
            if (dark) v += (sh - 1) * 70;
            od[o + c] = pd[o + c] * (1 - m) + v * m;
          }
        }
        const full = document.createElement('canvas');
        full.width = W;
        full.height = H;
        full.getContext('2d').putImageData(img, 0, 0);
        full.scale = b.k;
        full.offset = { x: 0, y: 0 };
        if (!opts.crop) return full;
        const pad = Math.round(Math.max(b.bbox.w, b.bbox.h) * opts.crop);
        const side = Math.max(b.bbox.w, b.bbox.h) + pad * 2;
        const out = document.createElement('canvas');
        out.width = side;
        out.height = side;
        const ox = Math.round(b.bbox.x + b.bbox.w / 2 - side / 2);
        const oy = Math.round(b.bbox.y + b.bbox.h / 2 - side / 2);
        out.getContext('2d').drawImage(full, -ox, -oy);
        out.scale = b.k;
        out.offset = { x: ox, y: oy };
        return out;
      }));
    }
    return renders.get(key);
  }

  /** Dark parts of the photo that are never printed on (camera lenses), as an overlay. */
  function darkOverlay(cfg, width = 1000) {
    return photoBase(cfg, width).then((b) => {
      const { W, H, pd, md, lum } = b;
      const img = new ImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        if (md[i * 4] < 128 || lum[i] >= cfg.keepDark) continue;
        img.data.set([pd[i * 4], pd[i * 4 + 1], pd[i * 4 + 2], 255], i * 4);
      }
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      c.getContext('2d').putImageData(img, 0, 0);
      c.scale = b.k;
      return c;
    });
  }

  /**
   * Where the photo goes in the editor's 500 x 600 mockup space so that its
   * measured print area lands exactly on the side's printArea:
   * { kx, ky (mockup units per photo px), x, y } for the photo's top-left corner.
   */
  function placement(cfg, printArea) {
    const aspect = printArea.w / printArea.h;
    const r = window.POD_PHOTOS.rectFor(cfg, aspect);
    if (cfg.box) {
      // Flat products: the photographed surface fills the print area exactly
      // (its shape can differ a little from the print size).
      const kx = printArea.w / r.w;
      const ky = printArea.h / r.h;
      return { k: kx, kx, ky, x: printArea.x - r.x * kx, y: printArea.y - r.y * ky };
    }
    // Curved products: the flat print width shows as a narrower arc on the photo.
    const rw = cfg.cyl ? 2 * cfg.cyl.R * Math.sin(Math.min(Math.PI / 2, r.w / 2 / cfg.cyl.R)) : r.w;
    const k = cfg.cyl ? Math.sqrt((printArea.w / rw) * (printArea.h / r.h)) : printArea.w / r.w;
    const cx = printArea.x + printArea.w / 2;
    const cy = printArea.y + printArea.h / 2;
    return { k, kx: k, ky: k, x: cx - (r.x + r.w / 2) * k, y: cy - (r.y + r.h / 2) * k };
  }

  /**
   * Photo config for a product side, or null if it only has a drawn mockup. Takes the product
   * (products made from another one use that one's photos: p.base) or a product id.
   */
  const forSide = (product, sideId) => {
    const id = product && typeof product === 'object' ? product.base || product.id : product;
    return window.POD_PHOTOS[`${id}:${sideId}`] || null;
  };

  Object.assign(window.POD_PHOTOS, { render, darkOverlay, placement, forSide });

  /** Print rectangle in photo pixels for a product side. */
  window.POD_PHOTOS.rectFor = function (cfg, aspect) {
    if (cfg.box) return { ...cfg.box };
    const h = cfg.rect.w / aspect;
    return { x: cfg.rect.cx - cfg.rect.w / 2, y: cfg.rect.top, w: cfg.rect.w, h };
  };
})();
