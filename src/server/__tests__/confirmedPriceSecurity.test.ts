/**
 * Isolated Security & Immutability Test Suite for confirmedPrice
 * 
 * Verifies that confirmedPrice is atomic, immutable, and protected across
 * Telegram server handlers, Dashboard context, and Firestore transactions.
 */

import { updateOrderConfirmedPriceInFirestore } from '../firestoreServerService.js';
import { upsertServerOrder, getOrderById } from '../ordersStore.js';

async function runPriceSecurityTests() {
  console.log('--- Starting confirmedPrice Immutability & Security Tests ---\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  const testOrderId = `TEST-PRICE-${Date.now()}`;

  // Seed mock order without confirmedPrice
  upsertServerOrder({
    id: testOrderId,
    customerName: 'اختبار الحماية',
    phone: '01000000000',
    status: 'new',
    createdAt: new Date().toISOString(),
  });

  // 1. Initial price confirmation (first time)
  const res1 = await updateOrderConfirmedPriceInFirestore(testOrderId, 350, 'المشرف الأول');
  assert(res1.success === true && res1.order?.confirmedPrice === 350, '1. Initial price confirmation succeeds for valid number');

  // 2. Status unchanged check
  assert(res1.order?.status === 'new', '2. Order status remains unchanged after price confirmation');

  // 3. Rejection of second price confirmation attempt (Immutability)
  const res2 = await updateOrderConfirmedPriceInFirestore(testOrderId, 450, 'المشرف الثاني');
  assert(res2.success === false && Boolean(res2.error?.includes('ملاحظة') || res2.error?.includes('مسبقاً')), '3. Rejection of second price confirmation attempt (Immutable)');

  // 4. Verification that order in store still retains original price (350, NOT 450)
  const stored = getOrderById(testOrderId);
  assert(stored?.confirmedPrice === 350, '4. Retains original confirmedPrice (350 EGP) without modification');

  // 5. Rejection of invalid price (<= 0 or NaN)
  const invalidOrderId = `TEST-INVALID-${Date.now()}`;
  upsertServerOrder({
    id: invalidOrderId,
    customerName: 'اختبار سعر غير صالح',
    phone: '01000000000',
    status: 'new',
  });
  const resZero = await updateOrderConfirmedPriceInFirestore(invalidOrderId, 0, 'المشرف');
  assert(resZero.success === false, '5. Rejection of invalid zero/negative price');

  const resNaN = await updateOrderConfirmedPriceInFirestore(invalidOrderId, NaN, 'المشرف');
  assert(resNaN.success === false, '6. Rejection of NaN price input');

  // 6. Simulated concurrent write race condition
  const raceOrderId = `TEST-RACE-${Date.now()}`;
  upsertServerOrder({
    id: raceOrderId,
    customerName: 'اختبار السباك السباق',
    phone: '01000000000',
    status: 'new',
  });

  const [raceRes1, raceRes2] = await Promise.all([
    updateOrderConfirmedPriceInFirestore(raceOrderId, 300, 'مشرف A'),
    updateOrderConfirmedPriceInFirestore(raceOrderId, 500, 'مشرف B'),
  ]);

  const raceSuccessCount = [raceRes1, raceRes2].filter(r => r.success).length;
  const raceFailCount = [raceRes1, raceRes2].filter(r => !r.success).length;

  assert(raceSuccessCount === 1 && raceFailCount === 1, '7. Concurrent race condition: Exactly 1 transaction succeeds, 1 fails');

  console.log(`\n--- Test Results: ${passed} Passed, ${failed} Failed ---`);
  if (failed > 0) {
    process.exit(1);
  }
}

runPriceSecurityTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
