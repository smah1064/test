'use strict';

/*
 * Licensed collections: ready designs built on a licensor's official artwork (owner's project, 27 Nov).
 *
 * A collection here names its products, its legal notice and whether it is still a draft. Its designs are an
 * ordinary template pack (src/library-packs/licensed-*.js) whose designs carry `licensed: '<collection id>'`.
 *
 * While `status` is 'draft' the collection is seen only by browsers signed in to the dashboard (the owner and
 * staff): the shop's lists, the design page, adding to the cart and ordering all refuse it for anyone else, so
 * the team can place a full test order before anything is published.
 *
 * Licensed artwork is locked: the design page offers only the name and age boxes (no editor), and every order
 * item made from it is flagged in Review so the team checks it before printing.
 *
 * The artwork files are placeholders until the license is confirmed: public/img/art/licensed-spiderman/*.svg.
 * To use approved files, replace each placeholder (same file name), or point the pack's `ART` table at the new
 * file (.svg or .png; a .png gets its print size from /api/art-sizes by itself).
 */

const COLLECTIONS = {
  'spiderman-bnd': {
    id: 'spiderman-bnd',
    // 'draft': team only. Set to 'live' only after the owner confirms the license in writing.
    status: 'draft',
    name: { en: 'Spider-Man birthday', ar: 'عيد ميلاد سبايدر مان' },
    // Shown under every product of the collection. The exact wording comes from the license: to be filled in.
    notice: {
      en: '© [Licensor notice from the license agreement]. Used under license.',
      ar: '© [نص حقوق صاحب الترخيص من العقد]. مستخدم بموجب ترخيص.',
    },
    // The only products its designs are offered on (also listed on each design).
    products: ['invitations', 'sign', 'stickersheet', 'postcards', 'paperbags'],
  },
};

const collectionOf = (d) => (d && typeof d.licensed === 'string' ? COLLECTIONS[d.licensed] || null : null);
/** A design from a licensed collection that is still a draft (team only). Unknown collections count as drafts. */
const isDraft = (d) => Boolean(d && typeof d.licensed === 'string' && (!COLLECTIONS[d.licensed] || COLLECTIONS[d.licensed].status !== 'live'));
/** What the shop's pages are told about a licensed design. */
const publicInfo = (d) => {
  const c = collectionOf(d);
  return c ? { id: c.id, name: c.name, notice: c.notice, draft: c.status !== 'live', locked: true } : null;
};

module.exports = { COLLECTIONS, collectionOf, isDraft, publicInfo };
