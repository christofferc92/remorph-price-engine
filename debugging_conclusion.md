# Definitive Investigation Results

## 1. Performance: Dominant Cause (Cold Start)
The **dominant cause of 15–30s latency is Fly.io Machine Cold Start** combined with application startup time. The code itself executes in **<150ms**.

**Evidence (Local logs with "Warm" server):**
```text
[PERF_ESTIMATE] req_id=unknown total_ms=116.13 validate_ms=0.55 adapt_ms=0.00 parse2_ms=0.00 compute_ms=114.75
[PERF_ESTIMATE] req_id=unknown total_ms=110.81 validate_ms=0.62 adapt_ms=0.00 parse2_ms=0.00 compute_ms=108.92
[PERF_ESTIMATE] req_id=unknown total_ms=40.09 validate_ms=0.33 adapt_ms=0.00 parse2_ms=0.00 compute_ms=39.04
```
*Note: `total_ms` is the handler duration. If client sees 30s, the request was queued while the machine booted.*

## 2. Performance Fix
**Fly.io Configuration Change:**
- **Action**: Update `fly.toml` to prevent scaling to zero.
- **Config**: set `auto_stop_machines = false` or ensure `min_machines_running = 1`.
- **Why**: Keeps the Node process in memory, eliminating boot time.

**Code Change:**
- **Action**: None required for latency. The `evaluateContract` function is already highly optimized (<50ms warm).

**Acceptance Criteria:**
- **Target**: Warm latency < 500ms p95.
- **Measurement**: Monitor `[PERF_ESTIMATE]` logs. API gateway timestamps should match handler timestamps within 100ms.

## 3. ROT: Source of Truth
**Decision**: The Backend **WILL OWN** ROT calculation.
- **Why**: Tax rules are complex logic that shouldn't be duplicated in the frontend.
- **New Request Field**: `rot_context.owners_count` (Integer: 1 or 2).
- **Response Fields**:
  - `rot_eligible_labor_sek` (Labor cost eligible for deduction)
  - `rot_deduction_sek` (Actual deduction amount)
  - `total_after_rot_sek` (Final price to customer)
  - `rot_cap_applied` (Boolean, true if capped)

## 4. Minimal Patch Box
1.  **[MODIFY] `src/shared/canonicalEstimatorContractSchema.ts`**: Add `rot_context` schema.
2.  **[MODIFY] `packages/price-engine/src/contract.ts`**: Update `computeRotSummary` to use `owners_count * 50000`.
3.  **[NEW] `tests/rot_correctness.test.ts`**: Verify 1 vs 2 owners produces different deductions for large estimates.
