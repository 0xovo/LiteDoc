
(function () {
    // Mobile browsers get unstable with parallel workers, keep it to 1. On desktop, limit to hardwareConcurrency - 1 to keep system responsive.
    const isMobile = /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 768;
    const MAX_WORKERS = isMobile ? 1 : (navigator.hardwareConcurrency ? Math.max(1, Math.min(8, navigator.hardwareConcurrency - 1)) : 4);
    let workerPool = [];
    let poolCreationPromises = 0;
    // Tesseract workers leak memory on long runs. Restarting them every few pages mitigates this.
    const RESTART_THRESHOLD = 8;

    const queue = [];
    let isProcessing = false;
    let totalTasks = 0;
    let completedTasks = 0;
    let activeTasksProgress = new Map();
    let taskIdCounter = 0;
    let ocrStatusMessage = 'Initializing Background OCR...';

    const taskDurations = [];
    const taskStartTimes = new Map();

    function logToUI(msg, type = 'info') {
        console.log(msg);
        if (typeof window !== 'undefined' && typeof window.logToTerminal === 'function') {
            window.logToTerminal(msg, type);
        }
    }

    async function terminateWorker(w) {
        if (w && w.worker) {
            console.log('Terminating OCR worker to free memory...');
            const tWorker = w.worker;
            setTimeout(() => { try { tWorker.terminate(); } catch (e) { } }, 1000);
        }
    }

    async function terminateAllWorkers() {
        for (const w of workerPool) {
            terminateWorker(w);
        }
        workerPool = [];
    }

    async function loadScriptOnce(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
            const s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.dataset.src = src;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('Failed to load ' + src));
            document.head.appendChild(s);
        });
    }

    async function loadTesseract() {
        if (window.Tesseract) return;

        if (window.location.protocol === 'file:') {
            console.info('[OCR] Running on file:// protocol. Using CDN for Tesseract.js.');
            await loadScriptOnce('vendor/tesseract.min.js');
            return;
        }

        try {
            await loadScriptOnce('js/tesseract.min.js');
            logToUI('[Background OCR] Active WebAssembly OCR core loaded successfully.', 'success');
        } catch (e) {
            console.warn('[OCR] Local tesseract.min.js not found. Falling back to CDN...');
            await loadScriptOnce('vendor/tesseract.min.js');
            logToUI('[Background OCR] Loaded Tesseract.js fallback engine from vendor CDN.', 'info');
        }
    }

    async function createFallbackWorker(lang, oem, loggerFn) {
        const options = {
            logger: (m) => {
                if (m && m.status) {
                    if (m.status === 'loading language training data' || m.status === 'loading tesseract core' || m.status === 'initializing tesseract' || m.status === 'initializing api') {
                        const pctVal = (m.progress !== undefined && !isNaN(m.progress)) ? m.progress : 0;
                        const pct = (pctVal > 0 && pctVal < 1) ? ` (${Math.round(pctVal * 100)}%)` : '';
                        const action = m.status === 'loading language training data' ? `Downloading OCR model [${lang}]` : 'Initializing OCR core';
                        ocrStatusMessage = `${action}${pct}...`;
                        
                        // Let model downloading and initialization count for up to 20% of task progress so bar moves immediately!
                        if (activeTasksProgress.size > 0 && pctVal > 0) {
                            for (const [tId, currVal] of activeTasksProgress.entries()) {
                                if (currVal < 0.2) activeTasksProgress.set(tId, pctVal * 0.2);
                            }
                        }
                        updateProgressUI();
                    }
                }
                if (loggerFn) loggerFn(m);
            }
        };

        if (window.__TESS_WORKER_URI) {
            options.workerPath = window.__TESS_WORKER_URI;
        }
        if (window.__TESS_CORE_URI) {
            options.corePath = window.__TESS_CORE_URI;
        }

        // Tesseract.js 5+ handles CDN fallbacks internally if langPath is omitted.
        // We only use langPath if a local models directory is explicitly expected.
        return await window.Tesseract.createWorker(lang, oem, options);
    }

    async function getIdleWorker(lang) {
        let w = workerPool.find(w => !w.isBusy && w.lang === lang);
        if (w) {
            if (w.pagesProcessed >= RESTART_THRESHOLD) {
                terminateWorker(w);
                workerPool = workerPool.filter(x => x !== w);
            } else {
                return w;
            }
        }

        if (workerPool.length + poolCreationPromises < MAX_WORKERS) {
            poolCreationPromises++;
            try {
                await loadTesseract();

                // Equation engine model requires legacy engine (OEM 0) instead of LSTM.
                const oem = lang === 'equ' ? 0 : 1;

                const worker = await createFallbackWorker(lang, oem, (m) => {
                    if (m && m.status === 'recognizing text') {
                        const pctVal = m.progress || 0;
                        ocrStatusMessage = `Recognizing text (${Math.round(pctVal * 100)}%)...`;
                        const poolEntry = workerPool.find(x => x.worker === worker);
                        if (poolEntry && poolEntry.activeTaskId) {
                            // Scale recognition from 20% to 100% so it resumes smoothly after initialization
                            activeTasksProgress.set(poolEntry.activeTaskId, Math.min(1, 0.2 + (pctVal * 0.8)));
                            updateProgressUI();
                        }
                    }
                });
                const poolEntry = { worker, lang, pagesProcessed: 0, isBusy: false, activeTaskId: null };
                workerPool.push(poolEntry);
                return poolEntry;
            } finally {
                poolCreationPromises--;
            }
        }
        return null;
    }

    function updateQueueUI() {
        let container = document.getElementById('ocr-queue-status');
        if (!container) {
            container = document.createElement('div');
            container.id = 'ocr-queue-status';
            container.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] px-4 py-3 rounded-2xl shadow-2xl flex flex-col gap-2 min-w-[280px] section-fade-in';
            container.style.cssText = 'background:var(--bg-card);border:1px solid var(--border-hi);backdrop-filter:blur(12px)';
            document.body.appendChild(container);
        }

        const remaining = queue.length + workerPool.filter(w => w.isBusy).length;
        if (remaining === 0 && !isProcessing) {
            container.classList.add('opacity-0', 'pointer-events-none', 'translate-y-4');
            setTimeout(() => { if (queue.length === 0 && !isProcessing) container.remove(); }, 500);
            return;
        }

        container.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-4');

        const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

        let etaText = 'Calculating ETA...';
        if (taskDurations.length > 0) {
            const avgDuration = taskDurations.reduce((a, b) => a + b, 0) / taskDurations.length;
            const activeWorkersCount = Math.max(1, workerPool.filter(w => w.isBusy).length);
            const remainingMs = (remaining * avgDuration) / activeWorkersCount;
            const remainingSecs = Math.ceil(remainingMs / 1000);
            
            if (remainingSecs < 60) {
                etaText = `Est. ${remainingSecs}s remaining`;
            } else {
                const m = Math.floor(remainingSecs / 60);
                const s = remainingSecs % 60;
                etaText = `Est. ${m}m ${s}s remaining`;
            }
        }

        let countsEl = document.getElementById('ocr-queue-counts');
        let statusTextEl = document.getElementById('ocr-queue-status-text');
        let etaTextEl = document.getElementById('ocr-queue-eta-text');
        if (!countsEl || !statusTextEl || !etaTextEl) {
            container.innerHTML = `
                <div class="flex items-center justify-between gap-4">
                    <div class="flex items-center gap-2">
                        <div class="spinner-container !w-4 !h-4">
                            <svg class="spinner-svg" viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" stroke-width="6"></circle></svg>
                        </div>
                        <span class="text-[11px] font-bold uppercase tracking-wider" style="color:var(--text-1)">Background OCR</span>
                    </div>
                    <span id="ocr-queue-counts" class="text-[10px] font-mono" style="color:var(--accent)">${completedTasks}/${totalTasks}</span>
                </div>
                <div class="h-1.5 w-full rounded-full overflow-hidden my-1.5" style="background:var(--bg-input)">
                    <div id="ocr-queue-progress-bar" class="h-full transition-all duration-300" style="width:0%;background:var(--accent)"></div>
                </div>
                <div class="flex justify-between items-center gap-2">
                    <p id="ocr-queue-status-text" class="text-[10px] truncate max-w-[190px]" style="color:var(--text-3)">${ocrStatusMessage || 'Processing textless pages...'}</p>
                    <p id="ocr-queue-eta-text" class="text-[10px] font-medium flex-shrink-0" style="color:var(--accent)">${etaText}</p>
                </div>
            `;
        } else {
            countsEl.textContent = `${completedTasks}/${totalTasks}`;
            statusTextEl.textContent = ocrStatusMessage || 'Processing textless pages...';
            etaTextEl.textContent = etaText;
        }

        updateProgressUI();
    }

    function updateProgressUI() {
        const bar = document.getElementById('ocr-queue-progress-bar');
        const statusEl = document.getElementById('ocr-queue-status-text');
        const countsEl = document.getElementById('ocr-queue-counts');
        if (statusEl && ocrStatusMessage) {
            statusEl.textContent = ocrStatusMessage;
        }
        if (countsEl) {
            countsEl.textContent = `${completedTasks}/${totalTasks}`;
        }
        if (!bar || totalTasks === 0) return;

        let activeProgressSum = 0;
        for (const p of activeTasksProgress.values()) {
            activeProgressSum += p;
        }

        const totalProgress = Math.min(100, Math.max(0, ((completedTasks + activeProgressSum) / totalTasks) * 100));
        bar.style.width = `${totalProgress}%`;
    }

    async function preprocessImagePayload(payload) {
        try {
            let canvas;
            if (payload instanceof HTMLCanvasElement) {
                canvas = document.createElement('canvas');
                canvas.width = payload.width;
                canvas.height = payload.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(payload, 0, 0);
            } else {
                await new Promise((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.onload = () => {
                        canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        resolve();
                    };
                    img.onerror = reject;
                    if (payload instanceof Blob || payload instanceof File) {
                        img.src = URL.createObjectURL(payload);
                    } else if (typeof payload === 'string') {
                        img.src = payload;
                    } else {
                        reject(new Error('Unsupported type'));
                    }
                });
            }

            if (!canvas) return payload;

            // Tesseract performs better without destructive manual thresholding
            // since its internal Leptonica engine runs an adaptive Otsu binarization.
            // We just return the redrawn canvas.
            return canvas;
        } catch (e) {
            console.warn('[OCR] Preprocessing failed, using original payload', e);
            return payload;
        }
    }

    let isPumping = false;
    async function pumpQueue() {
        if (isPumping || queue.length === 0) {
            if (queue.length === 0 && !workerPool.some(w => w.isBusy)) {
                isProcessing = false;
                updateQueueUI();
                await terminateAllWorkers();
            }
            return;
        }

        isPumping = true;
        try {
            while (queue.length > 0) {
                const firstTask = queue[0];

                if (!firstTask.isSubTask && !firstTask.layoutAttempted) {
                    firstTask.layoutAttempted = true;
                    let layoutBlocks = null;
                    const wLayout = await getIdleWorker('eng');
                    if (!wLayout) break; // Need a worker for the layout pass
                    
                    wLayout.isBusy = true;
                    wLayout.activeTaskId = firstTask.id;
                    isProcessing = true;
                    updateQueueUI();
                    
                    let originalCanvas = null;
                    try {
                        originalCanvas = await preprocessImagePayload(firstTask.imagePayload);
                        // Run a fast layout pass using english without words level OCR to get blocks
                        const { data } = await wLayout.worker.recognize(originalCanvas, {}, { blocks: true });
                        if (data && data.blocks) layoutBlocks = data.blocks;
                        wLayout.pagesProcessed++;
                    } catch (e) {
                        console.warn('[OCR] Layout pass failed', e);
                    } finally {
                        wLayout.isBusy = false;
                        wLayout.activeTaskId = null;
                        updateQueueUI();
                    }

                    // Threshold: ignore blocks that are too small. Require at least 2 valid blocks to split.
                    const validBlocks = (layoutBlocks || []).filter(b => b.bbox && (b.bbox.x1 - b.bbox.x0 > 50) && (b.bbox.y1 - b.bbox.y0 > 50));
                    
                    if (validBlocks.length > 1) {
                        logToUI(`[Background OCR] Multi-region layout analyzed: splitting page segment into ${validBlocks.length} independent content blocks.`, 'info');
                        firstTask.isMultiRegion = true;
                        firstTask.subTasks = [];

                        for (let i = 0; i < validBlocks.length; i++) {
                            const b = validBlocks[i];
                            const w = b.bbox.x1 - b.bbox.x0;
                            const h = b.bbox.y1 - b.bbox.y0;
                            const cropCanvas = document.createElement('canvas');
                            cropCanvas.width = w;
                            cropCanvas.height = h;
                            cropCanvas.getContext('2d').drawImage(originalCanvas, b.bbox.x0, b.bbox.y0, w, h, 0, 0, w, h);

                            firstTask.subTasks.push({
                                id: ++taskIdCounter,
                                isSubTask: true,
                                parent: firstTask,
                                imagePayload: cropCanvas,
                                lang: firstTask.lang,
                                bbox: b.bbox,
                                resolvedData: null,
                                error: null,
                                done: false
                            });
                        }
                        
                        queue.shift(); // Remove parent from active processing queue
                        queue.unshift(...firstTask.subTasks); // Put subtasks at the front
                        
                        firstTask.checkCompletion = () => {
                            if (firstTask.subTasks.every(st => st.done)) {
                                completedTasks++;
                                for (const st of firstTask.subTasks) {
                                    activeTasksProgress.delete(st.id);
                                }
                                updateQueueUI();
                                const allWords = [];
                                let fullText = '';
                                // Sort regions into reading order before concatenating.
                                // Tesseract's block detector returns blocks in ITS OWN
                                // order, which is not guaranteed to be top-to-bottom /
                                // left-to-right. Concatenating .text in that raw order
                                // interleaves paragraphs and emits table rows before
                                // their headers. Band rows by vertical overlap (blocks
                                // on the same line shouldn't be ordered by a 1px y
                                // difference), then left-to-right within a row.
                                const ordered = firstTask.subTasks.slice().sort((a, b) => {
                                    const ah = a.bbox.y1 - a.bbox.y0, bh = b.bbox.y1 - b.bbox.y0;
                                    const tol = Math.min(ah, bh) * 0.5;
                                    if (Math.abs(a.bbox.y0 - b.bbox.y0) > tol) return a.bbox.y0 - b.bbox.y0;
                                    return a.bbox.x0 - b.bbox.x0;
                                });
                                for (const st of ordered) {
                                    if (st.resolvedData && st.resolvedData.words) {
                                        for (const w of st.resolvedData.words) {
                                            if (w.bbox) {
                                                w.bbox.x0 += st.bbox.x0;
                                                w.bbox.x1 += st.bbox.x0;
                                                w.bbox.y0 += st.bbox.y0;
                                                w.bbox.y1 += st.bbox.y0;
                                            }
                                            allWords.push(w);
                                        }
                                        fullText += (st.resolvedData.text || '') + '\n\n';
                                    }
                                }
                                logToUI(`[Background OCR] Completed multi-region recognition (${allWords.length} total words synthesized).`, 'success');
                                firstTask.resolve({ text: fullText.trim(), words: allWords, isMultiRegion: true });
                            }
                        };
                        continue; // Loop again to process the newly unshifted subtasks
                    } else {
                        logToUI('[Background OCR] Using single-pass layout recognition for uniform page structure.', 'info');
                        firstTask.isMultiRegion = false;
                        firstTask.imagePayload = originalCanvas || firstTask.imagePayload; // Reuse preprocessed
                    }
                }

                if (firstTask.lang === 'auto' || !firstTask.lang) {
                    firstTask.lang = 'detecting...';
                    try {
                        logToUI('[Background OCR] Executing Optical Script Detection (OSD) to identify language orientation...', 'info');
                        firstTask.resolvedLang = await detectLanguage(firstTask.imagePayload);
                        logToUI(`[Background OCR] Script resolution confirmed: applying [${firstTask.resolvedLang}] recognition model.`, 'info');
                    } catch (e) {
                        console.warn('[OCR] OSD Detection failed or decided to skip. Falling back to eng.', e);
                        logToUI('[Background OCR] Script detection skipped or defaulted; using standard Latin [eng] model.', 'warn');
                        firstTask.resolvedLang = 'eng';
                    }
                    firstTask.lang = firstTask.resolvedLang;
                    // Remember this so the post-OCR foreign-script rescue knows
                    // it may second-guess an 'eng' routing that OSD got wrong.
                    firstTask.wasAutoLang = true;
                }

                if (firstTask.lang === 'detecting...') break;

                const w = await getIdleWorker(firstTask.lang);
                if (!w) break; // No workers available right now

                const task = queue.shift();
                if (!task) break;

                w.isBusy = true;
                w.activeTaskId = task.id;
                activeTasksProgress.set(task.id, 0.05);
                taskStartTimes.set(task.id, Date.now());
                isProcessing = true;
                updateQueueUI();
                if (!task.isSubTask) {
                    logToUI(`[Background OCR] Starting text recognition pipeline on document task #${task.id}...`, 'info');
                }

                (async () => {
                    let requeuedForScript = false;
                    try {
                        // If it's a subtask, it's already a canvas, but preprocess handles it cleanly anyway
                        const processedPayload = await preprocessImagePayload(task.imagePayload);
                        const recognizeOptions = {
                            user_defined_dpi: '300',
                            tessedit_pageseg_mode: task.isSubTask ? '11' : '3'
                        };
                        if (task.lang && task.lang.includes('ara')) {
                            recognizeOptions.tessedit_pageseg_mode = '3';
                        }
                        const { data } = await w.worker.recognize(processedPayload, recognizeOptions, { blocks: true, words: true });

                        // Foreign-script rescue. Whole-page script detection can
                        // never catch ONE foreign line on an otherwise-English
                        // page (OSD only reports the dominant script). But the
                        // eng model *tells* us where it failed: garbage words get
                        // very low confidence. Cluster them, OSD just that crop
                        // (which IS dominated by the foreign script), and if it
                        // names a different language, re-OCR this task once with
                        // the right "<script>+eng" combo.
                        if (!task.scriptRetryDone && task.wasAutoLang && !task.isSubTask
                                && data && data.words && processedPayload && processedPayload.getContext) {
                            const low = data.words.filter(x => (x.confidence || 0) < 50
                                && x.text && x.text.trim().length > 1 && x.bbox);
                            if (low.length >= 3) {
                                let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
                                for (const lw of low) {
                                    x0 = Math.min(x0, lw.bbox.x0); y0 = Math.min(y0, lw.bbox.y0);
                                    x1 = Math.max(x1, lw.bbox.x1); y1 = Math.max(y1, lw.bbox.y1);
                                }
                                const pad = 10;
                                x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
                                x1 = Math.min(processedPayload.width, x1 + pad);
                                y1 = Math.min(processedPayload.height, y1 + pad);
                                if (x1 - x0 > 20 && y1 - y0 > 10) {
                                    const crop = document.createElement('canvas');
                                    crop.width = x1 - x0; crop.height = y1 - y0;
                                    crop.getContext('2d').drawImage(processedPayload,
                                        x0, y0, crop.width, crop.height, 0, 0, crop.width, crop.height);
                                    let rescueLang = 'eng';
                                    try { rescueLang = await detectLanguage(crop); } catch (e) { }
                                    task.scriptRetryDone = true;
                                    if (rescueLang && rescueLang !== 'eng' && rescueLang !== task.lang) {
                                        logToUI(`[Background OCR] Detected ${low.length} non-Latin character clusters; re-running recognition with targeted [${rescueLang}] model.`, 'warn');
                                        task.lang = rescueLang;
                                        requeuedForScript = true;
                                        queue.unshift(task);
                                        return;
                                    }
                                }
                            }
                        }

                        w.pagesProcessed++;

                        const resultObj = { text: data ? data.text : '', words: data ? data.words : [] };
                        if (task.isSubTask) {
                            task.resolvedData = resultObj;
                            task.done = true;
                            activeTasksProgress.set(task.id, 1 / (task.parent.subTasks ? task.parent.subTasks.length : 1));
                            task.parent.checkCompletion();
                        } else {
                            completedTasks++;
                            logToUI(`[Background OCR] Recognition succeeded on task #${task.id} (${(resultObj.words || []).length} words extracted).`, 'success');
                            task.resolve({ ...resultObj, isMultiRegion: false });
                        }
                    } catch (e) {
                        console.error('Background OCR Failed', e);
                        if (task.isSubTask) {
                            task.error = e;
                            task.done = true;
                            activeTasksProgress.set(task.id, 0);
                            task.parent.checkCompletion();
                        } else {
                            completedTasks++;
                            logToUI(`[Background OCR] Recognition error on task #${task.id}: ${e.message || e}`, 'error');
                            task.reject(e);
                        }
                    } finally {
                        const duration = Date.now() - taskStartTimes.get(task.id);
                        taskDurations.push(duration);
                        if (taskDurations.length > 20) taskDurations.shift();
                        taskStartTimes.delete(task.id);
                        
                        w.isBusy = false;
                        w.activeTaskId = null;
                        if (!task.isSubTask) {
                            activeTasksProgress.delete(task.id);
                        }
                        updateQueueUI();
                        pumpQueue();
                    }
                })();
            }
        } finally {
            isPumping = false;
        }
    }

    async function detectLanguage(imagePayload) {
        await loadTesseract();

        console.log('Starting OSD Detection...');
        let osdWorker;
        try {
            osdWorker = await createFallbackWorker('osd', 0, m => console.log('OSD Progress:', m.status, m.progress));
        } catch (initErr) {
            console.error('OSD worker initialization failed, falling back to eng', initErr);
            return 'eng';
        }

        const map = {
            'Arabic': 'ara+eng',
            'Latin': 'eng',
            'Han': 'chi_sim+eng',
            'Japanese': 'jpn+eng',
            'Korean': 'kor+eng',
            'Cyrillic': 'rus+eng',
            'Greek': 'ell+eng',
            'Devanagari': 'hin+eng'
        };

        // This OSD build reports script_confidence on a scale where ~2 is a
        // clean, unambiguous page (measured: pure-Japanese 2.02, pure-English
        // 2.43; the old threshold of 5 rejected every detection ever made).
        // A weak NON-Latin reading is safe to act on: every route is a
        // "<script>+eng" combo, so English text still reads fine — the only
        // cost of a false positive is loading an extra model.
        const detectOn = async (payload) => {
            const detectPromise = osdWorker.detect(payload);
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('OSD Timeout')), 15000));
            const result = await Promise.race([detectPromise, timeoutPromise]);
            if (!result || !result.data || !result.data.script) return null;
            console.log('OSD Result:', result.data);
            if ((result.data.script_confidence || 0) < 0.2) return null;
            return result.data.script;
        };

        try {
            // OSD has two blind spots, each covered by an extra candidate view:
            //  * it's DPI-sensitive — small glyphs misread as Latin or nothing,
            //    but the same image at 2x resolves correctly (measured: sparse
            //    mixed page = Latin@0.33 at 1x, Japanese@1.0 at 2x);
            //  * it only reports the DOMINANT script, so a Japanese section on
            //    a mostly-English page is invisible in the whole-page pass —
            //    overlapping horizontal bands let a minority block dominate
            //    its own band.
            // Candidates are built lazily; the first non-Latin hit wins.
            const candidates = [['page', () => imagePayload]];
            if (imagePayload && imagePayload.getContext) {
                const W = imagePayload.width, H = imagePayload.height;
                if (W * H <= 4e6) {
                    candidates.push(['page@2x', () => {
                        const c = document.createElement('canvas');
                        c.width = W * 2; c.height = H * 2;
                        c.getContext('2d').drawImage(imagePayload, 0, 0, W * 2, H * 2);
                        return c;
                    }]);
                }
                if (H > 60) {
                    const bandH = Math.ceil(H / 2);
                    for (const y0 of [0, Math.floor((H - bandH) / 2), H - bandH]) {
                        candidates.push([`band@${y0}`, () => {
                            const c = document.createElement('canvas');
                            c.width = W; c.height = bandH;
                            c.getContext('2d').drawImage(imagePayload, 0, y0, W, bandH, 0, 0, W, bandH);
                            return c;
                        }]);
                    }
                }
            }

            for (const [label, make] of candidates) {
                const script = await detectOn(make());
                if (script && script !== 'Latin' && map[script]) {
                    console.log(`Routed Language (${label}):`, map[script]);
                    return map[script];
                }
            }
            console.log('Routed Language: eng');
            return 'eng';
        } catch (err) {
            console.error('Inner OSD Error Details:', err, 'Falling back to eng');
            return 'eng';
        } finally {
            console.log('Terminating OSD worker...');
            if (osdWorker) {
                setTimeout(() => { try { osdWorker.terminate(); } catch (e) { } }, 1000);
            }
        }
    }

    window.__litedocOCR = {
        precacheModels: async () => {
            await loadTesseract();
            console.log('[OCR] Precaching OSD model in background...');
            try {
                const worker = await createFallbackWorker('osd', 0, () => {});
                const w = worker;
                setTimeout(() => { try { w.terminate(); } catch (e) { } }, 1000);
                console.log('[OCR] OSD model precached successfully in IndexedDB.');
            } catch (e) {
                console.warn('[OCR] Background precache failed:', e);
            }
        },
        detectScript: async (canvas) => {
            return await detectLanguage(canvas);
        },
        ocrCanvas: async (imagePayload, onProgress, settings) => {
            if (settings && !settings.ocrEnabled) return '';
            const lang = (settings && settings.ocrLang) || 'eng';

            totalTasks++;
            updateQueueUI();

            return new Promise((resolve, reject) => {
                const id = ++taskIdCounter;
                queue.push({ id, imagePayload, lang, resolve, reject });
                pumpQueue();
            });
        },
        cleanupWorker: async () => {
            if (isProcessing || queue.length > 0 || workerPool.some(w => w.isBusy)) return;
            await terminateAllWorkers();
        },
        clearQueue: async () => {
            while (queue.length > 0) {
                queue.shift().reject(new Error('FILE_SKIPPED'));
            }
            await terminateAllWorkers();
            totalTasks = 0;
            completedTasks = 0;
            activeTasksProgress.clear();
            isProcessing = false;
            updateQueueUI();
        }
    };
})();
