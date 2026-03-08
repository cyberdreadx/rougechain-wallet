# Contributing to RougeChain Wallet

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/cyberdreadx/rougechain-wallet.git
cd rougechain-wallet
npm install
npm run dev
```

Load the extension in Chrome:
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder

## Pull Request Workflow

1. **Fork** the repo and create a feature branch from `main`
2. Make your changes with clear, descriptive commits
3. Run `npm run build` — ensure it compiles cleanly
4. Test in Chrome/Firefox by loading the unpacked extension
5. Open a **Pull Request** against `main`

## Code Style

- TypeScript strict mode
- React functional components with hooks
- Use the existing `src/lib/` utilities — don't duplicate crypto logic
- Follow the existing file structure (tabs, components, lib)

## Reporting Bugs

Open an issue using the **Bug Report** template. Include:
- Browser name and version
- Extension version
- Steps to reproduce
- Expected vs actual behavior

## Security Vulnerabilities

Please do **not** open public issues for security vulnerabilities.  
See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
