import * as addons from '../extraction/addons.js';
import * as utils from '../utils/utils.js';
import { topologicalSort, dbscan, inferFontStyle } from '../utils/geometry.js';

// --- Dynamic Tuning Configuration ---
// The first 13 values are tuned by the Bayesian optimizer in training/ (see
// training/current_params.json). itemOverlapTolerance and garbageScoreThreshold
// are not part of the search space and keep their hand-set defaults.
const DEFAULT_CONFIG = {
    horizontalGapMultiplier: 1.219497353517404,
    rowSplitMultiplier: 3.1024126595800956,
    horizontalGapMin: 12,
    bottomMarginThreshold: 0.8326907199134223,
    topMarginThreshold: 0.10044413724016359,
    distanceFromCenterPenalty: 4.840529410092541,
    tableDensityThreshold: 0.6985618842172149,
    pageGarbageRatioThreshold: 0.4554856547254581,
    paragraphGapThreshold: 1.5088077796767423,
    continuationGapThreshold: 2.346406152053748,
    tableGapYThreshold: 2.055654766434288,
    gapMultiplier: 0.6148540876742017,
    ocrTolMultiplier: 2.733889345414216,
    itemOverlapTolerance: 4,
    garbageScoreThreshold: 0.20
};

let activeConfig = { ...DEFAULT_CONFIG };

/**
 * Update the active tuning parameters.
 */
export function updateTuningConfig(newConfig) {
    activeConfig = { ...DEFAULT_CONFIG, ...newConfig };
}

// Clean up stray blockquote markers and duplicate page headings
function cleanMarkdown(md) {
    const lines = md.split('\n');
    const cleaned = [];
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        // Strip leading '> ' when it is not a true blockquote (previous line not empty or not another blockquote)
        if (line.startsWith('> ')) {
            if (i === 0 || lines[i - 1].trim() === '' || lines[i - 1].startsWith('>')) {
                // keep as blockquote
            } else {
                line = line.slice(2);
            }
        }
        // Skip duplicate page headings that may appear consecutively
        if (line.startsWith('## Page ') && cleaned.length && cleaned[cleaned.length - 1].startsWith('## Page ')) {
            continue;
        }
        cleaned.push(line);
    }
    return cleaned.join('\n');
}

