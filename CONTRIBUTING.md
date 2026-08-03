# Contributing to UNS Sentinel Explorer

> **Created & maintained by [Nimish Nirmal](https://github.com/nimish-nirmal)**

Thank you for your interest in contributing! 🎉 We welcome improvements of all kinds — bug reports, feature requests, documentation, and code.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Project Commands](#project-commands)
- [Code Style](#code-style)
- [Branching & Git Flow](#branching--git-flow)
- [Commit Message Convention](#commit-message-convention)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Issue Reporting](#issue-reporting)
- [Feature Requests](#feature-requests)

---

## Code of Conduct

Be respectful, inclusive, and constructive. Harassment and discrimination of any kind will not be tolerated.

---

## How to Contribute

1. **Fork** the repository on GitHub
2. **Create a feature branch** from `main`
3. **Make your changes** following the style guides below
4. **Test** your changes with the project commands
5. **Submit a Pull Request** against the `main` branch

---

## Development Setup

```bash
# 1. Fork & clone
git clone https://github.com/nimish-nirmal/uns-sentinel-explorer.git
cd uns-sentinel-explorer

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
# → http://localhost:5173/uns-sentinel-explorer/
```

---

## Project Commands

| Command                | Description                              |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | Start Vite dev server with HMR           |
| `npm run dev:all`      | Start Vite dev server + backend gateway  |
| `npm run server`       | Start backend gateway only               |
| `npm run server:dev`   | Start backend gateway with watch mode    |
| `npm run build`        | Type-check + production build to `dist/` |
| `npm run preview`      | Preview the production build             |
| `npm run lint`         | TypeScript type-check only (`tsc --noEmit`) |

---

## Code Style

### TypeScript
- **Strict mode** is enabled — respect it
- Use explicit types for exports and function parameters
- Prefer `interface` over `type` for object shapes
- Use `Map` / `Set` for collections when keys are dynamic (like the topic tree)
- All public functions should have JSDoc comments

### React Components
- Prefer **functional components** with hooks
- Component props should use an `interface` named `ComponentNameProps`
- Keep components focused — extract reusable UI into separate files
- Name files in **PascalCase** (e.g. `SessionBar.tsx`)

### Styling (Tailwind)
- Use the custom color tokens defined in `tailwind.config.js`
- Dark theme only — background `slate-950`, accents cyan/emerald
- Reuse component classes from `src/index.css` (`.panel`, `.btn`, `.input`, etc.)

### File Organization

```
src/
├── components/     # React components + modals
├── engine/         # Core logic (topic tree, MQTT, simulator)
├── lib/            # Utilities (storage, formatting)
└── types/          # Shared TypeScript interfaces
```

---

## Branching & Git Flow

| Branch | Purpose                    |
| ------ | -------------------------- |
| `main` | Stable, always deployable  |

Branch naming:
- `feat/describe-feature`
- `fix/describe-bug`
- `docs/describe-change`
- `refactor/describe-change`

---

## Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:**
| Type       | Purpose                        |
| ---------- | ------------------------------ |
| `feat`     | New feature                   |
| `fix`      | Bug fix                       |
| `docs`     | Documentation only            |
| `style`    | Formatting, no code changes   |
| `refactor` | Code change, no behavior change |
| `test`     | Adding/fixing tests           |
| `chore`    | Build, tooling, deps          |

**Examples:**
```
feat(engine): add Sparkplug B binary payload fallback
fix(tree): correct topic classification for $SYS paths
docs(readme): add broker connection examples
chore(deps): update mqtt to 5.10.1
```

---

## Submitting a Pull Request

1. Base your PR on the latest `main`:
   ```bash
   git checkout main
   git pull upstream main
   git checkout -b feat/your-feature
   ```

2. Run checks locally before pushing:
   ```bash
   npm run lint
   npm run build
   ```

3. Push and open the PR. Include:
   - **What** the change does
   - **Why** it's needed
   - **How** it was tested
   - Screenshots for UI changes

CI (`.github/workflows/ci.yml`) will run type-checks and builds on every PR.

---

## Issue Reporting

When opening an issue, please include:

- **Title** — concise summary
- **Environment** — OS, browser, Node version
- **Steps to reproduce**
- **Expected behavior**
- **Actual behavior**
- **Screenshots** / logs if helpful

Use one of the labels: `bug`, `enhancement`, `documentation`, `question`.

---

## Feature Requests

Open an issue with the `enhancement` label describing:

- **Problem** — what the feature solves
- **Proposed solution** — how you'd approach it
- **Alternatives** — other approaches considered
- **Priority** — how important is it

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

*Project created & maintained by [Nimish Nirmal](https://github.com/nimish-nirmal)*
