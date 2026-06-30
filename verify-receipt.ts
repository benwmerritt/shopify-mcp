/**
 * verify-receipt.ts — Verify a signed gateway receipt from @bolyra/gateway.
 *
 * Receipts are JSON files written by the gateway for every tools/call decision
 * (both allowed and denied). This script reads a receipt file and verifies its
 * HMAC signature, then prints a human-readable summary.
 *
 * Usage:
 *   npx tsx verify-receipt.ts <receipt-file>
 *
 * Example:
 *   npx tsx verify-receipt.ts receipts/2026-06-29/1719657600000-abc123.json
 *
 * This is a standalone script — it does not import @bolyra/gateway. It only
 * uses Node.js built-in crypto to verify the HMAC, so you can run it on any
 * machine with the receipt key.
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

interface Receipt {
  id: string;
  timestamp: string;
  issuer: string;
  tool: string;
  decision: "allow" | "deny";
  reason?: string;
  agent?: {
    did: string;
    permissions: number;
    chainDepth: number;
    score: number;
  };
  hmac?: string;
}

function main(): void {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npx tsx verify-receipt.ts <receipt-file>");
    process.exit(1);
  }

  const key = process.env.BOLYRA_RECEIPT_KEY;
  if (!key) {
    console.error("Set BOLYRA_RECEIPT_KEY to verify the receipt signature.");
    process.exit(1);
  }

  const raw = readFileSync(file, "utf-8");
  const receipt: Receipt = JSON.parse(raw);

  // Verify HMAC: compute over all fields except .hmac itself
  const { hmac: receivedHmac, ...payload } = receipt;
  const computed = createHmac("sha256", Buffer.from(key, "hex"))
    .update(JSON.stringify(payload))
    .digest("hex");

  const valid = receivedHmac === computed;

  console.log("--- Receipt ---");
  console.log(`ID:         ${receipt.id}`);
  console.log(`Timestamp:  ${receipt.timestamp}`);
  console.log(`Tool:       ${receipt.tool}`);
  console.log(`Decision:   ${receipt.decision}`);
  if (receipt.reason) {
    console.log(`Reason:     ${receipt.reason}`);
  }
  if (receipt.agent) {
    console.log(`Agent DID:  ${receipt.agent.did}`);
    console.log(`Permissions: ${receipt.agent.permissions} (bitmask)`);
    console.log(`Chain depth: ${receipt.agent.chainDepth}`);
  }
  console.log(`Signature:  ${valid ? "VALID" : "INVALID"}`);

  if (!valid) {
    process.exit(1);
  }
}

main();
