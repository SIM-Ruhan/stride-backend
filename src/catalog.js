export const flavours = ['Peanut Cocoa', 'Berry Oat', 'Salted Caramel', 'Mint Chip', 'Strawberry'];
export const prices = { bag: 299, pack: 748 };

export function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

export function quote(items, rate) {
  if (!Array.isArray(items) || !items.length || items.length > 100)
    throw problem(400, 'Choose between 1 and 100 items.');
  const seen = new Set();
  const lines = items.map((item) => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(item.id) || seen.has(item.id))
      throw problem(400, 'Invalid basket item.');
    seen.add(item.id);
    if (
      !['bag', 'pack'].includes(item.kind) ||
      !Array.isArray(item.flavours) ||
      item.flavours.length !== (item.kind === 'bag' ? 1 : 3)
    )
      throw problem(400, 'Invalid pack size.');
    if (item.flavours.some((i) => !Number.isInteger(i) || i < 0 || i >= flavours.length))
      throw problem(400, 'Unknown flavour.');
    return { id: item.id, kind: item.kind, flavours: item.flavours, usdCents: prices[item.kind] };
  });
  const usdCents = lines.reduce((sum, item) => sum + item.usdCents, 0);
  return { items: lines, usdCents, bdtPaisa: Math.round(usdCents * rate), rate, currency: 'BDT' };
}

export function shipping(input = {}) {
  const result = {};
  for (const [key, max] of Object.entries({
    name: 50,
    phone: 20,
    address: 50,
    area: 50,
    city: 50,
    postcode: 4,
  })) {
    const value = typeof input?.[key] === 'string' ? input[key].trim() : '';
    if (!value || value.length > max) throw problem(400, 'Check the delivery ' + key + '.');
    result[key] = value;
  }
  if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(result.phone) || !/^\d{4}$/.test(result.postcode))
    throw problem(400, 'Enter a Bangladesh mobile number and a four-digit postcode.');
  return result;
}
