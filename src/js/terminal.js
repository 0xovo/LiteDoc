
// global logging & diagnostics
window.__litedocMemoryLog = [];
window.__litedocConsoleLog = [];

// Intercept console messages for the crash report
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

console.log = function(...args) {
    origLog.apply(console, args);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    window.__litedocConsoleLog.push(`[LOG] ${new Date().toLocaleTimeString()} - ${msg}`);
    if (window.__litedocConsoleLog.length > 500) window.__litedocConsoleLog.shift();
};
console.warn = function(...args) {
    origWarn.apply(console, args);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    window.__litedocConsoleLog.push(`[WARN] ${new Date().toLocaleTimeString()} - ${msg}`);
    if (window.__litedocConsoleLog.length > 500) window.__litedocConsoleLog.shift();
};
console.error = function(...args) {
    origError.apply(console, args);
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    window.__litedocConsoleLog.push(`[ERROR] ${new Date().toLocaleTimeString()} - ${msg}`);
    if (window.__litedocConsoleLog.length > 500) window.__litedocConsoleLog.shift();
};

// Intercept console warnings and errors
const originalConsoleWarn = console.warn;
console.warn = function(...args) {
    const msg = args.map(a => (typeof a === 'object' && a !== null) ? (a instanceof Error ? a.stack : JSON.stringify(a)) : String(a)).join(' ');
    window.__litedocMemoryLog.push(`[CONSOLE.WARN] ${new Date().toLocaleTimeString()} - ${msg}`);
    originalConsoleWarn.apply(console, args);
};

const originalConsoleError = console.error;
console.error = function(...args) {
    const msg = args.map(a => (typeof a === 'object' && a !== null) ? (a instanceof Error ? a.stack : JSON.stringify(a)) : String(a)).join(' ');
    window.__litedocMemoryLog.push(`[CONSOLE.ERROR] ${new Date().toLocaleTimeString()} - ${msg}`);
    originalConsoleError.apply(console, args);
};

const getSystemMeta = () => {
    let activeFile = 'None';
    let pagesProcessed = 0;
    let totalPages = 0;
    
    // Attempt to read from the live processing UI if active
    const processingSubtitle = document.getElementById('processing-subtitle')?.textContent || '';
    const match = processingSubtitle.match(/(.+?)\s*—\s*Page\s*(\d+)\/(\d+)/);
    if (match) {
        activeFile = match[1];
        pagesProcessed = parseInt(match[2], 10);
        totalPages = parseInt(match[3], 10);
    } else if (window.state) {
        if (window.state.activeDataIndex !== null && window.state.processedData && window.state.processedData[window.state.activeDataIndex]) {
            const ad = window.state.processedData[window.state.activeDataIndex];
            activeFile = ad.filename || 'Unknown';
            pagesProcessed = ad.pages ? ad.pages.length : 0;
            totalPages = pagesProcessed;
        } else if (window.__litedocActiveQueue && window.__litedocActiveQueue.length > 0) {
            activeFile = window.__litedocActiveQueue[0].name;
        } else if (window.state.pendingFiles && window.state.pendingFiles.length > 0) {
            activeFile = window.state.pendingFiles[0].name;
        }
    }

    const currentQueue = (window.__litedocActiveQueue && window.__litedocActiveQueue.length > 0) 
        ? window.__litedocActiveQueue 
        : (window.state ? window.state.pendingFiles : []);

    return {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        screen: `${window.screen.width}x${window.screen.height}`,
        timestamp: new Date().toISOString(),
        theme: document.documentElement.getAttribute('data-theme') || 'dark',
        queueLength: currentQueue.length,
        filesInQueue: currentQueue.map(f => f.name).join(', '),
        activeFile: activeFile,
        activeFileTotalPages: totalPages,
        activeFilePagesProcessed: pagesProcessed,
        processedCount: window.state ? window.state.processedData.length : 0
    };
};

window.addEventListener('error', (e) => {
    const meta = getSystemMeta();
    const errorEntry = `[FATAL_CRASH] ${meta.timestamp}
Error: ${e.message}
Source: ${e.filename}:${e.lineno}:${e.colno}
Stack: ${e.error ? e.error.stack : 'N/A'}
System: ${JSON.stringify(meta, null, 2)}
----------------------------------------`;
    window.__litedocMemoryLog.push(errorEntry);
    console.error('LiteDoc Fatal:', e);
});

