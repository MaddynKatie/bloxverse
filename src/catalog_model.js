// Catalog filter/sort model.
//
// Ported from the reference unused\uirevamp\catalog_model.js.
//
// The reference reads one flat /api/catalog/init payload whose items already carry
// the reference's *slot* types (hat, *_accessory, shirt, pant, face), so
// filterCatalog() can test item.type directly. BloxVerse has no such endpoint:
// its items come from four stores (src/catalogStore.js) tagged by the display
// category shown in the editor -- Hair, Hat, Face Accessory, Shirts, Pants,
// Templates, Emotes -- and faces carry no category at all (src/faces.js).
//
// groupType() bridges that gap by mapping a catalog entry onto the reference slot
// type, so the filtering/sorting/URL rules below stay the reference's verbatim.
export const categories = ['all', 'accessories', 'hair', 'shirt', 'pant', 'face'];
export const sorts = ['price-desc', 'price-asc', 'name-asc', 'name-desc'];

// Display category -> reference slot type. Mirrors the map in
// src/avatar_page.js, which needs the same translation to equip an item. Only one
// accessory of a kind can be worn at a time, which is why the reference groups by
// slot rather than by our display category.
const accessoryType = {
  'Hair': 'hair',
  'Hat': 'hat',
  'Face Accessory': 'face_accessory',
  'Front Accessory': 'front_accessory',
  'Back Accessory': 'back_accessory',
  'Neck Accessory': 'neck_accessory',
  'Shoulder Accessory': 'shoulder_accessory',
  'Waist Accessory': 'waist_accessory',
};

// Emotes are not wearable, so they keep their own type and fall outside every
// category button -- the reference has no emote category either. They are still
// reachable under 'all', which is where they were on the legacy page.
export function groupType(item) {
  if (item.type === 'face' || item.type === 'emote') return item.type;
  if (item.category === 'Hair') return 'hair';
  if (item.type === 'accessory') return accessoryType[item.category] || 'front_accessory';
  // Clothing splits on its real category; the 'Templates' shirt template is a
  // shirt, so it folds into Shirts.
  if (item.type === 'shirt') return item.category === 'Pants' ? 'pant' : 'shirt';
  return item.type;
}

export function priceRange(minValue, maxValue) {
  const parse = value => String(value ?? '').trim() === '' ? null : Number(value);
  const min = parse(minValue);
  const max = parse(maxValue);
  if ([min, max].some(value => value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 2147483647))) {
    throw new Error('Enter a whole price of zero or more.');
  }
  if (min !== null && max !== null && min > max) throw new Error('Minimum price must not exceed maximum price.');
  return { min, max };
}

export function stateFromParams(params) {
  let range;
  try { range = priceRange(params.get('min'), params.get('max')); }
  catch { range = { min: null, max: null }; }
  return {
    category: categories.includes(params.get('category')) ? params.get('category') : 'accessories',
    sort: sorts.includes(params.get('sort')) ? params.get('sort') : 'price-asc',
    q: (params.get('q') || '').trim(),
    author: (params.get('author') || '').trim(),
    limited: params.get('limited') === '1',
    ...range,
  };
}

export function filterCatalog(items, state) {
  const query = state.q.toLocaleLowerCase();
  const author = state.author.toLocaleLowerCase();
  return items.filter(item => {
    const type = groupType(item);
    const inCategory = state.category === 'all'
      || (state.category === 'accessories'
        ? type === 'hat' || type.endsWith('_accessory')
        : type === state.category);
    // Match on family name (the card display name) as well as item name so that
    // searching for a variant family label finds all of its members.
    const displayName = (item.family || item.name).toLocaleLowerCase();
    return inCategory
      && (!state.limited || item.limited)
      && (displayName.includes(query) || item.name.toLocaleLowerCase().includes(query))
      && (!author || (item.author || '').toLocaleLowerCase().includes(author))
      && (state.min === null || item.price >= state.min)
      && (state.max === null || item.price <= state.max);
  }).sort((a, b) => {
    let order;
    if (state.sort === 'price-asc') order = a.price - b.price;
    else if (state.sort === 'name-asc') order = a.name.localeCompare(b.name);
    else if (state.sort === 'name-desc') order = b.name.localeCompare(a.name);
    else order = b.price - a.price;
    // The reference tiebreaks on a numeric id; ours are slugs, so compare them
    // as strings to keep the order stable between renders.
    return order || String(a.id).localeCompare(String(b.id));
  });
}