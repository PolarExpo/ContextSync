import { useCallback, useMemo, useRef, useState } from 'react';
import { Boxes, RotateCcw } from 'lucide-react';
import type { FileNode, CompressOptions } from '@/lib/types';
import { CONTEXT_WINDOWS } from '@/lib/types';
import {
  isSupported, readDirectory, readFileText, flattenFiles, buildTreeString, countTextFiles,
} from '@/lib/fileSystem';
import { estimateTokens } from '@/lib/tokens';
import { isNoise } from '@/lib/noise';
import { parseGitignore, collectIgnoredIds } from '@/lib/gitignore';
import { buildHeader, compressFile } from '@/lib/compress';
import { DropZone } from '@/components/DropZone';
import { FileTree } from '@/components/FileTree';
import { TokenBudget } from '@/components/TokenBudget';
import { PreviewPanel } from '@/components/PreviewPanel';
import { LivePreview } from '@/components/LivePreview';
import { CostWidget } from '@/components/CostWidget';

const DEFAULT_OPTS: CompressOptions = {
  stripComments: true,
  stripWhitespace: true,
  includeHeader: true,
};

function filterNoise(nodes: FileNode[]): FileNode[] {
  return nodes
    .filter((n) => !isNoise(n.name, n.type === 'directory'))
    .map((n) => (n.type === 'directory' ? { ...n, children: filterNoise(n.children || []) } : n));
}

type GitignoreStatus = 'idle' | 'searching' | 'applied' | 'not-found' | 'error';

