<p align="center">
  <img src="public/xrge-logo.webp" width="100" alt="RougeChain Logo" />
</p>

<h1 align="center">RougeChain Wallet</h1>

<p align="center">
  <strong>Quantum-safe cryptocurrency wallet & encrypted messenger — browser extension</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-7c3aed" alt="License"></a>
  <img src="https://img.shields.io/badge/manifest-v3-06b6d4" alt="Manifest V3">
  <img src="https://img.shields.io/badge/crypto-post--quantum-10b981" alt="Post-Quantum">
  <img src="https://img.shields.io/badge/chrome%20%7C%20edge%20%7C%20brave%20%7C%20firefox-supported-64748b" alt="Browsers">
</p>

---

## Features

- **Wallet** — View balances, send/receive XRGE, claim testnet faucet, custom token support
- **Tokens** — Create and manage custom tokens on RougeChain
- **NFTs** — Create collections, mint NFTs, view your gallery
- **Messenger** — End-to-end encrypted chat using ML-KEM-768 key exchange
- **Mail** — Encrypted mail system with quantum-safe encryption
- **Security** — Vault lock with AES-256-GCM, auto-lock timer, PBKDF2 key derivation, encrypted `.pqcbackup` exports
- **dApp Provider** — `window.rougechain` API with approval dialogs for web3 dApps
- **Cross-browser** — Chrome, Edge, Brave, Opera, Arc, Firefox (Manifest V3)

## Post-Quantum Cryptography

This wallet uses **NIST-standardized** post-quantum algorithms via [`@noble/post-quantum`](https://github.com/paulmillr/noble-post-quantum):

| Algorithm | Standard | Usage |
|-----------|----------|-------|
| **ML-DSA-65** (CRYSTALS-Dilithium) | FIPS 204 | Digital signatures, transaction signing |
| **ML-KEM-768** (CRYSTALS-Kyber) | FIPS 203 | Key encapsulation for encrypted messaging |
| **AES-256-GCM** | — | Symmetric encryption for messages & vault |
| **PBKDF2** | — | Password-based key derivation for vault lock |

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm

### Development

```bash
git clone https://github.com/cyberdreadx/rougechain-wallet.git
cd rougechain-wallet
npm install
npm run build
```

### Load in Chrome / Edge / Brave

1. Run `npm run build`
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`)
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `dist/` folder

### Load in Firefox

1. Run `npm run build`
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select `dist/manifest.json`

## Architecture

```
rougechain-wallet/
├── src/
│   ├── lib/                     # Core libraries
│   │   ├── pqc-blockchain.ts    # ML-DSA-65 key generation & signing
│   │   ├── pqc-wallet.ts        # Balance, transactions, token management
│   │   ├── pqc-messenger.ts     # E2E encrypted messaging (ML-KEM-768)
│   │   ├── pqc-mail.ts          # Encrypted mail system
│   │   ├── unified-wallet.ts    # Vault encryption & locking
│   │   ├── network.ts           # Node API configuration
│   │   ├── storage.ts           # chrome.storage.local wrapper
│   │   └── api-cache.ts         # API response caching
│   ├── popup/                   # React popup UI
│   │   ├── App.tsx              # Tab navigation
│   │   ├── tabs/
│   │   │   ├── WalletTab.tsx    # Balance & transactions
│   │   │   ├── TokensTab.tsx    # Custom token management
│   │   │   ├── NftsTab.tsx      # NFT gallery & minting
│   │   │   ├── MessengerTab.tsx # Encrypted chat
│   │   │   ├── MailTab.tsx      # Encrypted mail
│   │   │   └── SettingsTab.tsx  # Network, auto-lock, export
│   │   └── components/
│   │       ├── UnlockScreen.tsx
│   │       └── CreateWalletScreen.tsx
│   ├── approval/                # dApp approval dialog
│   │   └── App.tsx
│   ├── background/
│   │   └── service-worker.ts    # Auto-lock timer, message routing
│   └── content/
│       ├── inject.ts            # Content script
│       └── provider.ts          # window.rougechain provider API
├── examples/
│   └── connect-test.html        # dApp integration test page
├── public/
│   └── icons/                   # Extension icons
├── manifest.json                # Manifest V3
├── popup.html                   # Extension popup entry
├── approval.html                # Approval dialog entry
├── vite.config.ts               # Vite build configuration
└── package.json
```

## dApp Integration

The extension injects a `window.rougechain` provider into every page. dApps can use it to connect, request signatures, and send transactions.

```javascript
// Check if extension is installed
if (window.rougechain && window.rougechain.isRougeChain) {
    // Connect wallet (opens approval dialog)
    const { publicKey } = await window.rougechain.connect();

    // Get balance
    const { balance, tokens } = await window.rougechain.getBalance();

    // Sign a transaction (opens approval dialog)
    const result = await window.rougechain.signTransaction({
        type: 'transfer',
        to_pub_key_hex: recipientPublicKey,
        amount: 100,
        token_symbol: 'XRGE',
        fee: 0.1,
    });
}
```

See [`examples/connect-test.html`](examples/connect-test.html) for a full working demo.

## Network Configuration

By default the wallet connects to the RougeChain testnet:

```
https://testnet.rougechain.io/api
```

You can configure a custom node URL in **Settings → Custom Node URL** or via `localhost` for local development.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

For responsible disclosure of security vulnerabilities, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © CyberDreadX