window.addEventListener('unhandledrejection', (e) => {
    const meta = getSystemMeta();
    const rejectionEntry = `[PROMISE_REJECTION] ${meta.timestamp}
Reason: ${e.reason}
Stack: ${e.reason && e.reason.stack ? e.reason.stack : 'N/A'}
System: ${JSON.stringify(meta, null, 2)}
----------------------------------------`;
    window.__litedocMemoryLog.push(rejectionEntry);
    console.error('LiteDoc Async Fatal:', e.reason);
});

// term
function logToTerminal(msg, type = 'info') {
    const term = document.getElementById('terminal');
    const liveLog = document.getElementById('live-processing-log');
    
    const timestamp = new Date().toLocaleTimeString().split(' ')[0];
    const logEntry = `[${timestamp}] ${type.toUpperCase()}: ${msg}`;
    window.__litedocMemoryLog.push(logEntry);

    const colors = { info: 'var(--accent)', success: 'var(--success)', warn: 'var(--warn)', error: 'var(--danger)' };
    const labels = { info: 'INFO', success: 'SUCCESS', warn: 'WARN', error: 'ERROR' };
    
    const htmlContent = `<span style="color:${colors[type]}">[${timestamp}] ${labels[type]}:</span> ${msg}`;

    if (term) {
        const p = document.createElement('p');
        p.innerHTML = htmlContent;
        term.appendChild(p);

        if (term.children.length > 200) {
            term.removeChild(term.firstChild);
        }
        term.scrollTop = term.scrollHeight;
    }

    if (liveLog) {
        const pLive = document.createElement('p');
        pLive.innerHTML = htmlContent;
        pLive.className = 'whitespace-nowrap overflow-hidden text-ellipsis mb-0.5 leading-tight';
        liveLog.appendChild(pLive);
        
        if (liveLog.children.length > 50) {
            liveLog.removeChild(liveLog.firstChild);
        }
        liveLog.scrollTop = liveLog.scrollHeight;
    }
}

async function reportIssue() {
    // 1. Prepare Comprehensive Log
    const meta = getSystemMeta();
    const header = `LITEDOC CRASH REPORT
Generated: ${meta.timestamp}
User Agent: ${meta.userAgent}
Platform: ${meta.platform}
Resolution: ${meta.screen}

=== APP STATE ===
Active File: ${meta.activeFile}
Active File Total Pages: ${meta.activeFileTotalPages}
Pages Successfully Processed: ${meta.activeFilePagesProcessed}
Queue Length: ${meta.queueLength} items
Files In Queue: [${meta.filesInQueue}]
Total Files Completed: ${meta.processedCount}
----------------------------------------\n\n`;

    const logText = header + 
        "=== TERMINAL LOGS ===\n" + window.__litedocMemoryLog.join('\n') + 
        "\n\n=== CONSOLE LOGS ===\n" + window.__litedocConsoleLog.join('\n');

    // 2. Download log
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `litedoc-debug-log-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    // 3. Open GitHub
    window.open('https://github.com/0xovo/LiteDoc/issues/new', '_blank');
}

function toggleTerminalModal() {
    const el = document.getElementById('terminal-modal');
    // #main-app-content carries a transform, which turns position:fixed into
    // "fixed to that container": the backdrop covered the page but the card sat
    // off-screen. Living under <body> pins it to the viewport.
    if (el.parentElement !== document.body) document.body.appendChild(el);
    if (el.classList.contains('hidden')) {
        el.classList.remove('hidden');
        el.classList.add('flex');
        document.body.style.overflow = 'hidden';
    } else {
        el.classList.add('hidden');
        el.classList.remove('flex');
        document.body.style.overflow = '';
    }
}

document.addEventListener('keydown', (e) => {
    const el = document.getElementById('terminal-modal');
    if (e.key === 'Escape' && el && !el.classList.contains('hidden')) toggleTerminalModal();
});
document.getElementById('terminal-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) toggleTerminalModal();
});

window.logToTerminal = logToTerminal;
window.reportIssue = reportIssue;
window.toggleTerminalModal = toggleTerminalModal;
window.copyLogsToClipboard = copyLogsToClipboard;

async function copyLogsToClipboard() {
    try {
        const text = window.__litedocMemoryLog.join('\n');
        await navigator.clipboard.writeText(text);
        logToTerminal("Logs copied to clipboard!", "success");
    } catch (e) {
        logToTerminal("Failed to copy logs to clipboard.", "error");
    }
}