function segmentBox(boxItems, pageW, pageH, depth = 0) {
    if (boxItems.length === 0) return [];

    // --- Scientific Scaling ---
    // Instead of absolute pixels, we use Page-Relative Units (PRU)
    // 1% of page width is a standard 'unit' for layout analysis.
    const UX = pageW / 100;
    const UY = pageH / 100;

    // ── Helper: find vertical gutters using X-interval projection ───────────
    function findVerticalGutters(items) {
        if (items.length < 5) return [];
        
        let minX = Infinity, maxX = -Infinity;
        for (const item of items) {
            minX = Math.min(minX, item.x);
            maxX = Math.max(maxX, item.x + (item.width || 0));
        }
        const pageWidthApprox = maxX - minX;
        if (pageWidthApprox < 20 * UX) return []; // Too small to have columns
        
        // Filter out headers/footers/long lines spanning > 60% of page
        // AND exclude extreme top/bottom margins
        const narrowItems = items.filter(item => {
            if ((item.width || 0) > pageWidthApprox * 0.6) return false;
            if (item.y < pageH * activeConfig.topMarginThreshold || item.y > pageH * activeConfig.bottomMarginThreshold) return false;
            return true;
        });
        
        // Create X-intervals
        let intervals = narrowItems.map(item => ({ start: item.x, end: item.x + (item.width || 0) }));
        if (intervals.length === 0) return [];
        
        intervals.sort((a, b) => a.start - b.start);
        
        // Merge intervals with a viewport-scaled tolerance (0.5% of page width)
        const merged = [intervals[0]];
        const mergeTolerance = 0.5 * UX;
        for (let i = 1; i < intervals.length; i++) {
            const curr = intervals[i];
            const last = merged[merged.length - 1];
            if (curr.start <= last.end + mergeTolerance) {
                last.end = Math.max(last.end, curr.end);
            } else {
                merged.push(curr);
            }
        }
        
        // Gaps between merged intervals are gutters
        const gutters = [];
        const minGutterWidth = Math.max(activeConfig.horizontalGapMin, 1.2 * UX);
        for (let i = 1; i < merged.length; i++) {
            const gap = merged[i].start - merged[i - 1].end;
            if (gap >= minGutterWidth) { 
                const xCenter = merged[i - 1].end + gap / 2;
                gutters.push({ x: xCenter, width: gap });
            }
        }
        
        if (gutters.length > 0) {
            const pageCenter = minX + pageWidthApprox / 2;
            
            // Score = width - penalty for distance from center
            gutters.forEach(g => {
                const distanceFromCenterPercent = Math.abs(g.x - pageCenter) / pageWidthApprox;
                // Scale penalty by viewport
                g.score = g.width - (distanceFromCenterPercent * 10 * UX * activeConfig.distanceFromCenterPenalty);
                
                // Relaxed penalty for asymmetric magazine layouts (e.g. 1/3 - 2/3 splits)
                if (distanceFromCenterPercent > 0.35) {
                    g.score -= 100 * UX;
                }
            });
            
            // Filter out heavily penalized gutters
            const validGutters = gutters.filter(g => g.score > -50 * UX);
            
            if (validGutters.length > 0) {
                validGutters.sort((a, b) => b.score - a.score);
                return [validGutters[0]];
            } else {
                // Fallback: pick the one closest to the center
                gutters.sort((a, b) => Math.abs(a.x - pageCenter) - Math.abs(b.x - pageCenter));
                return [gutters[0]];
            }
        }
        
        return [];
    }

    // ── Helper: group items into lines within a single column ──────────
    function groupIntoLines(items) {
        items.sort((a, b) => b.y - a.y || a.x - b.x);
        const lines = [];
        for (const item of items) {
            const last = lines[lines.length - 1];
            // Adaptive vertical tolerance scaled by font height and rowSplitMultiplier
            const tol = Math.max(0.3 * UY, (item.height || 10) * (activeConfig.rowSplitMultiplier / 6.6));
            let isSameLine = false;
            
            if (last && Math.abs(item.y - last.lastY) <= tol) {
                isSameLine = true;
            }
            
            if (isSameLine) {
                last.items.push(item);
                last.xMax = Math.max(last.xMax, item.x + (item.width || 0));
                last.xMin = Math.min(last.xMin, item.x);
                last.yMin = Math.min(last.yMin, item.y);
                last.yMax = Math.max(last.yMax, item.y + (item.height || 10));
                last.height = Math.max(last.height, item.height || 10);
                last.lastY = item.y;
            } else {
                lines.push({
                    items: [item],
                    xMin: item.x,
                    xMax: item.x + (item.width || 0),
                    yMin: item.y,
                    yMax: item.y + (item.height || 10),
                    y: item.y,
                    lastY: item.y,
                    height: item.height || 10
                });
            }
        }
        return lines;
    }

    // ── Helper: merge lines into blocks within a single column ────────
    function mergeIntoBlocks(lines) {
        lines.sort((a, b) => b.y - a.y || a.xMin - b.xMin);
        const blocks = [];
        for (const line of lines) {
            let assigned = false;
            for (let i = blocks.length - 1; i >= 0; i--) {
                const block = blocks[i];
                const vertGap = block.yMin - line.yMax;
                // Scaled vertical block merging threshold
                if (vertGap >= -line.height * 0.5 && vertGap < line.height * 2.5) {
                    const horizOverlap = Math.max(0, Math.min(block.xMax, line.xMax) - Math.max(block.xMin, line.xMin));
                    const minWidth = Math.min(block.xMax - block.xMin, line.xMax - line.xMin);
                    if (horizOverlap > minWidth * 0.3 || (Math.abs(line.xMin - block.xMin) < 2 * UX && Math.abs(line.xMax - block.xMax) < 2 * UX)) {
                        block.lines.push(line);
                        block.items.push(...line.items);
                        block.xMin = Math.min(block.xMin, line.xMin);
                        block.xMax = Math.max(block.xMax, line.xMax);
                        block.yMin = Math.min(block.yMin, line.yMin);
                        block.yMax = Math.max(block.yMax, line.yMax);
                        assigned = true;
                        break;
                    }
                }
            }
            if (!assigned) {
                blocks.push({
                    lines: [line],
                    items: [...line.items],
                    xMin: line.xMin,
                    xMax: line.xMax,
                    yMin: line.yMin,
                    yMax: line.yMax
                });
            }
        }
        return blocks;
    }

    // ── Helper: process single-column layout ─────────────────────────
    function processSingleColumn(items) {
        const lines = groupIntoLines(items);
        const blocks = mergeIntoBlocks(lines);
        blocks.sort((a, b) => b.yMax - a.yMax || a.xMin - b.xMin);
        return blocks.map(block => ({
            type: 'Single-Column',
            bbox: { xMin: block.xMin, xMax: block.xMax, yMin: block.yMin, yMax: block.yMax },
            items: block.items
        }));
    }

    // ── Helper: process complex grid layout ──────────────────────────
    function processComplexGrid(items) {
        if (gutters.length === 0) {
            return processSingleColumn(items);
        }

        const sortedGutters = [...gutters].sort((a, b) => a.x - b.x);
        const columns = Array.from({ length: sortedGutters.length + 1 }, () => []);
        const wideItems = [];

        for (const item of items) {
            const itemLeft = item.x;
            const itemRight = item.x + (item.width || 0);
            const itemCenter = (itemLeft + itemRight) / 2;
            const itemWidth = itemRight - itemLeft;

            let crossesGutter = false;
            if (itemWidth > pageW * 0.55) {
                crossesGutter = true;
            } else {
                for (const g of sortedGutters) {
                    if (itemLeft < g.x - mergeTolerance && itemRight > g.x + mergeTolerance) {
                        crossesGutter = true;
                        break;
                    }
                }
            }

            if (crossesGutter) {
                wideItems.push(item);
            } else {
                let colIdx = 0;
                while (colIdx < sortedGutters.length && itemCenter >= sortedGutters[colIdx].x) {
                    colIdx++;
                }
                columns[colIdx].push(item);
            }
        }

        const allBlocks = [];
        for (let i = 0; i <= sortedGutters.length; i++) {
            if (columns[i].length > 0) {
                allBlocks.push(...processSingleColumn(columns[i]));
            }
        }
        if (wideItems.length > 0) {
            allBlocks.push(...processSingleColumn(wideItems));
        }

        const formattedBlocks = allBlocks.map(block => ({
            type: 'Single-Column',
            xMin: block.bbox.xMin,
            xMax: block.bbox.xMax,
            yMin: block.bbox.yMin,
            yMax: block.bbox.yMax,
            items: block.items
        }));

        const sortedBlocks = topologicalSort(formattedBlocks);

        return sortedBlocks.map(block => ({
            type: 'Single-Column',
            bbox: { xMin: block.xMin, xMax: block.xMax, yMin: block.yMin, yMax: block.yMax },
            items: block.items
        }));
    }

    // ── Helper: process landscape layout ─────────────────────────────
    function processLandscape(items) {
        const lines = groupIntoLines(items);
        const blocks = mergeIntoBlocks(lines);

        const formattedBlocks = blocks.map(block => ({
            type: 'Single-Column',
            xMin: block.xMin,
            xMax: block.xMax,
            yMin: block.yMin,
            yMax: block.yMax,
            items: block.items
        }));

        const sortedBlocks = topologicalSort(formattedBlocks);

        return sortedBlocks.map(block => ({
            type: 'Single-Column',
            bbox: { xMin: block.xMin, xMax: block.xMax, yMin: block.yMin, yMax: block.yMax },
            items: block.items
        }));
    }

    // ── Helper: process multi-column layout ──────────────────────────
    function processMultiColumn(items, gutterX) {
        const leftItems = [];
        const rightItems = [];
        const wideItems = [];

        for (const item of items) {
            const itemLeft = item.x;
            const itemRight = item.x + (item.width || 0);
            const itemCenter = (itemLeft + itemRight) / 2;
            const itemWidth = itemRight - itemLeft;

            let crossesGutter = false;
            if (itemWidth > pageW * 0.55) {
                crossesGutter = true;
            } else if (itemLeft < gutterX - 1.5 * UX && itemRight > gutterX + 1.5 * UX) {
                crossesGutter = true;
            }

            if (crossesGutter) {
                wideItems.push(item);
            } else if (itemCenter < gutterX) {
                leftItems.push(item);
            } else {
                rightItems.push(item);
            }
        }

        const leftBlocks = processSingleColumn(leftItems);
        const rightBlocks = processSingleColumn(rightItems);
        const wideBlocks = processSingleColumn(wideItems);

        // Separate wide blocks into Top wide blocks (above columns) and Bottom wide blocks (below columns)
        let colTop = -Infinity;
        let colBottom = Infinity;
        for (const b of [...leftBlocks, ...rightBlocks]) {
            colTop = Math.max(colTop, b.bbox.yMax);
            colBottom = Math.min(colBottom, b.bbox.yMin);
        }

        const topWide = [];
        const bottomWide = [];
        for (const b of wideBlocks) {
            const center = (b.bbox.yMin + b.bbox.yMax) / 2;
            if (center > colTop - 1 * UY) {
                topWide.push(b);
            } else {
                bottomWide.push(b);
            }
        }

        return [...topWide, ...leftBlocks, ...rightBlocks, ...bottomWide];
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Classify page layout
    // ═══════════════════════════════════════════════════════════════════
    let layoutType = 'Single-Column';
    let gutters = [];
    let gutterX = -1;

    if (boxItems.length >= 5) {
        if (pageW > pageH * 1.05) {
            layoutType = 'Landscape/Presentation';
        } else {
            gutters = findVerticalGutters(boxItems);
            if (gutters.length > 1) {
                layoutType = 'Complex/Mixed-Grid';
            } else if (gutters.length === 1) {
                layoutType = 'Multi-Column';
                gutterX = gutters[0].x;
            } else {
                layoutType = 'Single-Column';
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Route to specialized layout processors
    // ═══════════════════════════════════════════════════════════════════
    console.log(`[Layout Engine] Page size: ${Math.round(pageW)}x${Math.round(pageH)}, Classified: ${layoutType}, Gutters: ${gutters.map(g => Math.round(g.x)).join(', ')}`);

    if (layoutType === 'Landscape/Presentation') {
        return processLandscape(boxItems);
    } else if (layoutType === 'Multi-Column') {
        return processMultiColumn(boxItems, gutterX);
    } else if (layoutType === 'Complex/Mixed-Grid') {
        return processComplexGrid(boxItems);
    } else {
        return processSingleColumn(boxItems);
    }
}

export const executePdfConversion = async function (files) {
    showProgressState(true);
    
    // ── Apply Tuner Config ──
    if (typeof window !== 'undefined' && window.__litedocTunerConfig) {
        updateTuningConfig(window.__litedocTunerConfig);
    }
    
    if (navigator.webdriver) {
        state.autoResolveEnabled = true;
    }
    state.isSkippingFile = false; // Reset skip state
    state.processedData = [];
    state.pendingOcrTexts = state.pendingOcrTexts || {};
    let canceledFiles = 0;
    const ocrPromises = [];

    const checkSkip = () => { if (state.isSkippingFile) throw new Error('SKIP_FILE'); };

    // RTL script detection — Arabic, Hebrew, Syriac, Thaana, etc.
    function containsRTL(str) {
        const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB00-\uFDFF\uFE70-\uFEFF]/g;
        const matches = str.match(rtlRegex);
        if (!matches) return false;
        const chars = str.replace(/\s+/g, '');
        return chars.length > 0 && (matches.length / chars.length) > 0.5;
    }

    fileLoop: for (let fIndex = 0; fIndex < files.length; fIndex++) {
        if (state.isSkippingFile) {
            state.isSkippingFile = false; // Reset for next file in batch
        }
        const file = files[fIndex];
        const baseProgress = (fIndex / files.length) * 100;
        const fileProgressShare = 100 / files.length;

        logToTerminal(`[File ${fIndex + 1}/${files.length}] Initializing: ${file.name}`);
        updateProgress(baseProgress + 5, `Reading file ${fIndex + 1} of ${files.length}...`, file.name);

        try {
            checkSkip();
            
            // --- Handle Direct Image OCR ---
            if (file.type && file.type.startsWith('image/')) {
                logToTerminal(`[OCR] Direct image detected: ${file.name}. Starting OCR...`, 'info');
                const img = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = e => {
                        const img = new Image();
                        img.onload = () => resolve(img);
                        img.onerror = reject;
                        img.src = e.target.result;
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                
                const canv = document.createElement('canvas');
                canv.width = img.width; canv.height = img.height;
                const ctx = canv.getContext('2d');
                ctx.drawImage(img, 0, 0);
                
                const ocrLang = (addons.__litedocAddons && addons.__litedocAddons._settings.ocrLang) || 'eng';
                const ocrResult = await addons.__litedocAddons.ocrCanvas(canv, file.name, { ocrLang, ocrEnabled: true });
                
                const mdText = `\x3C!-- Converted from ${file.name} (Direct OCR${ocrResult && ocrResult.isMultiRegion ? ' - Multi-Region' : ''}) --\x3E\n\n## OCR Result\n\n${ocrResult ? ocrResult.text : ''}`;
                state.processedData.push({ filename: file.name, status: 'success', mdText, extractedImages: [], inlineRenders: {}, numPages: 1 });
                continue fileLoop;
            }

            const arrayBuffer = await file.arrayBuffer();
            checkSkip();
            const originalBuffer = arrayBuffer.slice ? arrayBuffer.slice(0) : new Uint8Array(arrayBuffer).slice().buffer;

            // Enhanced PDF loading with comprehensive format support options
            const loadingOptions = {
                data: arrayBuffer,
                useWorkerFetch: false,
                isEvalSupported: false,
                disableFontFace: false,
                fontExtraProperties: true,
                useSystemFonts: true,
                stopAtErrors: false,
                maxImageSize: 10737418240, // 10GB max image size
                password: file.password || undefined,
                ...(navigator.webdriver ? { onPassword: () => { throw new Error('PasswordException'); } } : {}),
                isOffscreenCanvasSupported: true,
                // CJK support: set window.PDFJS_CMAP_URL to your cmaps/ folder to enable CJK PDFs
                ...(window.PDFJS_CMAP_URL ? { cMapUrl: window.PDFJS_CMAP_URL, cMapPacked: true } : {}),
                // Better font fallback: set window.PDFJS_STANDARD_FONT_URL to your standard_fonts/ folder
                ...(window.PDFJS_STANDARD_FONT_URL ? { standardFontDataUrl: window.PDFJS_STANDARD_FONT_URL } : {}),
            };

            let pdf;
            if (!navigator.webdriver && addons.__litedocAddons && typeof addons.__litedocAddons.loadPdfWithPassword === 'function') {
                pdf = await addons.__litedocAddons.loadPdfWithPassword(arrayBuffer, file.name, file.password);
            } else {
                try {
                    pdf = await pdfjsLib.getDocument(loadingOptions).promise;
                } catch (initialErr) {
                    const errName = initialErr && (initialErr.name || initialErr.constructor && initialErr.constructor.name);
                    const isPwd = errName === 'PasswordException' || /password/i.test(initialErr && initialErr.message || '');
                    if (isPwd) throw initialErr;

                    // Fallback to basic options if enhanced options fail
                    logToTerminal(`Enhanced loading failed, trying basic options...`, 'warn');
                    const basicOptions = {
                        data: originalBuffer.slice(0),
                        password: file.password || undefined,
                        ...(navigator.webdriver ? { onPassword: () => { throw new Error('PasswordException'); } } : {}),
                        stopAtErrors: false
                    };
                    pdf = await pdfjsLib.getDocument(basicOptions).promise;
                }
            }

            const pdfDoc = pdf.pdf ? pdf.pdf : pdf;
            logToTerminal(`Recognized. Pages: ${pdfDoc.numPages}`);
            if (typeof updateProgress === 'function') {
                updateProgress(Math.round(baseProgress + fileProgressShare * 0.1), `Analyzing document layout (${pdfDoc.numPages} pages)...`, file.name);
            }

            // OCR language: pass 'auto' straight through to the OCR queue.
            // It resolves the script PER PAGE (whole page → 2x → bands) and
            // has a post-OCR rescue: if the eng model returns a cluster of
            // low-confidence garbage words, that crop is script-detected and
            // the page re-OCR'd with the right "<script>+eng" combo. A
            // doc-level pre-route can't do any of that (one Japanese line on
            // an English page is invisible to whole-page script detection).
            const docOcrLang = (addons.__litedocAddons && addons.__litedocAddons._settings.ocrLang) || 'eng';

            // pass 1: fingerprint
            let allRawLineTexts = [];
            if (pdfDoc.numPages >= 3) {
                const samplePages = Math.min(pdfDoc.numPages, 12);
                for (let pn = 1; pn <= samplePages; pn++) {
                    const pg = await pdfDoc.getPage(pn);
                    const tc = await pg.getTextContent();
                    const mappedItems = tc.items.map(item => ({
                        str: item.str,
                        x: item.transform[4],
                        y: item.transform[5],
                        width: item.width || Math.abs(item.transform[0]) * item.str.length * 0.55,
                        height: item.height || Math.abs(item.transform[3]) || 12
                    }));
                    mappedItems.sort((a, b) => b.y - a.y || a.x - b.x);
                    
                    const lines = [];
                    for (const item of mappedItems) {
                        const last = lines[lines.length - 1];
                        const tol = Math.max(3, (item.height || 10) * 0.45);
                        let isSameLine = false;
                        if (last && Math.abs(item.y - last.lastY) <= tol) {
                            const gap = item.x - last.xMax;
                            const maxLineGap = (item.height || 10) * 1.5;
                            if (gap < maxLineGap) isSameLine = true;
                        }
                        if (isSameLine) {
                            last.items.push(item);
                            last.xMax = Math.max(last.xMax, item.x + item.width);
                            last.lastY = item.y;
                        } else {
                            lines.push({ items: [item], lastY: item.y, xMax: item.x + item.width });
                        }
                    }
                    for (const lg of lines) {
                        const rawNoSpace = lg.items.map(it => it.str).join('').trim();
                        if (rawNoSpace.length > 0) allRawLineTexts.push(rawNoSpace);
                    }
                    pg.cleanup();
                }
            }
            const repeatingFPs = utils.buildFingerprintSet(allRawLineTexts, pdfDoc.numPages);

            let mdText = `\x3C!-- Converted from ${file.name} — ${pdfDoc.numPages} pages --\x3E\n\n`;
            const extractedImages = [];
            // Structured layout (per page: lines, tables, figures) — the same
            // data the markdown is generated FROM, exposed for --json consumers
            // instead of being thrown away at serialization.
            const docLayout = [];
            const pageInlineRenders = {};
            const sharedCanvas = document.createElement('canvas');
            const sharedCtx = sharedCanvas.getContext('2d', { willReadFrequently: true });

            // pre-scan fonts
            let fontMode = null; 
            {
                const scanPages = Math.min(pdfDoc.numPages, 3);
                let foundCorruption = false;
                for (let sp = 1; sp <= scanPages && !foundCorruption; sp++) {
                    const spg = await pdfDoc.getPage(sp);
                    const stc = await spg.getTextContent({ includeMarkedContent: false });
                    const cf = utils.detectCorruptedFonts(stc.items);
                    if (cf.size > 0) foundCorruption = true;
                    spg.cleanup();
                }
                if (foundCorruption) {
                    if (state.autoResolveEnabled) fontMode = state.autoResolveAction;
                    else fontMode = await showFontAlert(file.name, '');
                    if (fontMode === 'cancel') break fileLoop;
                    if (fontMode === 'skip') continue;
                }
            }

            const CHUNK_SIZE = 10;
            const processChunk = async (startPage, endPage) => {
                for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
                    if (state.isSkippingFile) throw new Error('SKIP_FILE');
                    await new Promise(r => setTimeout(r, 0));
                    if (typeof updateProgress === 'function') {
                        const pct = 0.15 + (0.8 * ((pageNum - 1) / (pdfDoc.numPages || 1)));
                        updateProgress(Math.min(99, Math.max(10, Math.round(baseProgress + fileProgressShare * pct))), `Processing page ${pageNum} of ${pdfDoc.numPages}...`, file.name);
                    }

                    try {
                    const page = await pdfDoc.getPage(pageNum);
                    const textContent = await page.getTextContent({ includeMarkedContent: false });
                    const [_vx0, _vy0, _vx1, _vy1] = page.view;
                    const pageW = _vx1 - _vx0;
                    const pageH = _vy1 - _vy0;

                    const corruptedFonts = utils.detectCorruptedFonts(textContent.items);
                    const pageHasCorruption = corruptedFonts.size > 0;

                    if (fontMode === 'render' && pageHasCorruption) {
                        page.cleanup(); continue;
                    }

                    const effectiveCorruptedFonts = (fontMode === 'gibberish') ? new Set() : corruptedFonts;

                    const rawItems = textContent.items
                        .filter(item => item.str && item.str.length > 0)
                        .map(item => {
                            const [a, b, , , e, f] = item.transform;
                            const fontSize = Math.round(Math.sqrt(a * a + b * b) * 10) / 10;
                            const width = item.width || Math.max(Math.abs(a), Math.abs(b)) * item.str.length * 0.55;
                            const isBold = (item.fontName || '').toLowerCase().includes('bold');
                            const fontName = item.fontName || '__unknown__';
                            const score = utils.itemGibberishScore(item.str, fontName, effectiveCorruptedFonts);
                            const isMarginNoise = f > pageH * 0.96 || f < pageH * 0.04 || e < pageW * 0.04 || e > pageW * 0.96;
                            return {
                                str: item.str, x: e, y: f, width, height: item.height || Math.abs(a) || 12,
                                fontSize, isBold, fontName,
                                garbage: score > activeConfig.garbageScoreThreshold || isMarginNoise,
                                gScore: score,
                            };
                        });

                    const items = [];
                    for (const item of rawItems) {
                        const isDup = items.some(existing => {
                            const posMatch = Math.abs(existing.x - item.x) < activeConfig.itemOverlapTolerance && Math.abs(existing.y - item.y) < activeConfig.itemOverlapTolerance;
                            return posMatch && existing.str.trim() === item.str.trim();
                        });
                        if (!isDup) items.push(item);
                    }

                    if (!items.length) {
                        if (addons.__litedocAddons.ocrEnabled()) {
                            logToTerminal(`[OCR] Page ${pageNum} seems to be a scan. Starting OCR...`, 'info');
                            if (typeof updateProgress === 'function') {
                                const pct = 0.15 + (0.8 * ((pageNum - 1) / (pdfDoc.numPages || 1)));
                                updateProgress(Math.min(99, Math.round(baseProgress + fileProgressShare * pct)), `Running OCR on page ${pageNum} of ${pdfDoc.numPages}...`, file.name);
                            }
                            const vp = page.getViewport({ scale: 2.0 });
                            const canv = document.createElement('canvas');
                            canv.width = vp.width; canv.height = vp.height;
                            const ctx = canv.getContext('2d');
                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(0, 0, canv.width, canv.height);
                            await page.render({ canvasContext: ctx, viewport: vp }).promise;
                            const ocrResult = await addons.__litedocAddons.ocrCanvas(canv, file.name, { ocrLang: docOcrLang, ocrEnabled: true });
                            
                            if (ocrResult && ocrResult.words && ocrResult.words.length > 0) {
                                const pageH_ocr = canv.height;
                                // Need to scale coordinates back to page.view dimensions!
                                // Since we rendered at scale: 2.0, OCR coordinates are 2x the standard PDF coordinates!
                                // Tesseract word bboxes vary with ascenders/descenders, so bbox centres of
                                // words on one visual line spread by several px; the line grouper needs one
                                // shared y per line or it tears lines into interleaved fragments.
                                const ocrWords = ocrResult.words.filter(w => w.bbox && w.text && w.text.trim());
                                ocrWords.sort((a, b) => ((a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1)) || (a.bbox.x0 - b.bbox.x0));
                                const ocrBands = [];
                                for (const w of ocrWords) {
                                    const mid = (w.bbox.y0 + w.bbox.y1) / 2;
                                    const h = w.bbox.y1 - w.bbox.y0;
                                    const band = ocrBands[ocrBands.length - 1];
                                    if (band && Math.abs(mid - band.midSum / band.words.length) < 0.6 * Math.max(band.hSum / band.words.length, h)) {
                                        band.words.push(w);
                                        band.midSum += mid;
                                        band.hSum += h;
                                        band.hMax = Math.max(band.hMax, h);
                                    } else {
                                        ocrBands.push({ words: [w], midSum: mid, hSum: h, hMax: h });
                                    }
                                }
                                for (const band of ocrBands) {
                                    const bandY = (pageH_ocr - band.midSum / band.words.length) / 2.0;
                                    const bandH = (band.hSum / band.words.length) / 2.0;
                                    for (const w of band.words) {
                                        items.push({
                                            str: w.text,
                                            x: w.bbox.x0 / 2.0,
                                            y: bandY,
                                            width: (w.bbox.x1 - w.bbox.x0) / 2.0,
                                            height: bandH,
                                            fontSize: band.hMax / 2.0,
                                            isBold: false,
                                            fontName: w.font_name || 'OCR_Font',
                                            garbage: false,
                                            gScore: 0,
                                            isOcr: true
                                        });
                                    }
                                }
                            } else if (ocrResult && ocrResult.text && ocrResult.text.trim()) {
                                mdText += (pageNum > 1 ? '\n\n---\n\n' : '') + `## Page ${pageNum} (OCR)\n\n` + ocrResult.text;
                                page.cleanup();
                                continue;
                            } else {
                                page.cleanup();
                                continue;
                            }
                        } else {
                            page.cleanup(); continue;
                        }
                    }

                    function groupItemsIntoLines(itemList) {
                        itemList.sort((a, b) => b.y - a.y || a.x - b.x);
                        const lines = [];
                        for (const item of itemList) {
                            const last = lines[lines.length - 1];
                            const ocrTolMultiplier = item.isOcr ? (activeConfig.ocrTolMultiplier ?? 4.0) : 1.0;
                            const tol = Math.max(3, (item.height || 10) * (activeConfig.rowSplitMultiplier / 6.6)) * ocrTolMultiplier;
                            let isSameLine = false;
                            if (last && Math.abs(item.y - last.lastY) <= tol) {
                                const gap = item.x - last.xMax;
                                if (gap < (item.height || 10) * 1.5) isSameLine = true;
                            }
                            if (isSameLine) {
                                last.items.push(item);
                                if (item.garbage) last.garbage = true;
                                last.xMax = Math.max(last.xMax, item.x + item.width);
                                last.lastY = item.y;
                            } else {
                                lines.push({
                                    y: item.y, lastY: item.y, height: item.height, fontSize: item.fontSize, isBold: item.isBold,
                                    items: [item], garbage: item.garbage, xMin: item.x, xMax: item.x + (item.width || 0),
                                });
                            }
                        }
                        for (const lg of lines) {
                            const lineStr = lg.items.map(it => it.str).join('');
                            const rawNoSpace = lg.items.map(it => it.str).join('').replace(/\s+/g, '');
                            const isMargin = lg.y > pageH * activeConfig.bottomMarginThreshold || lg.y < pageH * activeConfig.topMarginThreshold;
                            if ((repeatingFPs.has(rawNoSpace) && isMargin) || (/^\d+$/.test(rawNoSpace) && isMargin)) {
                                lg.garbage = true; lg.items.forEach(it => it.garbage = true);
                            }
                            lg.text = utils.joinLineItems(lg.items.filter(it => !it.garbage), activeConfig);
                            lg.rawText = utils.joinLineItems(lg.items, activeConfig);
                        }
                        return lines;
                    }

                    // Run pre-filter on full page
                    groupItemsIntoLines([...items]);
                    
                    const cleanItems = items.filter(it => !it.garbage);
                    const textBlocks = segmentBox(cleanItems, pageW, pageH);
                    const allLineGroups = [];
                    let blockIdx = 0;
                    for (const region of textBlocks) {
                        if (region.items.length === 0) continue;
                        blockIdx++;
                        const parsedLines = groupItemsIntoLines(region.items); // Uses internal helper
                        parsedLines.forEach(l => {
                            l.blockIdx = blockIdx;
                            const lineStr = l.items.map(it => it.str).join('');
                            l.text = utils.joinLineItems(l.items, activeConfig);
                        });
                        allLineGroups.push(...parsedLines);
                    }

                    const activeLines = allLineGroups.filter(l => !l.isTable && (l.rawText || '').trim().length > 0);
                    const totalLines = activeLines.length;
                    const garbageLines = activeLines.filter(l => l.garbage).length;
                    if (totalLines > 0 && (garbageLines / totalLines) > activeConfig.pageGarbageRatioThreshold) {
                        page.cleanup(); continue;
                    }

                    const medH = allLineGroups.map(l => l.height).sort((a,b) => a-b)[Math.floor(allLineGroups.length/2)] || 12;
                    const hThresh = utils.classifyHeadings(allLineGroups);

                    const pageLayout = {
                        page: pageNum,
                        width: Math.round(pageW), height: Math.round(pageH),
                        lines: allLineGroups
                            .filter(l => !l.garbage && (l.text || '').trim())
                            .map(l => ({
                                text: l.text,
                                y: Math.round(l.y * 100) / 100,
                                x0: Math.round((l.xMin || 0) * 100) / 100,
                                x1: Math.round((l.xMax || 0) * 100) / 100,
                                font_size: l.fontSize || null,
                                block: l.blockIdx || 1,
                                ocr: !!(l.items && l.items.some(it => it.isOcr)),
                            })),
                        tables: [],
                    };
                    docLayout.push(pageLayout);

                    function linesToMd(lines) {
                        const mdArr = [];
                        let prevY = null, paragraphBuf = '', prevLine = null;
                        let tableBuffer = [], tableColsBounds = [];
                        
                        const flushTable = () => {
                            if (tableBuffer.length < 2) {
                                if (tableBuffer.length === 1) mdArr.push(tableBuffer[0].join(' '));
                                tableBuffer = []; tableColsBounds = []; return;
                            }
                            
                            let filledCells = 0;
                            const totalCells = tableBuffer.length * tableColsBounds.length;
                            for (let r = 0; r < tableBuffer.length; r++) {
                                for (let c = 0; c < tableBuffer[r].length; c++) {
                                    if (tableBuffer[r][c].trim() !== '') filledCells++;
                                }
                            }
                            
                            if (totalCells > 0 && (filledCells / totalCells) < activeConfig.tableDensityThreshold) {
                                for (let i = 0; i < tableBuffer.length; i++) {
                                    const rowText = tableBuffer[i].filter(x => x.trim()).join(' ');
                                    if (rowText) mdArr.push(rowText);
                                }
                                tableBuffer = []; tableColsBounds = []; return;
                            }

                            const colCounts = tableBuffer.map(row => row.filter(cell => cell.trim() !== '').length);
                            const minCols = Math.min(...colCounts);
                            const maxCols = Math.max(...colCounts);
                            
                            // Consistency gate for fallback parser
                            if (maxCols - minCols > 2 || maxCols <= 1) {
                                for (const row of tableBuffer) {
                                    const text = row.filter(c => c.trim()).join(' ').trim();
                                    if (text) mdArr.push(text);
                                }
                                tableBuffer = []; tableColsBounds = []; return;
                            }

                            pageLayout.tables.push({ rows: tableBuffer.map(r => r.slice()) });
                            mdArr.push('| ' + tableBuffer[0].join(' | ') + ' |');
                            mdArr.push('|' + Array(tableBuffer[0].length).fill('---').join('|') + '|');
                            for (let i = 1; i < tableBuffer.length; i++) mdArr.push('| ' + tableBuffer[i].join(' | ') + ' |');
                            tableBuffer = []; tableColsBounds = [];
                        };
                        const flushPara = () => { if (paragraphBuf.trim()) { mdArr.push(paragraphBuf.trim()); paragraphBuf = ''; } };

                        for (const lg of lines) {
                            const sortedItems = [...lg.items.filter(it => !it.garbage)].sort((a, b) => a.x - b.x);
                            if (sortedItems.length === 0) continue;

                            let cols = [], curCol = [], hasHugeGap = false;
                            for (let i = 0; i < sortedItems.length; i++) {
                                const curr = sortedItems[i];
                                if (i > 0) {
                                    const prev = sortedItems[i - 1];
                                    const gap = curr.x - (prev.x + (prev.width || 0));
                                    if (gap > Math.max(activeConfig.horizontalGapMin, (curr.height || 10) * activeConfig.horizontalGapMultiplier)) {
                                        cols.push(curCol); curCol = []; hasHugeGap = true;
                                    }
                                }
                                curCol.push(curr);
                            }
                            if (curCol.length > 0) cols.push(curCol);

                            let looksLikeColumns = false;
                            if (hasHugeGap && cols.length > 1) {
                                for (const colItems of cols) {
                                    const cellText = colItems.map(it => it.str).join(' ');
                                    if (cellText.length > 40 || cellText.split(' ').length > 6) { looksLikeColumns = true; break; }
                                }
                            }

                            let belongsToTable = false, rowCells = [];
                            if (tableColsBounds.length > 0 && !looksLikeColumns) {
                                if (prevY !== null && (prevY - lg.y) > medH * activeConfig.tableGapYThreshold) flushTable();
                                else {
                                    rowCells = Array(tableColsBounds.length).fill('');
                                    for (let it of sortedItems) {
                                        const cx = it.x + (it.width || 0) / 2;
                                        let bestCol = -1;
                                        for (let c = 0; c < tableColsBounds.length; c++) {
                                            if (cx >= tableColsBounds[c].min - 30 && cx <= tableColsBounds[c].max + 30) { bestCol = c; break; }
                                        }
                                        if (bestCol !== -1) rowCells[bestCol] += (rowCells[bestCol] ? ' ' : '') + it.str;
                                    }
                                    belongsToTable = true;
                                }
                            }
                            if (!belongsToTable && hasHugeGap && cols.length > 1 && !looksLikeColumns) {
                                tableColsBounds = cols.map(c => ({ min: c[0].x, max: c[c.length - 1].x + (c[c.length - 1].width || 0) }));
                                rowCells = cols.map(c => utils.joinLineItems(c, activeConfig));
                                belongsToTable = true;
                            }

                            if (belongsToTable) {
                                flushPara(); tableBuffer.push(rowCells);
                            } else {
                                flushTable();
                                let txt = lg.text.trim();
                                if (!txt) continue;
                                let level = utils.headingLevel(lg.fontSize, hThresh, lg.isBold);
                                if (level > 0) { flushPara(); mdArr.push('#'.repeat(4-level) + ' ' + txt); }
                                else {
                                    const gap = prevY !== null ? (prevY - lg.y) : 0;
                                    if (gap > medH * activeConfig.paragraphGapThreshold) flushPara();
                                    if (prevLine && Math.abs(lg.fontSize - prevLine.fontSize) < 0.6 && gap < medH * activeConfig.continuationGapThreshold) paragraphBuf += (paragraphBuf.endsWith('-') ? '' : ' ') + txt;
                                    else paragraphBuf = txt;
                                }
                            }
                            prevY = lg.y; prevLine = lg;
                        }
                        flushPara(); flushTable(); return mdArr;
                    }

                    let pageMdLines = [];
                    const bodyBlocks = {};
                    for (const lg of allLineGroups) {
                        const idx = lg.blockIdx !== undefined ? lg.blockIdx : -1;
                        if (!bodyBlocks[idx]) bodyBlocks[idx] = [];
                        bodyBlocks[idx].push(lg);
                    }
                    const blockKeys = Object.keys(bodyBlocks).map(k => parseInt(k)).sort((a, b) => a - b);
                    for (const k of blockKeys) pageMdLines.push(...linesToMd(bodyBlocks[k]));

                    let pageMd = pageMdLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
                    
                    const showPageNums = typeof window !== 'undefined' && window.state ? !window.state.excludePageNumbers : true;
                    if (showPageNums) {
                        mdText += (pageNum > 1 ? '\n\n---\n\n' : '') + `## Page ${pageNum}\n\n` + pageMd;
                    } else {
                        mdText += (pageNum > 1 ? '\n\n' : '') + pageMd;
                    }
                    
                    page.cleanup();
                    } catch (e) {
                        console.error(`[Core Error] Page ${pageNum} processing failed:`, e);
                    }
                }
            };

            for (let chunkStart = 1; chunkStart <= pdfDoc.numPages; chunkStart += CHUNK_SIZE) {
                await processChunk(chunkStart, Math.min(chunkStart + CHUNK_SIZE - 1, pdfDoc.numPages));
            }
            await pdfDoc.destroy();
            state.processedData.push({ filename: file.name, status: 'success', mdText, extractedImages, inlineRenders: pageInlineRenders, numPages: pdfDoc.numPages, layout: docLayout });
        } catch (err) { logToTerminal(`Failed: ${file.name}`, 'error'); }
    }
    updateProgress(100, 'Complete', '');

    if (typeof window !== 'undefined' && window.finishProcessing) {
        window.finishProcessing();
    }
}

if (typeof window !== 'undefined') {
    window.executePdfConversion = executePdfConversion;
}
