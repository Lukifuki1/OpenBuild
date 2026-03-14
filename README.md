<a name="readme-top"></a>

<div align="center">
  <img src="https://raw.githubusercontent.com/OpenHands/docs/main/openhands/static/img/logo.png" alt="Logo" width="200">
  <h1 align="center" style="border-bottom: none">OpenBuild</h1>
</div>

<div align="center">
  <a href="https://github.com/All-Hands-AI/OpenBuild/blob/main/LICENSE"><img src="https://img.shields.io/badge/LICENSE-MIT-20B2AA?style=for-the-badge" alt="MIT License"></a>
  <a href="#"><img src="https://img.shields.io/badge/Agent%20Readiness-L1-00cc00?logoColor=FFE165&style=for-the-badge" alt="Agent Readiness Level"></a>
  <br/>
  <a href="#documentation"><img src="https://img.shields.io/badge/Documentation-45%25-00cc00?logoColor=FFE165&style=for-the-badge" alt="Documentation Status"></a>
  <a href="#"><img src="https://img.shields.io/badge/Testing-62%25-00cc00?logoColor=FFE165&style=for-the-badge" alt="Testing Score"></a>
</div>

<hr>

## Table of Contents

- [About](#about)
- [Features](#features)
- [Getting Started](#getting-started)
- [Development](#development)
- [Testing](#testing)
- [Agent Capabilities](#agent-capabilities)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## About

OpenBuild is a production-ready AI-driven development platform built on OpenHands technology. The project provides a comprehensive environment for autonomous software development with integrated agent tooling, extensible architecture, and enterprise-grade security features.

### Current Status

| Metric | Status |
|--------|--------|
| Agent Readiness Level | L1 (Initial) |
| Overall Score | 45.3% (34/75 criteria) |
| Level Progress | L1: 90% achieved, L2: 71% to go, L3: 68% to go, L4: 86% to go |

### Technical Stack

- **Languages**: Python, TypeScript
- **Framework**: FastAPI (Backend), React (Frontend)
- **Runtime**: Docker, Local
- **Target**: CLI Tool

---

## Features

### Core Capabilities

- **AI Agent Integration** - Full support for CodeAct agents with extensible tool system
- **Multi-Modal Development** - Editor, Browser, Terminal, Planner, and Task List interfaces
- **File Management** - Advanced file editing with str_replace editor
- **Browser Automation** - Integrated browser tooling for web interactions
- **Task Planning** - Built-in planner and task tracker for complex workflows
- **Media Generation** - Photo and Video generation capabilities (NEW)

### Platform Components

| Component | Description |
|-----------|-------------|
| SDK | Python library for building AI agents |
| CLI | Command-line interface for agent execution |
| Local GUI | Browser-based React interface |
| Cloud | Hosted multi-user deployment |
| Enterprise | Self-hosted Kubernetes deployment |

---

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 22.x
- Docker (optional, for containerized runtime)

### Quick Setup

```bash
# Clone the repository
git clone https://github.com/All-Hands-AI/OpenBuild.git
cd OpenBuild

# Install dependencies
make build

# Run the application
make run
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| WORKSPACE_OUTPUT_DIR | /workspace/output | Output directory for generated files |
| IMAGE_MODEL | black-forest-labs/FLUX.1-schnell | Image generation model |
| VIDEO_MODEL | stabilityai/stable-video-diffusion | Video generation model |
| GPU_ENABLED | true | Enable GPU acceleration |
| MAX_IMAGE_SIZE | 1024 | Maximum image dimension |
| MAX_VIDEO_DURATION | 10.0 | Maximum video duration (seconds) |

---

## Development

### Project Structure

```
OpenBuild/
├── openhands/           # Main backend code
│   ├── agenthub/        # Agent implementations
│   ├── app_server/      # FastAPI application server
│   ├── server/          # Server services
│   └── runtime/         # Runtime environments
├── frontend/            # React frontend
│   └── src/
│       ├── api/         # API clients
│       ├── components/  # React components
│       ├── routes/      # Page routes
│       └── stores/      # State management
├── enterprise/          # Enterprise features
├── tests/              # Test suites
└── Makefile            # Build automation
```

### Available Commands

```bash
# Build the project
make build

# Run in development mode
make run

# Run tests
make test

# Run linters
make lint

# Clean build artifacts
make clean
```

### Pre-commit Hooks

This project uses pre-commit hooks for code quality. Install them with:

```bash
make install-pre-commit-hooks
```

---

## Testing

### Test Infrastructure

The project maintains comprehensive testing across multiple levels:

| Test Type | Status | Description |
|-----------|--------|-------------|
| Unit Tests | Present | Located in tests/unit/ |
| Integration Tests | Present | Located in tests/integration/ |
| E2E Tests | Present | Located in tests/e2e/ |
| Test Naming | Enforced | Conventions followed |
| Test Isolation | Supported | Parallel execution enabled |

### Running Tests

```bash
# Run all tests
pytest

# Run specific test suite
pytest tests/unit/
pytest tests/e2e/

# Run with coverage
pytest --cov=openhands tests/
```

### Coverage Thresholds

Note: Current Status - No coverage thresholds configured. Consider setting minimum coverage requirements.

---

## Agent Capabilities

### Available Tools

The CodeAct agent provides the following tools:

| Tool | Description |
|------|-------------|
| execute_bash | Execute shell commands |
| str_replace_editor | Edit files with precision |
| browser | Web browser automation |
| task_tracker | Track development tasks |
| generate_image | AI image generation (NEW) |
| generate_video | AI video generation (NEW) |

### Media Generation

The newly added Photo and Video generation capabilities include:

#### Image Generation
- **Models**: FLUX, Stable Diffusion XL, Stable Diffusion 2.1
- **Resolutions**: 512x512, 1024x1024, 1024x768, 768x1024
- **Features**: Custom styles, negative prompts, configurable inference

#### Video Generation
- **Duration**: 2-10 seconds
- **FPS Options**: 24, 30, 60
- **Resolutions**: Multiple aspect ratios supported

### Agent-Readable Documentation

An AGENTS.md file is provided for AI agents to understand the codebase structure and available commands.

---

## Security

### Security Status

| Feature | Status |
|---------|--------|
| Comprehensive .gitignore | Enabled |
| Secrets Management | Enabled |
| CODEOWNERS | Configured |
| Dependency Update Automation | Enabled |
| PII Handling | Implemented |
| Automated Security Review | Enabled |
| Secret Scanning | Enabled |

### Best Practices

- All dependencies are pinned via lockfile
- Automated security scanning enabled
- Branch protection rules recommended for production deployments

---

## Contributing

### Ways to Contribute

1. **Report Issues** - Use GitHub issue templates
2. **Submit Pull Requests** - Follow PR templates
3. **Improve Documentation** - Help us reach 100% documentation coverage
4. **Add Tests** - Increase test coverage from current 62%
5. **Feature Development** - Help implement L2-L5 maturity features

### Development Guidelines

- Follow existing code style and conventions
- Ensure all tests pass before submitting PRs
- Update documentation for any new features
- Use meaningful commit messages

### Issue Labels

Note: Current Status - No issue labeling system configured. Consider implementing a labeling strategy.

---

## Roadmap

### Maturity Level Progression

| Level | Target | Current Gap |
|-------|--------|-------------|
| L1 | 90% | Achieved |
| L2 | 71% | 29% to go |
| L3 | 32% | 68% to go |
| L4 | 14% | 86% to go |
| L5 | 0% | 100% to go |

### Priority Improvements

Based on the readiness audit, the following areas need attention:

1. **Style and Validation (30%)**
   - Enable strict typing
   - Configure pre-commit hooks
   - Enforce naming conventions

2. **Debugging and Observability (10%)**
   - Add code quality metrics
   - Implement error tracking
   - Configure distributed tracing
   - Add profiling instrumentation

3. **Documentation (37%)**
   - Generate API schema documentation
   - Add automated doc generation
   - Document service flows
   - Implement AGENTS.md validation

4. **Product and Analytics (0%)**
   - Set up error-to-insight pipeline
   - Implement product analytics

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.

The core openhands and agent-server Docker images are fully MIT-licensed.

---

## Support

- **Documentation**: https://docs.openhands.dev
- **Community Slack**: https://dub.sh/openhands
- **Issue Tracker**: https://github.com/All-Hands-AI/OpenBuild/issues
- **Product Roadmap**: https://github.com/orgs/All-Hands-AI/projects/1

---

<p align="right"><a href="#readme-top">Back to top</a></p>
