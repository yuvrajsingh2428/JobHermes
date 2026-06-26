# 🤝 Contributing to JobHermes

Thank you for your interest in contributing to JobHermes! We welcome all contributions — bug fixes, new features, documentation improvements, and more.

---

## 🚀 Getting Started

1. **Fork** the repository
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/JobHermes.git
   cd JobHermes
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Set up your environment:**
   ```bash
   cp .env.example .env
   # Fill in your OPENAI_API_KEY and other values
   ```

---

## 🛠️ Development Workflow

1. Create a new branch for your change:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your changes and ensure the code compiles:
   ```bash
   npm run typecheck
   ```
3. Commit with a clear message following [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add support for LinkedIn job scraping
   fix: handle timeout errors in TinyFetch
   docs: update README with new CLI flags
   ```
4. Push your branch and open a **Pull Request** against `main`.

---

## 📋 Code Style

- Written in **TypeScript** — keep types strict, avoid `any`.
- Follow existing file structure under `src/`.
- Keep functions small and focused.
- Add comments for non-obvious logic.

---

## 🐛 Reporting Bugs

Open a [GitHub Issue](https://github.com/yuvrajsingh2428/JobHermes/issues) with:
- A clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Your Node.js version (`node -v`)

---

## ✅ Requirements

- Node.js >= 18.0.0
- npm >= 9.0.0

---

*Built with ⚡ by the JobHermes team*
