// Shared, extension-agnostic UI: everything here renders the same inside the
// content-script shadow root and in Storybook. Code that needs extension APIs
// (wxt storage, runtime messaging) lives in apps/extension instead.

// --- lib ---------------------------------------------------------------------
export * from './lib/identity';
export * from './lib/match-patterns';
export * from './lib/motion';
export * from './lib/page-elements';
export * from './lib/settings';
export * from './lib/shell';
export * from './lib/view-transitions';

// --- fixtures ------------------------------------------------------------------
export * from './fixtures/answers';

// --- components ---------------------------------------------------------------
export * from './components/Markdown';
export * from './components/PromptPanel';
export * from './components/SharedElement';
export * from './components/report/ReportView';
export * from './components/report/TaskActivityView';
export * from './components/prompt-input/PromptInput';
export * from './components/shell/AnswerCard';
export * from './components/shell/BowtieMark';
export * from './components/shell/CollapsedPill';
export * from './components/shell/ContextChips';
export * from './components/shell/AgentHighlight';
export * from './components/shell/ElementHighlight';
export * from './components/shell/ElementPickerOverlay';
export * from './components/shell/MenuPanel';
export * from './components/shell/TaskStrip';
export * from './components/shell/TaskToast';
export * from './components/shell/RepairToast';
export * from './components/shell/GhostCursor';
export * from './components/shell/OnboardingCard';
export * from './components/shell/PlusButton';
export * from './components/shell/views/ArtifactsView';
export * from './components/shell/views/ExtensionsView';
export * from './components/shell/views/ListRow';
export * from './components/shell/views/TasksView';
export * from './components/shell/views/ProvidersView';
export * from './components/shell/views/SettingsView';
export * from './components/shell/views/useRovingRows';
export * from './components/shell/views/ViewHeader';