function App() {
  const [rawTree, setRawTree] = useState<FileNode[]>([]);
  const [rootName, setRootName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [autoHideNoise, setAutoHideNoise] = useState(true);
  const [loading, setLoading] = useState(false);
  const [contextLimit, setContextLimit] = useState(CONTEXT_WINDOWS[1].tokens);
  const [options, setOptions] = useState<CompressOptions>(DEFAULT_OPTS);
  const [output, setOutput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [gitignoreStatus, setGitignoreStatus] = useState<GitignoreStatus>('idle');
  const rootHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const supported = useMemo(() => isSupported(), []);

  const tree = useMemo(() => (autoHideNoise ? filterNoise(rawTree) : rawTree), [rawTree, autoHideNoise]);

  const allFiles = useMemo(() => flattenFiles(tree), [tree]);
  const totalTokens = useMemo(() => allFiles.reduce((s, f) => s + f.tokenCount, 0), [allFiles]);

  const selectedFiles = useMemo(() => allFiles.filter((f) => selected.has(f.id)), [allFiles, selected]);
  const selectedTokens = useMemo(() => selectedFiles.reduce((s, f) => s + f.tokenCount, 0), [selectedFiles]);
  const outputTokens = useMemo(() => estimateTokens(output), [output]);

  const handlePick = useCallback(async () => {
    if (!supported) return;
    try {
      // @ts-expect-error - showDirectoryPicker is not in standard TS lib
      const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker();
      setLoading(true);
      setRootName(handle.name);
      rootHandleRef.current = handle;
      // Always read the full tree; noise filtering happens in-memory
      const nodes = await readDirectory(handle, '', false);
      setRawTree(nodes);
      // auto-select all text files by default (up to a sane cap)
      const visible = autoHideNoise ? filterNoise(nodes) : nodes;
      const fileIds = flattenFiles(visible).filter((f) => f.tokenCount > 0).map((f) => f.id);
      const cap = 200;
      setSelected(new Set(fileIds.slice(0, cap)));
      setOutput('');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [supported, autoHideNoise]);

  const handleToggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback((ids: string[], select: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (select) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const handleToggleAutoHide = useCallback(() => {
    setAutoHideNoise((prev) => !prev);
  }, []);

  const handleGitignoreSync = useCallback(async () => {
    if (!rootHandleRef.current) return;
    setGitignoreStatus('searching');
    try {
      // Try to find .gitignore at root level
      let gitignoreHandle: FileSystemFileHandle | null = null;
      try {
        gitignoreHandle = await rootHandleRef.current.getFileHandle('.gitignore');
      } catch {
        setGitignoreStatus('not-found');
        return;
      }
      const file = await gitignoreHandle.getFile();
      const content = await file.text();
      const rules = parseGitignore(content);
      if (rules.length === 0) {
        setGitignoreStatus('not-found');
        return;
      }
      // Collect all ignored IDs from the raw (unfiltered) tree
      const ignoredIds = collectIgnoredIds(rawTree, rules);
      if (ignoredIds.length === 0) {
        setGitignoreStatus('applied');
        return;
      }
      // Also collect all child IDs of ignored directories
      const allIgnoredIds = new Set<string>();
      const collectAll = (nodes: FileNode[]) => {
        for (const node of nodes) {
          if (allIgnoredIds.has(node.id)) continue;
          if (ignoredIds.includes(node.id)) {
            allIgnoredIds.add(node.id);
            // add all descendant ids
            const addDescendants = (n: FileNode) => {
              if (n.children) {
                for (const child of n.children) {
                  allIgnoredIds.add(child.id);
                  addDescendants(child);
                }
              }
            };
            addDescendants(node);
            continue;
          }
          if (node.children) collectAll(node.children);
        }
      };
      collectAll(rawTree);

      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of allIgnoredIds) next.delete(id);
        return next;
      });
      setGitignoreStatus('applied');
    } catch {
      setGitignoreStatus('error');
    }
  }, [rawTree]);

  const handleGenerate = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    setIsGenerating(true);
    try {
      const treeString = buildTreeString(tree, selected);
      const parts: string[] = [];
      if (options.includeHeader) parts.push(buildHeader(treeString));

      for (const file of selectedFiles) {
        if (!file.handle) continue;
        let content = '';
        try {
          content = await readFileText(file.handle);
        } catch {
          continue;
        }
        parts.push(compressFile(file.path, content, options));
      }
      setOutput(parts.join('\n'));
    } finally {
      setIsGenerating(false);
    }
  }, [selectedFiles, tree, selected, options]);

  const handleReset = useCallback(() => {
    setRawTree([]);
    setRootName('');
    setSelected(new Set());
    setOutput('');
    setGitignoreStatus('idle');
    rootHandleRef.current = null;
  }, []);

  const hasFolder = rawTree.length > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* header */}
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
              <Boxes className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-slate-100">ContextSync</h1>
              <p className="text-xs text-slate-500">Local codebase → AI-ready context</p>
            </div>
          </div>
          {hasFolder && (
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-slate-700 transition hover:bg-slate-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              New Folder
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6">
        {!hasFolder ? (
          <div className="mx-auto max-w-2xl pt-8">
            <div className="mb-8 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-slate-100">
                Compress your codebase into AI-ready context
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-slate-400">
                Drop in a project folder and ContextSync builds a token-aware, structured
                Markdown bundle you can paste straight into any AI prompt — all in your browser.
              </p>
            </div>
            <DropZone onPickDirectory={handlePick} isSupported={supported} />
            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FeatureCard title="Token Budgeting" desc="Track tokens against 32k–200k context windows in real time." />
              <FeatureCard title="Smart Noise Filter" desc="Auto-hides node_modules, lockfiles, images, and build output." />
              <FeatureCard title="Prompt Compression" desc="Strips comments and whitespace, injects a system header." />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
            {/* left: file tree */}
            <div className="flex h-[calc(100vh-140px)] flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/30">
              <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2.5">
                <span className="text-sm font-medium text-slate-300">{rootName}</span>
                <span className="text-xs text-slate-600">/</span>
                <span className="ml-auto text-xs text-slate-500">
                  {countTextFiles(tree)} text files
                </span>
              </div>
              <div className="flex-1 overflow-hidden">
                <FileTree
                  nodes={tree}
                  selected={selected}
                  onToggle={handleToggle}
                  onToggleAll={handleToggleAll}
                  autoHideNoise={autoHideNoise}
                  onToggleAutoHide={handleToggleAutoHide}
                  onGitignoreSync={handleGitignoreSync}
                  gitignoreStatus={gitignoreStatus}
                  loading={loading}
                />
              </div>
            </div>

            {/* right: sidebar + preview */}
            <div className="flex h-[calc(100vh-140px)] flex-col gap-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
                <TokenBudget
                  totalTokens={totalTokens}
                  selectedTokens={selectedTokens}
                  selectedCount={selectedFiles.length}
                  contextLimit={contextLimit}
                  onContextLimitChange={setContextLimit}
                />
              </div>
              <CostWidget tokens={selectedTokens} />
              <LivePreview
                output={output}
                outputTokens={outputTokens}
                isGenerating={isGenerating}
              />
              <div className="flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/30">
                <PreviewPanel
                  output={output}
                  outputTokens={outputTokens}
                  isGenerating={isGenerating}
                  options={options}
                  onOptionsChange={setOptions}
                  onGenerate={handleGenerate}
                  hasSelection={selectedFiles.length > 0}
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <p className="mt-1 text-xs text-slate-500">{desc}</p>
    </div>
  );
}

export default App;
