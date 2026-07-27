/**
 * LiteDoc - Editor Controls
 * Manages Ace Editor initialization and text-editing specific actions.
 */

var mdEditor = null;

window.addEventListener('DOMContentLoaded', () => {
    if (typeof ace !== 'undefined') {
        mdEditor = ace.edit("raw-markdown-block");
        window.mdEditor = mdEditor;
        
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        mdEditor.setTheme(isDark ? "ace/theme/tomorrow_night" : "ace/theme/chrome");
        mdEditor.session.setMode("ace/mode/markdown");
        mdEditor.setOptions({
            wrap: true,
            fontSize: "13px",
            fontFamily: "'JetBrains Mono', monospace",
            showPrintMargin: false,
            useWorker: false,
            highlightActiveLine: true,
            showLineNumbers: true,
            showGutter: true,
            showFoldWidgets: true
        });
        mdEditor.renderer.setPadding(12);

        mdEditor.commands.addCommand({
            name: 'save',
            bindKey: { win: "Ctrl-S", "mac": "Cmd-S" },
            exec: function (editor) {
                window.saveEdits(false);
            }
        });
        
        mdEditor.container.style.background = "var(--bg-dark)";

        mdEditor.session.on('change', () => {
            if (window.isSyncingAce || state.activeDataIndex === null || !state.isEditing) return;

            if (!state.hasUnsavedChanges) {
                state.hasUnsavedChanges = true;
                const dot = document.getElementById('viewer-header-dot');
                if (dot) dot.style.background = '#f59e0b';
                const indicator = document.getElementById('viewer-unsaved-indicator');
                if (indicator) indicator.classList.remove('hidden');
            }

            if (state.currentViewMode === 'split') {
                clearTimeout(window.splitRenderTimeout);
                window.splitRenderTimeout = setTimeout(() => {
                    if (window.renderMarkdown) window.renderMarkdown(mdEditor.getValue());
                }, 300);
            }
        });
    }
});

function toggleLineNumbers() {
    if (mdEditor) {
        const current = mdEditor.getOption("showLineNumbers");
        mdEditor.setOption("showLineNumbers", !current);
        const btn = document.getElementById('vm-linenumbers');
        if (btn) {
            btn.style.color = !current ? 'var(--accent-hi)' : 'var(--text-2)';
            btn.style.background = !current ? 'var(--accent-low)' : 'transparent';
        }
    }
}

function toggleFindReplace() {
    if (mdEditor) {
        if (mdEditor.searchBox && mdEditor.searchBox.active) {
            mdEditor.searchBox.hide();
        } else {
            mdEditor.execCommand('replace');
        }
    }
}

function toggleWordWrap() {
    if (mdEditor) {
        const current = mdEditor.getOption("wrap");
        const isWrapped = current === true || current === "free";
        mdEditor.setOption("wrap", !isWrapped);
        const btn = document.getElementById('vm-wordwrap');
        if (btn) {
            btn.style.color = !isWrapped ? 'var(--accent-hi)' : 'var(--text-2)';
            btn.style.background = !isWrapped ? 'var(--accent-low)' : 'transparent';
        }
    }
}

function enterEditMode() {
    state.isEditing = true;
    if (state.currentViewMode === 'rendered' || state.currentViewMode === 'pdf') {
        window.setViewMode('raw');
    } else {
        window.setViewMode(state.currentViewMode);
    }
}

function saveEdits(exitEdit = true) {
    if (state.activeDataIndex !== null && mdEditor) {
        state.processedData[state.activeDataIndex].mdText = mdEditor.getValue();
        delete state.processedData[state.activeDataIndex].draftText;

        state.hasUnsavedChanges = false;
        const dot = document.getElementById('viewer-header-dot');
        if (dot) dot.style.background = 'var(--accent)';
        const indicator = document.getElementById('viewer-unsaved-indicator');
        if (indicator) indicator.classList.add('hidden');

        if (exitEdit) {
            state.isEditing = false;
            window.setViewMode(state.currentViewMode);
        }
    }
}

function cancelEdits() {
    if (state.activeDataIndex !== null && mdEditor) {
        delete state.processedData[state.activeDataIndex].draftText;
        state.hasUnsavedChanges = false;
        const dot = document.getElementById('viewer-header-dot');
        if (dot) dot.style.background = 'var(--accent)';
        const indicator = document.getElementById('viewer-unsaved-indicator');
        if (indicator) indicator.classList.add('hidden');

        const originalText = state.processedData[state.activeDataIndex].mdText;
        if (mdEditor.getValue() !== originalText) {
            window.isSyncingAce = true;
            const session = mdEditor.getSession();
            const scrollY = session.getScrollTop();
            const cursorPos = mdEditor.getCursorPosition();
            mdEditor.setValue(originalText, -1);
            mdEditor.moveCursorToPosition(cursorPos);
            session.setScrollTop(scrollY);
            window.isSyncingAce = false;
        }

        state.isEditing = false;
        window.setViewMode(state.currentViewMode);
    }
}

function unformatMarkdown() {
    if (mdEditor) {
        const selection = mdEditor.getSelectionRange();
        const selectedText = mdEditor.session.getTextRange(selection);
        if (!selectedText) return;

        // strip basic markdown characters (#, *, _, |, ---)
        const unformattedText = selectedText.replace(/[#*_|]|---/g, '');
        mdEditor.session.replace(selection, unformattedText);
        mdEditor.focus();
    }
}

function undoEdit() {
    if (mdEditor) {
        mdEditor.undo();
        mdEditor.focus();
    }
}

function redoEdit() {
    if (mdEditor) {
        mdEditor.redo();
        mdEditor.focus();
    }
}

// Global Exposures
window.toggleLineNumbers = toggleLineNumbers;
window.toggleFindReplace = toggleFindReplace;
window.toggleWordWrap = toggleWordWrap;
window.enterEditMode = enterEditMode;
window.saveEdits = saveEdits;
window.cancelEdits = cancelEdits;
window.unformatMarkdown = unformatMarkdown;
window.undoEdit = undoEdit;
window.redoEdit = redoEdit;
