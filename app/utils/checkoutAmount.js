function calculateCheckoutAmount(balanceInCents, requestedAmount) {
  if (!Number.isSafeInteger(balanceInCents) || balanceInCents <= 0) return null;

  const requestedValue = requestedAmount === undefined
    ? balanceInCents / 100
    : Number(requestedAmount);
  const amountInCents = Math.round(requestedValue * 100);
  if (!Number.isFinite(requestedValue) ||
      !Number.isSafeInteger(amountInCents) ||
      amountInCents <= 0 ||
      (requestedAmount !== undefined &&
        Math.abs(requestedValue * 100 - amountInCents) > 1e-7) ||
      amountInCents > balanceInCents) {
    return null;
  }
  return amountInCents;
}

module.exports = { calculateCheckoutAmount };
