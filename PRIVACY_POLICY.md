# Privacy Policy — RougeChain Wallet

**Last updated:** March 19, 2026

RougeChain Wallet is a browser extension for managing cryptocurrency on the RougeChain network. This policy explains what data the extension handles and how.

## Data Collection

**RougeChain Wallet does NOT collect, store, or transmit any personal data.**

- ❌ No analytics or telemetry
- ❌ No tracking pixels or cookies
- ❌ No crash reporting to external services
- ❌ No data shared with third parties

## What Is Stored Locally

The extension stores the following data **only on your device** using `chrome.storage.local`:

| Data | Purpose |
|------|---------|
| Encrypted private keys | Sign transactions (AES-256-GCM encrypted, never transmitted) |
| Public keys | Identify your wallet address |
| Vault lock settings | Auto-lock timer, lock state |
| Network configuration | API endpoint URL (default: RougeChain testnet) |
| Shielded notes | Track private transaction commitments |
| Message history | End-to-end encrypted messenger conversations |

**Your private keys never leave your browser.** All transaction signing happens client-side.

## Network Requests

The extension makes network requests **only** to:

1. **Your configured RougeChain node** (default: `https://testnet.rougechain.io/api`) — to query balances, submit transactions, and sync blockchain data
2. **No other endpoints** — no ads, no analytics servers, no CDNs

## Content Scripts

The extension injects a content script (`content.js`) on all pages to provide the `window.rougechain` provider API. This allows decentralized applications (dApps) to request wallet connections. **The content script does not read or modify any page content.** It only listens for messages from dApps that explicitly call the provider API.

## Permissions

| Permission | Why |
|-----------|-----|
| `storage` | Save encrypted wallet data locally |
| `alarms` | Auto-lock timer |
| `notifications` | Alert when receiving transactions |
| `host_permissions` | Communicate with RougeChain nodes |

## Open Source

This extension is fully open source: [github.com/cyberdreadx/rougechain-wallet](https://github.com/cyberdreadx/rougechain-wallet)

## Contact

For questions about this privacy policy: [github.com/cyberdreadx/rougechain-wallet/issues](https://github.com/cyberdreadx/rougechain-wallet/issues)
