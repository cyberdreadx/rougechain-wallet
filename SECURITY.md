# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in the RougeChain Wallet, **please do not open a public issue**.

Instead, report it responsibly by emailing:

**security@rougechain.io**

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within **48 hours** and aim to release a fix within **7 days** for critical issues.

## Scope

This policy covers:
- The browser extension source code in this repo
- Key generation and signing (`@noble/post-quantum`)
- Wallet vault encryption (AES-256-GCM, PBKDF2)
- Content script / provider injection
- Service worker session management

## Out of Scope

- The RougeChain node / testnet infrastructure
- Third-party dependencies (report upstream)

## Acknowledgements

We appreciate the security research community. Contributors who report valid vulnerabilities will be credited in the release notes (unless they prefer to remain anonymous).
