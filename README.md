<div align="center">
  <h3>A privacy-first, client-side repository-to-prompt optimizer that compresses local codebases into structured payloads for LLM context windows.</h3>

  [![License: MIT](https://img.shields.io/badge/MIT_License-blue)](LICENSE)
  ![Platform: Browser](https://img.shields.io/badge/Platform-Browser-orange)
  [![Deploy: Vercel](https://img.shields.io/badge/Deployed%20using-Vercel-purple)](https://vercel.app)

  [Live Demo](https://contextsync-web-application.vercel.app/) · [Repository](https://github.com/PolarExpo/ContextSync)

</div>

---

ContextSync solves the modern developer pain point of context drift and token bloat during AI prompt-driven workflows. Instead of manually copying files or feeding bloated folders into AI assistants, ContextSync parses, filters, and tokenizes your repository directly in the browser—ensuring zero data leakage and optimal token efficiency.

## Core Features

### Processing Pipeline

| Feature | Details |
|---------|---------|
| **Zero-Server Privacy** | Powered entirely by the HTML5 File System Access API. Your proprietary code never leaves your local machine. |
| **Local Tiktoken Engine** | Utilizes a client-side WASM tokenizer to calculate exact OpenAI/Anthropic token counts in real time. |
| **Smart Dependency Filtering** | Automated exclusion filters for `node_modules`, lockfiles, build artifacts, and binary assets. |
| **.gitignore Synchronization** | Intelligently parses local `.gitignore` rules to dynamically mirror your version control exclusions in the file tree view. |
| **AST-Style Compression** | Strips formatting bloat and comment structures to shrink payload sizes while preserving semantic code integrity. |
| **Token Fiscal Monitor** | Built-in cost estimation metrics calculating precise input overhead for major models (GPT-4o, Claude 3.5 Sonnet). |

### Export Architecture

ContextSync structures data inside clean Markdown notation blocks complete with automated architectural routing trees. This helps receiving models maintain perfect situational awareness of your framework layout, eliminating "lost in the middle" attention bugs and inflated API billing.

## Technical Stack & Layout

| Layer | Technology |
|-------|------------|
| **Frontend Core** | React 18, TypeScript, Vite |
| **Styling Engine** | Tailwind CSS, Shadcn UI, Lucide Icons |
| **Token Analysis** | `@dqbd/tiktoken` (WebAssembly-bound BPE tokenizer) |
| **File System API** | Native Browser Directory Reading |

```text
├── src/
│   ├── components/         # Atomic UI components (FileTree, TokenBudget, Preview)
│   ├── utils/              # Client-side processing scripts (.gitignore parser, text compressor)
│   ├── App.tsx             # Master Dashboard layout and state coordination
│   └── main.tsx            # Application mounting point
```

## Local Installation & Quickstart

To run this project locally or inspect the source pipeline:

1. **Clone the repository:**
   ```bash
   git clone https://github.com.git
   cd ContextSync
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Launch the development workspace:**
   ```bash
   npm run dev
   ```

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for the full text.

> [!IMPORTANT]
> Keep all copyright headers intact and include the original attribution in any redistribution or derivative work. Details are in the core configuration files.
