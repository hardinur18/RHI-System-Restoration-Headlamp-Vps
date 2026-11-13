import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const {
  extractMapCoordinates,
  isValidMapCoordinate,
  selectVerifiedMapCoordinate,
  toGoogleMapsCoordinateUrl,
} = await import('../src/utils/mapCoordinates.ts');

const assertCoordinate = (actual, expected, label) => {
  assert.ok(actual, `${label}: coordinate was not extracted`);
  assert.equal(actual.lat, expected.lat, `${label}: latitude mismatch`);
  assert.equal(actual.lng, expected.lng, `${label}: longitude mismatch`);
};

assertCoordinate(
  extractMapCoordinates('https://maps.google.com/?q=-6.252996,107.118004'),
  { lat: -6.252996, lng: 107.118004 },
  'q parameter',
);

assertCoordinate(
  extractMapCoordinates('https://www.google.com/maps/search/?api=1&query=-6.3295131%2C106.9257115'),
  { lat: -6.3295131, lng: 106.9257115 },
  'encoded query parameter',
);

assertCoordinate(
  extractMapCoordinates('https://www.google.com/maps/place/Customer/@-6.1416512,106.8284305,12z/data=!4m6!3d-6.3295131!4d106.9257115'),
  { lat: -6.3295131, lng: 106.9257115 },
  'place pin wins over viewport',
);

assertCoordinate(
  extractMapCoordinates('<html>center=-5.7775775,106.6779755 data=!4m6!3d-6.3516559!4d107.1527947</html>'),
  { lat: -6.3516559, lng: 107.1527947 },
  'place pin wins over HTML map center',
);

assertCoordinate(
  extractMapCoordinates('https://maps.google.com/data=!2d106.9257115!3d-6.3295131'),
  { lat: -6.3295131, lng: 106.9257115 },
  'legacy protobuf longitude-latitude order',
);

assertCoordinate(
  extractMapCoordinates('-6.3516559,107.1527947'),
  { lat: -6.3516559, lng: 107.1527947 },
  'raw coordinate pair',
);

assert.equal(extractMapCoordinates('https://maps.app.goo.gl/short-link'), null, 'short link must be expanded server-side');
assert.equal(isValidMapCoordinate(0, 0), false, 'zero coordinate must not be accepted');
assert.equal(
  toGoogleMapsCoordinateUrl('viewport=@-6.1,106.8 data=!3d-6.3!4d106.9'),
  'https://www.google.com/maps/search/?api=1&query=-6.3,106.9',
  'canonical coordinate URL must use the destination pin',
);

assertCoordinate(
  selectVerifiedMapCoordinate({
    mapsUrl: 'https://maps.app.goo.gl/customer-pin',
    storedLat: -6.1416512,
    storedLng: 106.8284305,
    resolvedUrl: 'https://maps.app.goo.gl/customer-pin',
    resolvedCoordinate: { lat: -6.3295131, lng: 106.9257115 },
  }),
  { lat: -6.3295131, lng: 106.9257115 },
  'resolved short-link pin wins over stale stored coordinate',
);
assert.equal(
  selectVerifiedMapCoordinate({
    mapsUrl: 'https://maps.app.goo.gl/customer-pin',
    storedLat: -6.1416512,
    storedLng: 106.8284305,
  }),
  null,
  'an unresolved link must not fall back to a stale stored coordinate',
);

const orderFormSource = await readFile(new URL('../src/app/pages/orders/OrderForm.tsx', import.meta.url), 'utf8');
assert.match(orderFormSource, /sanitizedData\.lat = coords\.lat;/, 'order submit must persist latitude');
assert.match(orderFormSource, /sanitizedData\.lng = coords\.lng;/, 'order submit must persist longitude');
assert.match(orderFormSource, /lat: undefined,[\s\S]*lng: undefined,/, 'changing the Maps URL must invalidate old coordinates');

const monitoringSource = await readFile(new URL('../src/app/pages/Pemantauan.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(monitoringSource, /updateOrderPatch\(/, 'monitoring must remain read-only');
assert.doesNotMatch(monitoringSource, /Math\.cos\(angle\)/, 'monitoring must not fabricate a customer point near a branch');
assert.match(monitoringSource, /useVerifiedOrderMapCoordinates/, 'monitoring must reject stale stored coordinates when a Maps URL exists');

const ordersPageSource = await readFile(new URL('../src/app/pages/Pesanan.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(ordersPageSource, /Math\.cos\(angle\)/, 'the order map must not fabricate a point near Jakarta');
assert.match(ordersPageSource, /useVerifiedOrderMapCoordinates/, 'the order map must use verified Maps-link coordinates');

const masterDataSource = await readFile(new URL('../src/app/pages/master-data/context/MasterDataCtx.tsx', import.meta.url), 'utf8');
assert.match(masterDataSource, /normalizeOrderLocationForSave/, 'the order persistence boundary must normalize location data');
assert.match(masterDataSource, /lat: normalizedOrder\.lat,[\s\S]*lng: normalizedOrder\.lng,/, 'Maps URL patches must persist matching coordinates');
assert.match(masterDataSource, /previous && !previous\.mapsUrl\?\.trim\(\)/, 'legacy orders without a Maps URL must remain operationally editable');

console.log('Order Maps location tests passed.');
