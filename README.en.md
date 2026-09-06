# ACM Workflow

> A local Codeforces practice workbench inside VS Code: problem selection, translation, testing, stress testing, data generation, contest management, and progress tracking.

[中文](README.md) | **English**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Introduction

ACM Workflow is a VS Code extension that brings the common Codeforces practice tasks into one workbench, so you do not need to switch between the browser, terminal, and editor.

Runtime data stays on your machine by default. The extension does not depend on a cloud AI service; local translation and test-data generation models are optional.

## Features

- Pick problems in the editor by difficulty or algorithm tag, with random or weak-point recommendations
- Create problem files automatically and fetch statements and samples
- Run tests, stress tests, and generate test data
- Manage contests and standings, and follow specific handles
- Track accepted submissions and statistics locally
- Compatible with the Competitive Companion protocol (port 27121) for one-click import from the browser

Detailed capabilities:

- **Codeforces problem picker**: filter by rating range (800–3500) and tags; random or weak-point recommendation.
- **URL import**: supports `problemset`, `contest`, and `gym` Codeforces links.
- **Contest management**: round list, problem list, top-20 standings, followed handles, one-click contest creation.
- **Statements and translation**: fetch and typeset statements; supports MyMemory, LibreTranslate, DeepSeek, and local llama.cpp backends with a three-level cache.
- **Built-in tester**: compiles and runs cases one by one, marks timeouts and errors, and records AC automatically when all pass.
- **General stress tester**: compares the intended solution with a brute-force solution; supports exact, token, floating-point error, and special judges.
- **Data generator**: pipeline-style test data generation with variable dependencies, script generation, and sample-based generation.
- **Practice log**: SQLite local storage; tag, difficulty, and streak statistics; Codeforces history import.
- **Environment diagnostics**: detects local translation models and toolchains, and produces a redacted diagnostic report.
- **Themes**: includes two VS Code color themes and an optional glassmorphism background that links with [VSCode Background](https://github.com/caoge5524/vscode-background).

## Installation

### Install from Releases

1. Download `acm-workflow-<version>.vsix` from [Releases](https://github.com/dargonburn337845818/ACM-workflow/releases).
2. In the VS Code extensions panel, choose "Install from VSIX".
3. Press `Ctrl+Alt+A` (macOS `Cmd+Alt+A`) to open the workbench.

After pushing a `vX.Y.Z` tag, GitHub Actions builds the VSIX and publishes it to Releases automatically.

### Run from source

```bash
git clone https://github.com/dargonburn337845818/ACM-workflow.git
cd ACM-workflow
npm install --include=dev
npm run compile
```

Then press `F5` to start the Extension Development Host.

## Quick Start

1. Configure your Codeforces handle in `Settings → acmWorkflow.cfHandle`, or bind one from the "Logs" page in the workbench.
2. Open the workbench with `Ctrl+Alt+A`.
3. Set the difficulty on the problem picker page, choose "Random" or "Weak points", or paste a problem URL.
4. The extension creates the C++ file and samples automatically; run the tests and all passing cases are marked AC.

See [docs/getting-started.md](docs/getting-started.md) for the full tutorial.

## Documentation

- [Feature overview](docs/features.md)
- [Configuration](docs/configuration.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Changelog](docs/changelog.md)

## Project Layout

```text
src/                 # VS Code extension source (features/services/core/utils)
media/               # workbench frontend
themes/              # VS Code color themes
knowledge-ladder/    # standalone Python knowledge-ladder subproject
tools/               # local translation and helper tools
tests/               # smoke tests without a VS Code environment
docs/                # user and developer documentation
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for a detailed module map.

## Development

```bash
npm run compile
npm run lint
npm test
```

After changing the knowledge-ladder subproject, run `python3 export_mobile_data.py` to verify data export.

## Privacy and Security

- Sensitive values (CF Cookie, DeepSeek API Key) are stored only in `vscode.SecretStorage`, never in settings, logs, or Git.
- Problems, logs, and caches live in `~/.acm-workflow/` by default.
- Diagnostic reports redact the home directory, email addresses, and likely secrets before output.
- `D:\...` paths in the docs are author-machine examples; replace them with your own environment.

See [SECURITY.md](SECURITY.md) for the full security policy.

## Contributing

Issues and pull requests are welcome. Before submitting:

1. Run `npm run lint`, `npm test`, and `npm run compile`.
2. Describe the change, verification results, and privacy impact in the PR.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full process and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community guidelines.

## License

[MIT](LICENSE)
