const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateCheckoutAmount } = require("../app/utils/checkoutAmount.js");

test("Checkout calcula por defecto el saldo pendiente en centavos", () => {
  assert.equal(calculateCheckoutAmount(12345), 12345);
});

test("Checkout permite abonos exactos validados que no exceden el saldo", () => {
  assert.equal(calculateCheckoutAmount(12345, "25.00"), 2500);
  assert.equal(calculateCheckoutAmount(12345, 123.45), 12345);
});

test("Checkout rechaza importes manipulados, inválidos o sin saldo", () => {
  for (const [balance, amount] of [
    [10000, 100.01],
    [10000, 0],
    [10000, -1],
    [10000, "1.001"],
    [10000, "not-a-number"],
    [0, undefined],
    [-1, undefined],
    [Number.MAX_SAFE_INTEGER + 1, undefined]
  ]) {
    assert.equal(calculateCheckoutAmount(balance, amount), null, `${balance} / ${amount}`);
  }
});
