
// dropzone
var dropZone = document.getElementById('drop-zone');
var fileInput = document.getElementById('file-input');

// pdf icon (clean version)
function pdfIconSvg(color) {
    return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" fill="${color || 'var(--accent)'}" fill-opacity="0.15"/>
                <path d="M14 2v6h6" stroke="${color || 'var(--accent)'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="${color || 'var(--accent)'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderDropZone() {
    const empty = document.getElementById('dz-empty');
    const list = document.getElementById('dz-list');
    const dropZone = document.getElementById('drop-zone');

    if (state.pendingFiles.length === 0) {
        empty.classList.remove('hidden'); empty.classList.add('flex');
        list.classList.add('hidden'); list.classList.remove('flex');
        dropZone.classList.remove('has-files');
        dropZone.style.minHeight = '220px';
        return;
    }

    empty.classList.add('hidden'); empty.classList.remove('flex');
    list.classList.remove('hidden'); list.classList.add('flex');
    dropZone.classList.add('has-files');
    dropZone.style.minHeight = 'auto';

    const count = state.pendingFiles.length;
    const label = `${count} file${count > 1 ? 's' : ''}`;

    document.getElementById('dz-list-count').textContent = label;
    const el = document.getElementById('start-btn-list-label');
    if (el) el.textContent = `Process ${label}`;

    const listContainer = document.getElementById('dz-list-container');
    listContainer.innerHTML = '';

    state.pendingFiles.forEach((f, i) => {
        const row = document.createElement('div');
        row.className = 'dz-file-row dz-card-in';

        const isProtected = f.triage === 'password';
        const cursorStyle = isProtected ? 'cursor:pointer' : 'cursor:default';

        row.style.cssText = `display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg-card);animation-delay:${i * 0.03}s;${cursorStyle}`;

        if (isProtected) {
            row.onclick = () => unlockPendingFile(i);
            row.title = "Click to unlock this PDF";
            row.onmouseover = () => { if (!row.classList.contains('animate-shake')) { row.style.borderColor = 'var(--accent)'; row.style.background = 'var(--bg-input)'; } };
            row.onmouseout = () => { if (!row.classList.contains('animate-shake')) { row.style.borderColor = 'var(--border)'; row.style.background = 'var(--bg-card)'; } };
        }

        let triageTag = '';
        if (f.triage) {
            const tagMap = {
                'analyzing': { label: 'Analyzing...', bg: 'rgba(99,102,241,0.1)', color: 'var(--accent)' },
                'native': { label: 'Text-Rich', bg: 'rgba(16,185,129,0.1)', color: 'var(--success)' },
                'ocr': { label: 'OCR Needed', bg: 'rgba(245,158,11,0.1)', color: 'var(--warn)' },
                'password': { label: 'Protected', bg: 'rgba(225,29,72,0.1)', color: 'var(--danger)' }
            };
            const config = tagMap[f.triage] || tagMap['native'];
            let label = config.label;
            triageTag = `<span style="font-size:9px;font-weight:bold;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:${config.bg};color:${config.color};margin-left:4px;border:1px solid ${config.bg}">${label}</span>`;
        }

        row.innerHTML = `
                    <div style="width:24px;height:28px;flex-shrink:0">${pdfIconSvg(isProtected ? 'var(--danger)' : 'var(--accent)')}</div>
                    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;">
                        <div style="display:flex;align-items:center;min-width:0">
                            <span style="font-size:12px;font-weight:600;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${f.name}">${f.name}</span>
                            ${triageTag}
                        </div>
                        <span style="font-size:10px;color:var(--text-3);font-family:'JetBrains Mono',monospace">${formatBytes(f.size)} ${f.pages ? '• ' + f.pages + ' pages' : (isProtected ? '• Click to unlock' : '')}</span>
                    </div>
                    <button onclick="removePendingFile(${i});event.stopPropagation();"
                        style="width:28px;height:28px;border-radius:8px;background:transparent;border:1px solid transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-3);transition:all 0.15s;flex-shrink:0"
                        onmouseover="this.style.color='var(--danger)';this.style.background='rgba(244,63,94,0.08)'"
                        onmouseout="this.style.color='var(--text-3)';this.style.background='transparent'"
                        title="Remove">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                    </button>`;
        listContainer.appendChild(row);
    });
}

function removePendingFile(idx) {
    const rows = document.querySelectorAll('.dz-file-row');
    if (rows[idx]) {
        rows[idx].style.animation = 'dzCardOut 0.3s ease forwards';
        setTimeout(() => {
            state.pendingFiles.splice(idx, 1);
            if (state.pendingFiles.length === 0) {
                document.getElementById('file-input').value = '';
            }
            renderDropZone();
        }, 250);
    } else {
        state.pendingFiles.splice(idx, 1);
        renderDropZone();
    }
}

function clearQueue() {
    state.pendingFiles = [];
    document.getElementById('file-input').value = '';
    renderDropZone();
}

// legacy alias
function updateStartButton() { renderDropZone(); }

async function unlockPendingFile(idx) {
    const file = state.pendingFiles[idx];
    if (!file || file.triage !== 'password') return;

    if (window.__litedocAddons && typeof window.__litedocAddons.loadPdfWithPassword === 'function') {
        try {
            const arrayBuffer = await file.arrayBuffer();
            // loadPdfWithPassword now returns { pdf, password }
            const result = await window.__litedocAddons.loadPdfWithPassword(arrayBuffer, file.name);

            if (result && result.pdf) {
                file.password = result.password; // Store the password for subsequent triage/conversion
                file.triage = 'analyzing';
                renderDropZone();

                // Re-triage with the provided password
                await window.__litedocAddons.triageFiles(state.pendingFiles, pdfjsLib, idx, result.password);
                renderDropZone();

                // PDF.js v6: destroy via the loading task, not the proxy.
                try {
                    if (result.pdf.__loadingTask) await result.pdf.__loadingTask.destroy();
                    else if (typeof result.pdf.destroy === 'function') await result.pdf.destroy();
                } catch (e) {}
            }
        } catch (err) {
            console.warn('Unlock cancelled or failed', err);
            renderDropZone();
        }
    }
}

async function handleStartProcess(e) {
    e.preventDefault();
    e.stopPropagation();

    if (state.pendingFiles.length) {
        // Check if any file is still analyzing
        if (state.pendingFiles.some(f => f.triage === 'analyzing')) {
            window.showAlert("Analysis in Progress", "Please wait for file analysis to complete.");
            return;
        }

        // Check for protected files
        if (state.pendingFiles.some(f => f.triage === 'password')) {
            const count = state.pendingFiles.filter(f => f.triage === 'password').length;
            window.showAlert("Protected Files Detected", `Please unlock the ${count} protected file(s) in your queue before starting.`);
            return;
        }

        // UI feedback
        const startBtn = document.getElementById('start-process-btn-list');
        const startLabel = document.getElementById('start-btn-list-label');
        const originalLabel = startLabel ? startLabel.innerText : "Start Process";

        if (startBtn) startBtn.disabled = true;
        if (startLabel) startLabel.innerText = "Analyzing queue...";

        window.showProgressState(true);
        window.logToTerminal(`[Triage] Final check on ${state.pendingFiles.length} file(s)...`);
        window.updateProgress(0, `Analyzing queue...`, 'Triage');

        // Brief pause to show feedback if triage already happened on load
        await new Promise(r => setTimeout(r, 800));

        const filesToProcess = [...state.pendingFiles];
        window.__litedocActiveQueue = filesToProcess;
        state.pendingFiles = [];
        window.renderDropZone();

        if (startBtn) startBtn.disabled = false;
        if (startLabel) startLabel.innerText = originalLabel;

        // Safe execution with fallback UI alert
        try {
            if (typeof window.executePdfConversion === 'function') {
                await window.executePdfConversion(filesToProcess);
            } else if (typeof window.startConversion === 'function') {
                await window.startConversion(filesToProcess);
            } else {
                window.showAlert('System Error', 'The PDF Parser module failed to load. Please ensure your script tags are correct in index.html.');
                return;
            }

            if (window.finishProcessing) {
                window.finishProcessing();
            }
        } catch (err) {
            console.error('Conversion failed:', err);
            window.showAlert('Processing Error', 'An error occurred during PDF conversion. Check the terminal for details.');
            window.showProgressState(false);
        }
        document.getElementById('file-input').value = '';
    }
}

async function handleFilesSelected(files, originalCount = 0) {
    if (files.length) {
        state.processedData = [];
        state.activeDataIndex = 0;
        document.getElementById('output-area').classList.add('hidden');
        document.getElementById('processing-state').classList.add('hidden');

        // dedupe
        const existing = new Set(state.pendingFiles.map(f => f.name + f.size));
        const newFiles = files.filter(f => !existing.has(f.name + f.size));

        if (!newFiles.length) return;

        // Add to pending with 'analyzing' state
        newFiles.forEach(f => {
            f.triage = 'analyzing';
            state.pendingFiles.push(f);
        });
        renderDropZone();

        const listCount = document.getElementById('dz-list-count');
        const originalText = listCount ? listCount.textContent : '';
        if (listCount) {
            listCount.innerHTML = `${originalText} <span style="display:inline-flex;align-items:center;gap:6px;margin-left:12px;color:var(--accent);font-weight:normal;font-size:10px;letter-spacing:0.02em"><span class="spinner-container"><svg class="spinner-svg" viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle></svg></span> Analyzing<span class="loading-dots"></span></span>`;
        }

        if (window.__litedocAddons && typeof window.__litedocAddons.triageFiles === 'function') {
            try {
                const triaged = await window.__litedocAddons.triageFiles(state.pendingFiles, pdfjsLib);
                state.pendingFiles = triaged;
                // Clear the analyzing state so the UI updates and unlocks the start button
                state.pendingFiles.forEach(f => { if (f.triage === 'analyzing') delete f.triage; });
                renderDropZone();
            } catch (err) {
                console.warn('Live triage failed', err);
                state.pendingFiles.forEach(f => { if (f.triage === 'analyzing') delete f.triage; });
                renderDropZone();
            }
        } else {
            // FALLBACK: If opened via file:/// and modules fail to load, clear 'analyzing' to prevent a UI hang
            state.pendingFiles.forEach(f => { if (f.triage === 'analyzing') delete f.triage; });
            renderDropZone();
            console.warn('LiteDoc Addons not found (likely due to file:// CORS). Falling back to basic processing.');
        }
    } else if (originalCount > 0) {
        showAlert('Invalid File', 'Please supply valid PDF document files.');
    }
}

let dragCounter = 0;
if (dropZone) {
    dropZone.addEventListener('dragenter', e => {
        e.preventDefault();
        dragCounter++;
        dropZone.classList.add('drag-active');
    });
    dropZone.addEventListener('dragover', e => {
        e.preventDefault();
    });
    dropZone.addEventListener('dragleave', () => {
        dragCounter--;
        if (dragCounter === 0) {
            dropZone.classList.remove('drag-active');
        }
    });
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dragCounter = 0;
        dropZone.classList.remove('drag-active');
        const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
        handleFilesSelected(files, e.dataTransfer.files.length);
    });
    dropZone.addEventListener('click', (e) => { 
        if (e.target.id !== 'file-input') {
            fileInput.click(); 
        }
    });
}

if (fileInput) {
    fileInput.addEventListener('change', e => {
        const files = Array.from(e.target.files).filter(f => f.type === 'application/pdf' || f.type.startsWith('image/'));
        handleFilesSelected(files, e.target.files.length);
        e.target.value = ''; // Reset input to allow selecting the same file again
    });
}

// paste handler
document.addEventListener('paste', e => {
    if (e.clipboardData && e.clipboardData.files.length) {
        const files = Array.from(e.clipboardData.files).filter(f => f.type === 'application/pdf' || f.type.startsWith('image/'));
        handleFilesSelected(files, e.clipboardData.files.length);
        if (files.length > 0) showToast(`${files.length} file(s) pasted!`);
    }
});

// arabic check
function containsArabic(text) {
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

window.renderDropZone = renderDropZone;
window.removePendingFile = removePendingFile;
window.clearQueue = clearQueue;
window.unlockPendingFile = unlockPendingFile;
window.handleStartProcess = handleStartProcess;
window.handleFilesSelected = handleFilesSelected;
