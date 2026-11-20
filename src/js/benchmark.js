/**
 * LiteDoc - Hardware Benchmarking Tool
 */

// PDF.js arrives as a module through the bridge and may not exist yet
// when this classic script first runs; workerSrc is set by the bridge
// and by main.js at boot. runBenchmark re-checks before converting.

const benchmarkBtn = document.getElementById('run-benchmark-btn');
if (benchmarkBtn) {
    benchmarkBtn.addEventListener('click', runBenchmark);
}

// Keep references to original UI functions to restore them after benchmark
let originalShowProgressState = null;
let originalUpdateProgress = null;
let originalLogToTerminal = null;

function benchmarkShowProgressState() {}
function benchmarkUpdateProgress() {}
function benchmarkLogToTerminal(msg, type) {
    const log = document.getElementById('benchmark-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.textContent = `> ${msg}`;
    if (type === 'error') entry.style.color = '#ef4444';
    else if (type === 'warn') entry.style.color = '#eab308';
    else if (type === 'success') entry.style.color = '#22c55e';
    else if (type === 'info') entry.style.color = '#3b82f6';
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

window.toggleBenchmarkView = function () {
    const appView = document.getElementById('app-view');
    const benchView = document.getElementById('benchmark-view');
    if (appView && benchView) {
        if (benchView.classList.contains('hidden')) {
            appView.classList.add('hidden');
            benchView.classList.remove('hidden');
            
            // Backup and clear state for benchmark
            window._litedocBackupState = {
                data: window.state.processedData,
                idx: window.state.activeDataIndex,
                pending: window.state.pendingFiles
            };
            window.state.processedData = [];
            window.state.activeDataIndex = 0;
            window.state.pendingFiles = [];
            
            // Save originals if not already saved
            if (!originalShowProgressState) {
                originalShowProgressState = window.showProgressState;
                originalUpdateProgress = window.updateProgress;
                originalLogToTerminal = window.logToTerminal;
            }
            
            // Swap to mocks
            window.showProgressState = benchmarkShowProgressState;
            window.updateProgress = benchmarkUpdateProgress;
            window.logToTerminal = benchmarkLogToTerminal;
        } else {
            benchView.classList.add('hidden');
            appView.classList.remove('hidden');
            
            // Restore state
            if (window._litedocBackupState) {
                // Clear benchmark blobs first
                window.state.processedData.forEach(d => {
                    if (d.extractedImages) d.extractedImages.forEach(img => URL.revokeObjectURL(img.dataUrl));
                    if (d.inlineRenders) Object.values(d.inlineRenders).forEach(url => URL.revokeObjectURL(url));
                });
                
                window.state.processedData = window._litedocBackupState.data;
                window.state.activeDataIndex = window._litedocBackupState.idx;
                window.state.pendingFiles = window._litedocBackupState.pending;
                
                if (window.state.processedData.length > 0) {
                    if (window.updateFileTree) window.updateFileTree();
                    if (window.renderMarkdownForActiveFile) window.renderMarkdownForActiveFile();
                } else if (window.resetTool) {
                    window.resetTool(true);
                }
                delete window._litedocBackupState;
            }
            
            // Restore originals
            if (originalShowProgressState) {
                window.showProgressState = originalShowProgressState;
                window.updateProgress = originalUpdateProgress;
                window.logToTerminal = originalLogToTerminal;
            }
        }
    }
};


async function runBenchmark() {
    if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc && window.__litedocPdfWorkerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = window.__litedocPdfWorkerSrc;
    }
    const runBtn = document.getElementById('run-benchmark-btn');
    const resultsCard = document.getElementById('results-card');
    const logCard = document.getElementById('log-card');
    const logEl = document.getElementById('benchmark-log');
    
    runBtn.disabled = true;
    runBtn.textContent = 'Benchmarking...';
    logCard.classList.remove('hidden');
    logEl.innerHTML = '';

    try {
        // 1. Engine Spin-Up
        benchmarkLogToTerminal('Phase 1: Measuring Engine Spin-Up...');
        const t0 = performance.now();
        
        // Force-load worker by doing a tiny conversion
        const dummyPdf = await createDummyPdf();
        await window.executePdfConversion([dummyPdf]);
        
        const spinUpTime = Math.round(performance.now() - t0);
        document.getElementById('spin-up-time').textContent = `${spinUpTime}ms`;
        benchmarkLogToTerminal(`Spin-up complete: ${spinUpTime}ms`);

        // 2. PPT (Pages Per Toast - Synthetic Burst)
        benchmarkLogToTerminal('Phase 2: Measuring Burst Throughput (PPT)...');
        benchmarkLogToTerminal('Downloading tracemonkey.pdf (14 pages)...');
        const testPdf = await fetchTestPdf('https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf', 'tracemonkey.pdf');
        
        const t1 = performance.now();
        await window.executePdfConversion([testPdf]);
        const burstTime = performance.now() - t1;
        
        const numPages = state.processedData[0].numPages;
        const ppt = Math.round((numPages / (burstTime / 1000)) * 10) / 10;
        document.getElementById('ppt-metric').textContent = ppt;
        benchmarkLogToTerminal(`Burst test: ${numPages} pages in ${Math.round(burstTime)}ms (PPT: ${ppt})`);

        // 3. PPM (Pages Per Minute - Sustained)
        benchmarkLogToTerminal('Phase 3: Measuring Sustained Throughput (PPM)...');
        const iterations = 3;
        let totalPages = 0;
        const t2 = performance.now();
        
        for (let i = 0; i < iterations; i++) {
            benchmarkLogToTerminal(`Iteration ${i+1}/${iterations}...`);
            await window.executePdfConversion([testPdf]);
            totalPages += state.processedData[0].numPages;
        }
        
        const sustainedTime = performance.now() - t2;
        const ppm = Math.round((totalPages / (sustainedTime / 60000)));
        document.getElementById('ppm-metric').textContent = ppm;
        benchmarkLogToTerminal(`Sustained test: ${totalPages} pages in ${Math.round(sustainedTime)}ms (PPM: ${ppm})`);

        benchmarkLogToTerminal('Benchmark complete!');
        document.getElementById('copy-results-btn').classList.remove('hidden');
    } catch (error) {
        benchmarkLogToTerminal(`Error during benchmark: ${error.message}`, 'error');
        console.error(error);
    } finally {
        runBtn.disabled = false;
        runBtn.textContent = 'Run Benchmark Again';
    }
}

async function createDummyPdf() {
    // Just a tiny valid PDF structure or a very small fetch
    return await fetchTestPdf('https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/basicapi.pdf', 'basicapi.pdf');
}

async function fetchTestPdf(url, name) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to download benchmark PDF");
    const blob = await response.blob();
    return new File([blob], name, { type: 'application/pdf' });
}



const copyBtn = document.getElementById('copy-results-btn');
if (copyBtn) {
    copyBtn.addEventListener('click', () => {
    const spinUp = document.getElementById('spin-up-time').textContent;
    const ppt = document.getElementById('ppt-metric').textContent;
    const ppm = document.getElementById('ppm-metric').textContent;
    const log = document.getElementById('benchmark-log').innerText;
    
    const results = `LiteDoc Hardware Benchmark\n--------------------------\nEngine Spin-Up: ${spinUp}\nBurst Throughput: ${ppt} PPT\nSustained Throughput: ${ppm} PPM\n\nLog:\n${log}`;
    
    navigator.clipboard.writeText(results).then(() => {
        const btn = document.getElementById('copy-results-btn');
        const orig = btn.innerHTML;
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Copied!`;
        setTimeout(() => { btn.innerHTML = orig; }, 2000);
    });
    });
}
