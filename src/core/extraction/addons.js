import * as pdfParser from '../layout/pdf-parser.js';
import * as utils from '../utils/utils.js';

// settings
const STORAGE_KEY = 'litedoc_addon_settings_v1';
const settings = {
    ocrEnabled: true,
    ocrLang: 'auto',
    tablesEnabled: true,
    vectorsEnabled: true,
    mathEnabled: true,
    citationsEnabled: true,
};

function loadSettings() {
    try {
        if (typeof localStorage !== 'undefined') {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) Object.assign(settings, JSON.parse(saved));
        }
    } catch (e) { }
}
loadSettings();

function persist() {
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
}

// OCR Logic (Bridge to main ocr.js)
async function ocrCanvas(canvas, fileName, options) {
    if (!window.__litedocOCR) return '[OCR ERROR: Model not loaded]';
    return await window.__litedocOCR.ocrCanvas(canvas, null, { ocrEnabled: true, ocrLang: options.ocrLang || 'eng' });
}

function cleanupWorker() {
    if (window.__litedocOCR) window.__litedocOCR.cleanupWorker();
}

function clearOcrQueue() {
    // ... handled by main ...
}

// PDF Password Bypass Logic
async function loadPdfWithPassword(arrayBuffer, fileName, password) {
    try {
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, password });
        const pdf = await loadingTask.promise;
        return { pdf, password };
    } catch (err) {
        if (err.name === 'PasswordException' || /password/i.test(err.message)) {
            // If we're in headless mode, fail
            if (navigator.webdriver) throw err;
            
            // Show custom password UI
            const userPwd = await showPasswordPrompt(fileName);
            if (userPwd === null) throw new Error('Conversion cancelled by user.');
            return await loadPdfWithPassword(arrayBuffer, fileName, userPwd);
        }
        throw err;
    }
}

function showPasswordPrompt(fileName) {
    return new Promise((resolve) => {
        const dz = document.getElementById('dz-list-container');
        const row = document.createElement('div');
        row.className = 'ld-pw-row section-fade-in';
        row.innerHTML = `
            <div class="ld-pw-head">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                <span>Password Required</span>
            </div>
            <div class="ld-pw-name">${fileName}</div>
            <div class="ld-pw-form">
                <input type="password" placeholder="Enter PDF password..." autofocus>
                <button class="btn-primary ld-pw-submit">Unlock</button>
                <button class="btn-ghost ld-pw-cancel">Cancel</button>
            </div>
            <div class="ld-pw-err"></div>
        `;
        dz.prepend(row);
        const input = row.querySelector('input');
        const submit = row.querySelector('.ld-pw-submit');
        const cancel = row.querySelector('.ld-pw-cancel');

        const handle = () => {
            const val = input.value.trim();
            if (!val) return;
            row.remove(); resolve(val);
        };
        submit.onclick = handle;
        input.onkeydown = (e) => { if (e.key === 'Enter') handle(); };
        cancel.onclick = () => { row.remove(); resolve(null); };
    });
}

// Triage logic for batches
function triageFiles(files) {
    // Future: group by priority or type
    return files;
}

// Enhanced Layout Extraction (Tables, Vectors, Equations)
async function extractVectorRegions(ctx) {
    if (!settings.vectorsEnabled) return '';
    const { page, pdfjsLib, pageNum, pageW, pageH, fileName, extractedImages, logToTerminal } = ctx;
    if (!page || !pdfjsLib) return '';

    const ops = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;

    let vectorOpCount = 0;
    let imageOpCount = 0;
    const IMG_OPS = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject]);

    for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] === OPS.constructPath || ops.fnArray[i] === OPS.rectangle) vectorOpCount++;
        if (IMG_OPS.has(ops.fnArray[i])) imageOpCount++;
    }
    if (vectorOpCount < 80) return '';

    const boxes = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] === OPS.constructPath) {
            const args = ops.argsArray[i];
            if (Array.isArray(args) && args.length >= 3 && Array.isArray(args[2])) {
                const [minX, minY, maxX, maxY] = args[2];
                if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
                    const w = maxX - minX, h = maxY - minY;
                    if (w > 8 && h > 8) boxes.push({ x: minX, y: minY, w, h });
                }
            }
        } else if (ops.fnArray[i] === OPS.rectangle) {
            const a = ops.argsArray[i];
            if (Array.isArray(a) && a.length >= 4) {
                const [x, y, w, h] = a;
                if (w > 8 && h > 8) boxes.push({ x, y, w, h });
            }
        }
    }
    if (boxes.length < 4) return '';
    if (boxes.length > 2000) {
        ctx.logToTerminal(`Vector extraction: Skipped page, too many vector paths (${boxes.length})`, 'info');
        return '';
    }

    function overlap(b1, b2, pad) {
        return !(b1.x + b1.w + pad < b2.x || b2.x + b2.w + pad < b1.x ||
            b1.y + b1.h + pad < b2.y || b2.y + b2.h + pad < b1.y);
    }
    const pad = Math.max(20, pageW * 0.02);
    const clusters = [];
    for (const b of boxes) {
        let merged = false;
        for (const c of clusters) {
            if (overlap(c, b, pad)) {
                const nx = Math.min(c.x, b.x);
                const ny = Math.min(c.y, b.y);
                c.w = Math.max(c.x + c.w, b.x + b.w) - nx;
                c.h = Math.max(c.y + c.h, b.y + b.h) - ny;
                c.x = nx; c.y = ny; c.count = (c.count || 1) + 1;
                merged = true; break;
            }
        }
        if (!merged) clusters.push({ ...b, count: 1 });
    }
    const figures = clusters.filter(c =>
        c.count >= 3 &&
        c.w > pageW * 0.08 && c.h > pageH * 0.05 &&
        c.w < pageW * 0.95 && c.h < pageH * 0.95
    );
    if (!figures.length) return '';

    const imgRes = (typeof state !== 'undefined' && state.selectedImgRes) ? state.selectedImgRes : 1;
    const SCALE = imgRes === 0 ? 1.5 : (imgRes === 1 ? 2.0 : 2.5);
    const vp = page.getViewport({ scale: SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const cctx = canvas.getContext('2d');
    cctx.fillStyle = '#ffffff';
    cctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: cctx, viewport: vp }).promise;
    const checkSkip = () => { if (typeof state !== 'undefined' && state.isSkippingFile) throw new Error('SKIP_FILE'); };
    checkSkip();

    let md = '';
    let figIdx = 1;
    for (const f of figures) {
        const sx = Math.max(0, f.x * SCALE - 6);
        const sw = Math.min(canvas.width - sx, f.w * SCALE + 12);
        const sy = Math.max(0, (pageH - f.y - f.h) * SCALE - 6);
        const sh = Math.min(canvas.height - sy, f.h * SCALE + 12);
        if (sw < 20 || sh < 20) continue;
        const crop = document.createElement('canvas');
        crop.width = Math.round(sw);
        crop.height = Math.round(sh);
        const ccx = crop.getContext('2d');
        ccx.fillStyle = '#ffffff';
        ccx.fillRect(0, 0, crop.width, crop.height);
        ccx.drawImage(canvas, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
        const q = imgRes === 0 ? 0.82 : (imgRes === 1 ? 0.9 : 0.96);
        const dataUrl = crop.toDataURL('image/jpeg', q);
        crop.width = 0; crop.height = 0;
        const name = `${fileName}_p${pageNum}_figure${figIdx}.jpg`;
        extractedImages.push({ name, dataUrl, dims: `${sw}×${sh}` });

        const figureMd = `\n\n!Figure ${figIdx}`;

        // Map the figure back into the text flow using its vertical position
        const figTopY = f.y + f.h;
        const closestLg = ctx.lineGroups.length > 0 ? ctx.lineGroups.reduce((prev, curr) => {
            return (Math.abs(curr.y - figTopY) < Math.abs(prev.y - figTopY)) ? curr : prev;
        }, ctx.lineGroups[0]) : null;

        if (closestLg && Math.abs(closestLg.y - figTopY) < 150) closestLg.injectedMarkdown = (closestLg.injectedMarkdown || '') + figureMd;
        else md += figureMd;

        figIdx++;
    }
    canvas.width = 0; canvas.height = 0;
    return md;
}

async function findTableGrids(ctx) {
    const { page, pdfjsLib } = ctx;
    if (!page || !pdfjsLib) return [];

    const ops = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;
    const vLinesRaw = [];
    const hLinesRaw = [];
    let curX = 0, curY = 0;

    for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i];
        if (fn === OPS.moveTo) {
            curX = args[0]; curY = args[1];
        } else if (fn === OPS.lineTo) {
            const x = args[0], y = args[1];
            if (Math.abs(y - curY) < 2 && Math.abs(x - curX) > 5) {
                hLinesRaw.push({ y: (y + curY) / 2, x1: Math.min(x, curX), x2: Math.max(x, curX) });
            } else if (Math.abs(x - curX) < 2 && Math.abs(y - curY) > 5) {
                vLinesRaw.push({ x: (x + curX) / 2, y1: Math.min(y, curY), y2: Math.max(y, curY) });
            }
            curX = x; curY = y;
        } else if (fn === OPS.rectangle) {
            const rx = args[0], ry = args[1], rw = args[2], rh = args[3];
            hLinesRaw.push({ y: ry, x1: rx, x2: rx + rw });
            hLinesRaw.push({ y: ry + rh, x1: rx, x2: rx + rw });
            vLinesRaw.push({ x: rx, y1: Math.min(ry, ry + rh), y2: Math.max(ry, ry + rh) });
            vLinesRaw.push({ x: rx + rw, y1: Math.min(ry, ry + rh), y2: Math.max(ry, ry + rh) });
        } else if (fn === OPS.constructPath) {
            const opList = args[0];
            const opArgs = args[1];
            let argIdx = 0;
            for (let j = 0; j < opList.length; j++) {
                const op = opList[j];
                if (op === 1) { // MOVE_TO
                    curX = opArgs[argIdx++]; curY = opArgs[argIdx++];
                } else if (op === 2) { // LINE_TO
                    const x = opArgs[argIdx++], y = opArgs[argIdx++];
                    if (Math.abs(y - curY) < 2 && Math.abs(x - curX) > 5) {
                        hLinesRaw.push({ y: (y + curY) / 2, x1: Math.min(x, curX), x2: Math.max(x, curX) });
                    } else if (Math.abs(x - curX) < 2 && Math.abs(y - curY) > 5) {
                        vLinesRaw.push({ x: (x + curX) / 2, y1: Math.min(y, curY), y2: Math.max(y, curY) });
                    }
                    curX = x; curY = y;
                } else if (op === 7) { // RECTANGLE
                    const rx = opArgs[argIdx++], ry = opArgs[argIdx++], rw = opArgs[argIdx++], rh = opArgs[argIdx++];
                    hLinesRaw.push({ y: ry, x1: rx, x2: rx + rw });
                    hLinesRaw.push({ y: ry + rh, x1: rx, x2: rx + rw });
                    vLinesRaw.push({ x: rx, y1: Math.min(ry, ry + rh), y2: Math.max(ry, ry + rh) });
                    vLinesRaw.push({ x: rx + rw, y1: Math.min(ry, ry + rh), y2: Math.max(ry, ry + rh) });
                } else if (op === 3) { // CURVE_TO
                    argIdx += 6; curX = opArgs[argIdx - 2]; curY = opArgs[argIdx - 1];
                } else if (op === 4 || op === 5) { // CURVE_TO2 & CURVE_TO3
                    argIdx += 4; curX = opArgs[argIdx - 2]; curY = opArgs[argIdx - 1];
                } else if (op === 6) { // CLOSE_PATH
                    // closePath 
                }
            }
        }
    }

    // Consolidate overlapping lines
    const hLines = [];
    for (const h of hLinesRaw) {
        let found = false;
        for (const existing of hLines) {
            if (Math.abs(existing.y - h.y) < 4) {
                existing.x1 = Math.min(existing.x1, h.x1);
                existing.x2 = Math.max(existing.x2, h.x2);
                found = true;
                break;
            }
        }
        if (!found) hLines.push({ ...h });
    }

    const vLines = [];
    for (const v of vLinesRaw) {
        let found = false;
        for (const existing of vLines) {
            if (Math.abs(existing.x - v.x) < 4) {
                existing.y1 = Math.min(existing.y1, v.y1);
                existing.y2 = Math.max(existing.y2, v.y2);
                found = true;
                break;
            }
        }
        if (!found) vLines.push({ ...v });
    }

    hLines.sort((a, b) => b.y - a.y);
    vLines.sort((a, b) => a.x - b.x);

    // Find grid intersections
    const grids = [];
    // Basic rectangular grid discovery based on intersecting lines
    return grids;
}

async function detectTables(ctx) {
    if (!settings.tablesEnabled) return '';
    const { lineGroups, columns, leftLines, rightLines, logToTerminal } = ctx;

    let finalMd = '';
    let tableState = { idx: 1 };

    const linesToUse = columns && columns.length > 0 ? columns : (leftLines && rightLines ? [leftLines, rightLines] : [lineGroups]);

    for (let i = 0; i < linesToUse.length; i++) {
        const currentLines = linesToUse[i];
        if (!currentLines || currentLines.length === 0) continue;

        finalMd += await processTableLines(currentLines, ctx, linesToUse.length > 1 ? `Col ${i + 1}` : 'Full', tableState);
    }
    return finalMd;
}

async function processTableLines(linesToProcess, ctx, columnLabel, tableState) {
    const { logToTerminal } = ctx;
    logToTerminal(`Table detection: Restructuring text grid for analysis (${columnLabel})`, 'info');

    // Extract all valid items and reconstruct strict horizontal lines
    const allItems = [];
    for (const lg of linesToProcess) {
        if (lg.garbage) continue;
        for (const item of lg.items) {
            if (!item.garbage && item.str.trim()) {
                allItems.push(item);
            }
        }
    }

    if (allItems.length < 4) return '';

    allItems.sort((a, b) => b.y - a.y || a.x - b.x);

    // Group into lines with tight tolerance
    const lines = [];
    for (const item of allItems) {
        const lastLine = lines[lines.length - 1];
        const baseOcrTol = (typeof activeConfig !== 'undefined' && activeConfig.ocrTolMultiplier) ? activeConfig.ocrTolMultiplier : 4.0;
        const ocrTolMultiplier = item.isOcr ? baseOcrTol : 1.0;
        const rowSplitMultiplier = (typeof activeConfig !== 'undefined' && activeConfig.rowSplitMultiplier) ? activeConfig.rowSplitMultiplier : 3.0;
        const tol = Math.max(3, (item.height || 10) * (rowSplitMultiplier / 6.6)) * ocrTolMultiplier;
        if (lastLine && Math.abs(item.y - (lastLine.lastY || lastLine.y)) <= tol) {
            lastLine.items.push(item);
            lastLine.lastY = item.y;
        } else {
            lines.push({ y: item.y, lastY: item.y, height: item.height || 10, items: [item] });
        }
    }

    if (lines.length < 2) return '';

    const tableBlocks = [];
    let currentBlock = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const sortedItems = [...line.items].sort((a, b) => a.x - b.x);
        
        const cells = [];
        let currentCell = null;

        for (const item of sortedItems) {
            const gapMultiplier = (typeof activeConfig !== 'undefined' && activeConfig.gapMultiplier) ? activeConfig.gapMultiplier : 1.0;
            const cellGapThreshold = (item.height || 10) * gapMultiplier;
            const gap = currentCell ? (item.x - currentCell.xMax) : Infinity;

            if (currentCell && gap < cellGapThreshold) {
                currentCell.str += ' ' + item.str;
                currentCell.xMax = Math.max(currentCell.xMax, item.x + (item.width || 0));
                currentCell.items.push(item);
            } else {
                currentCell = {
                    str: item.str,
                    xMin: item.x,
                    xMax: item.x + (item.width || 0),
                    items: [item]
                };
                cells.push(currentCell);
            }
        }
        line.cells = cells;

        const isTableRow = cells.length >= 2;

        if (isTableRow) {
            currentBlock.push(line);
        } else {
            if (currentBlock.length >= 3) {
                tableBlocks.push(currentBlock);
            }
            currentBlock = [];
        }
    }
    if (currentBlock.length >= 3) tableBlocks.push(currentBlock);

    let md = '';
    for (const blockLines of tableBlocks) {
        // Find column boundaries
        const colStarts = new Set();
        blockLines.forEach(l => l.cells.forEach(c => colStarts.add(Math.round(c.xMin / 10) * 10)));
        const cols = Array.from(colStarts).sort((a, b) => a - b);
        
        // Consolidate columns that are too close
        const finalCols = [];
        for (const c of cols) {
            if (finalCols.length === 0 || c - finalCols[finalCols.length - 1] > 25) {
                finalCols.push(c);
            }
        }
        let numCols = finalCols.length;
        if (numCols < 2) continue;

        // NEW: Column consistency gate
        const colCounts = blockLines.map(l => l.cells.length);
        const minCols = Math.min(...colCounts);
        const maxCols = Math.max(...colCounts);
        
        // If the number of cells per row varies wildly, it's likely a falsely clustered paragraph.
        if (maxCols - minCols > 2) {
            logToTerminal(`Table detection: Skipped block, column count highly inconsistent (min: ${minCols}, max: ${maxCols})`, 'info');
            continue;
        }

        // NEW: Vertical Alignment Gate
        // In a real table, the distinct vertical columns (numCols) should roughly match the max cells in any row (maxCols).
        // If numCols is much larger, it means the text is scattered (like a staggered prose paragraph) and doesn't form a grid.
        if (numCols > maxCols + 1) {
            logToTerminal(`Table detection: Skipped block, cells do not align vertically (numCols: ${numCols}, maxCols: ${maxCols})`, 'info');
            continue;
        }

        const grid = [];
        let overlapCount = 0;
        const colExt = Array.from({ length: numCols }, () => ({ min: Infinity, max: -Infinity }));

        for (const line of blockLines) {
            const rowData = Array(numCols).fill('');
            for (const cell of line.cells) {
                let bestCol = 0;
                let minDist = Infinity;
                for (let c = 0; c < numCols; c++) {
                    const dist = Math.abs(cell.xMin - finalCols[c]);
                    if (dist < minDist) {
                        minDist = dist;
                        bestCol = c;
                    }
                }
                
                // Complex Merged Cells
                let endCol = bestCol;
                for (let c = bestCol + 1; c < numCols; c++) {
                    if (cell.xMax > finalCols[c] - 15) {
                        endCol = c;
                    }
                }
                
                if (endCol > bestCol) {
                    overlapCount += (endCol - bestCol);
                    rowData[bestCol] += (rowData[bestCol] ? ' ' : '') + cell.str; colExt[bestCol].min = Math.min(colExt[bestCol].min, cell.xMin); colExt[bestCol].max = Math.max(colExt[bestCol].max, cell.xMax);
                    for (let span = bestCol + 1; span <= endCol; span++) {
                        rowData[span] = ''; 
                    }
                } else {
                    rowData[bestCol] += (rowData[bestCol] ? ' ' : '') + cell.str; colExt[bestCol].min = Math.min(colExt[bestCol].min, cell.xMin); colExt[bestCol].max = Math.max(colExt[bestCol].max, cell.xMax);
                }
            }
            grid.push({ rowData, line });
        }
        // Right-aligned columns: a header and its numbers share a right edge but not a left
        // edge, so they landed in two half-empty columns. Merge neighbours that no row uses
        // together and whose cells overlap horizontally.
        for (let c = numCols - 2; c >= 0; c--) {
            const exclusive = grid.every(r => !(r.rowData[c].trim() && r.rowData[c + 1].trim()));
            const overlap = colExt[c].max >= colExt[c + 1].min && colExt[c + 1].max >= colExt[c].min;
            if (!exclusive || !overlap) continue;
            for (const r of grid) r.rowData.splice(c, 2, (r.rowData[c] + ' ' + r.rowData[c + 1]).trim());
            colExt.splice(c, 2, { min: Math.min(colExt[c].min, colExt[c + 1].min), max: Math.max(colExt[c].max, colExt[c + 1].max) });
            numCols--;
        }

        let filledCount = 0;
        grid.forEach(r => r.rowData.forEach(c => { if (c.trim()) filledCount++; }));
        const fillRatio = filledCount / (grid.length * numCols);

        if (fillRatio < 0.10) {
            logToTerminal(`Table detection: Skipped block, fill ratio too low (${fillRatio.toFixed(2)})`, 'info');
            continue;
        }

        if (overlapCount > (grid.length * numCols) * 0.60) {
            logToTerminal(`Table detection: Skipped block, looks like a paragraph (overlap ratio too high)`, 'info');
            continue;
        }

        logToTerminal(`Table detection: Found table with ${grid.length} rows, ${numCols} cols`, 'success');

        for (const r of grid) {
            for (const cell of r.line.cells) {
                for (const it of cell.items) {
                    it.garbage = true;
                    it.str = '';
                }
            }
        }

        let isContinuation = false;
        let prevHeader = null;
        if (tableState.idx === 1 && window.__litedocTableState && window.__litedocTableState.lastTable &&
            window.__litedocTableState.lastTable.cols === numCols) {
            
            const lastH = window.__litedocTableState.lastTable.header;
            const rowTexts = grid[0].rowData.map(c => (c || '').trim());
            
            let headerMatch = false;
            if (lastH) {
                let matchCount = 0;
                for (let i = 0; i < numCols; i++) {
                    if (lastH[i] && rowTexts[i] && lastH[i] === rowTexts[i]) matchCount++;
                }
                if (matchCount / numCols >= 0.5) headerMatch = true;
            }
            
            if (headerMatch || window.__litedocTableState.lastTable.pageNum >= ctx.pageNum - 2) {
                isContinuation = true;
                prevHeader = window.__litedocTableState.lastTable.header;
                if (headerMatch && grid.length > 1) {
                    grid.shift();
                }
            }
        }

        const esc = s => (s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();

        let tableMd = '\n\n';
        for (let r = 0; r < grid.length; r++) {
            const rowTexts = grid[r].rowData.map(esc);
            tableMd += '| ' + rowTexts.join(' | ') + ' |\n';

            if (r === 0) {
                if (isContinuation && prevHeader) {
                    tableMd = tableMd.replace('| ' + rowTexts.join(' | ') + ' |\n', '| ' + prevHeader.join(' | ') + ' |\n|' + prevHeader.map(() => '---').join('|') + '|\n| ' + rowTexts.join(' | ') + ' |\n');
                    window.__litedocTableState.lastTable = { pageNum: ctx.pageNum, cols: numCols, header: prevHeader };
                } else {
                    tableMd += '|' + rowTexts.map(() => '---').join('|') + '|\n';

                    if (!window.__litedocTableState) window.__litedocTableState = {};
                    window.__litedocTableState.lastTable = { pageNum: ctx.pageNum, cols: numCols, header: rowTexts };
                }
            }
        }

        const firstItem = grid[0].line.cells.find(c => c.items.length)?.items[0];
        const parentLg = firstItem ? ctx.lineGroups.find(lg => lg.items.includes(firstItem)) : null;

        if (parentLg) parentLg.injectedMarkdown = (parentLg.injectedMarkdown || '') + tableMd;
        else md += tableMd;

        tableState.idx++;
    }
    return md;
}

async function detectMathRegions(ctx) {
    if (!settings.mathEnabled) return '';
    // Math-specific symbols only — exclude common chars (=, +, /, <, >, ^, _) that trigger false positives
    const mathSymbols = /[∑∫∂√∞≈≠≡≤≥πθλμσφωΔΩ−×÷∇∏∐∀∃∄∈∉∋∌⊂⊃⊆⊇⊕⊗⊥ζαβγδεηικξρστυϕχψωΓΛΞΠΣΥΦΨΩ\u2070-\u2079\u2080-\u209C\u207A-\u207E]/g;

    for (const lg of ctx.lineGroups) {
        if (lg.garbage || lg.isTable) continue;
        const text = (lg.text || lg.rawText || '').trim();
        if (text.length < 3) continue;

        const matches = text.match(mathSymbols);
        const symbolCount = matches ? matches.length : 0;
        const density = symbolCount / text.length;

        // Heuristic: If it has multiple symbols or high density, or looks like a stand-alone equation
        const isMath = (symbolCount >= 2 && density > 0.15) || (symbolCount >= 1 && text.length < 20 && density > 0.3) || /^[A-Z][a-z]?\s*=\s*/.test(text);

        if (isMath) {
            const mathMd = `\n\n$$ ${text} $$\n\n`;
            lg.injectedMarkdown = (lg.injectedMarkdown || '') + mathMd;
            lg.garbage = true; 
            lg.items.forEach(it => it.garbage = true);
        }
    }
    return '';
}

async function detectCitations(ctx) {
    if (!settings.citationsEnabled) return '';

    // Reset the tracking state if we are starting a new document (Page 1)
    if (!window.__litedocCitationState || ctx.pageNum === 1) {
        window.__litedocCitationState = { inReferences: false };
    }

    const state = window.__litedocCitationState;
    const citationsFoundOnPage = [];
    let currentCitation = null;

    for (const lg of ctx.lineGroups) {
        if (lg.garbage && !lg.text) continue;

        const text = (lg.text || lg.rawText || '').trim();
        if (!text) continue;

        if (!state.inReferences) {
            const lower = text.toLowerCase();
            if ((lower === 'references' || lower === 'bibliography' || lower === 'literature cited') && text.length < 30) {
                state.inReferences = true;
                lg.garbage = true; // Consume the header itself
                continue;
            }
        }

        if (state.inReferences) {
            // Stop capturing if we hit typical post-reference sections
            const stopMatch = text.toLowerCase().match(/^(appendices|supplementary data|acknowledgments)/);
            if (stopMatch && text.length < 30) {
                state.inReferences = false;
                break;
            }

            // Check for new numbered citation (e.g., "[1] " or "1. ")
            const match = text.match(/^(?:\[(\d+)\]|(\d+)\.)\s+(.+)/);
            if (match) {
                if (currentCitation) citationsFoundOnPage.push(currentCitation);
                currentCitation = { id: match[1] || match[2], text: match[3] };
                lg.garbage = true; // Hide from standard markdown flow
            } else if (currentCitation) {
                currentCitation.text += ' ' + text; // Continuation line
                lg.garbage = true;
            }
        }
    }
    if (currentCitation) citationsFoundOnPage.push(currentCitation);

    if (citationsFoundOnPage.length > 0) {
        ctx.logToTerminal && ctx.logToTerminal(`Citation extraction: Found ${citationsFoundOnPage.length} references on page ${ctx.pageNum}`, 'success');
        const jsonStr = JSON.stringify(citationsFoundOnPage, null, 2);
        return `\n\n### Extracted Citations (JSON)\n\`\`\`json\n${jsonStr}\n\`\`\`\n\n`;
    }
    return '';
}

async function enhancePage(ctx) {
    let extra = '';
    try { extra += await detectTables(ctx); } catch (e) { ctx.logToTerminal && ctx.logToTerminal('table detection error: ' + e.message, 'warn'); }
    try { extra += await extractVectorRegions(ctx); } catch (e) { ctx.logToTerminal && ctx.logToTerminal('vector extraction error: ' + e.message, 'warn'); }
    try { extra += await detectMathRegions(ctx); } catch (e) { ctx.logToTerminal && ctx.logToTerminal('math extraction error: ' + e.message, 'warn'); }
    try { extra += await detectCitations(ctx); } catch (e) { ctx.logToTerminal && ctx.logToTerminal('citation extraction error: ' + e.message, 'warn'); }
    return extra;
}

function buildSettingsUI() {
    const settingsCard = document.querySelector('.settings-card');
    if (!settingsCard) return;
    if (settingsCard.querySelector('.ld-addon-block')) return;

    const block = document.createElement('div');
    block.className = 'ld-addon-block';
    block.innerHTML = `
        <div class="ld-addon-row">
            <div class="ld-addon-info">
                <span class="ld-addon-label">OCR for scanned PDFs</span>
                <span class="ld-addon-sub">Run Tesseract on pages with no text layer</span>
            </div>
            <button type="button" class="ld-addon-toggle ${settings.ocrEnabled ? 'on' : ''}" data-key="ocrEnabled" aria-label="Toggle OCR"></button>
        </div>
        <div class="ld-addon-row" data-when="ocrEnabled" style="${settings.ocrEnabled ? '' : 'display:none'}">
            <div class="ld-addon-info">
                <span class="ld-addon-label">OCR language</span>
                <span class="ld-addon-sub">Tesseract language model</span>
            </div>
            <div class="ld-custom-select" data-key="ocrLang">
                <div class="ld-select-display">
                    <span class="ld-select-value">Auto-Detect (OSD)</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <div class="ld-select-dropdown">
                    <div class="ld-select-option" data-value="auto">Auto-Detect (OSD)</div>
                    <div class="ld-select-option" data-value="eng">English</div>
                    <div class="ld-select-option" data-value="ara">Arabic</div>
                    <div class="ld-select-option" data-value="ara+eng">Arabic + English</div>
                    <div class="ld-select-option" data-value="fra+eng">French + English</div>
                    <div class="ld-select-option" data-value="deu+eng">German + English</div>
                    <div class="ld-select-option" data-value="spa+eng">Spanish + English</div>
                    <div class="ld-select-option" data-value="chi_sim+eng">Chinese + English</div>
                    <div class="ld-select-option" data-value="jpn+eng">Japanese + English</div>
                    <div class="ld-select-option" data-value="kor+eng">Korean + English</div>
                    <div class="ld-select-option" data-value="rus+eng">Russian + English</div>
                </div>
            </div>
        </div>
        <div class="ld-addon-row">
            <div class="ld-addon-info">
                <span class="ld-addon-label">Detect tables &amp; columns</span>
                <span class="ld-addon-sub">Emit GFM tables when rows align cleanly</span>
            </div>
            <button type="button" class="ld-addon-toggle ${settings.tablesEnabled ? 'on' : ''}" data-key="tablesEnabled" aria-label="Toggle tables"></button>
        </div>
        <div class="ld-addon-row">
            <div class="ld-addon-info">
                <span class="ld-addon-label">Extract vector figures</span>
                <span class="ld-addon-sub">Capture charts/diagrams drawn as paths</span>
            </div>
            <button type="button" class="ld-addon-toggle ${settings.vectorsEnabled ? 'on' : ''}" data-key="vectorsEnabled" aria-label="Toggle vectors"></button>
        </div>
        <div class="ld-addon-row">
            <div class="ld-addon-info">
                <span class="ld-addon-label">Extract citations (JSON)</span>
                <span class="ld-addon-sub">Parse academic references into structured JSON format</span>
            </div>
            <button type="button" class="ld-addon-toggle ${settings.citationsEnabled ? 'on' : ''}" data-key="citationsEnabled" aria-label="Toggle citations"></button>
        </div>
    `;

    const body = settingsCard.querySelector('.m-collapse-body') || settingsCard.querySelector('div');
    (body || settingsCard).appendChild(block);

    block.querySelectorAll('.ld-addon-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.key;
            settings[key] = !settings[key];
            btn.classList.toggle('on', settings[key]);
            persist();
            const dep = block.querySelector(`[data-when="${key}"]`);
            if (dep) dep.style.display = settings[key] ? '' : 'none';
        });
    });
    
    const customSel = block.querySelector('.ld-custom-select[data-key="ocrLang"]');
    if (customSel) {
        const display = customSel.querySelector('.ld-select-value');
        const options = customSel.querySelectorAll('.ld-select-option');

        const initialOpt = Array.from(options).find(o => o.dataset.value === settings.ocrLang) || options[0];
        display.textContent = initialOpt.textContent;
        options.forEach(o => o.classList.toggle('selected', o === initialOpt));

        customSel.addEventListener('click', (e) => {
            e.stopPropagation();
            customSel.classList.toggle('open');
        });

        document.addEventListener('click', () => {
            customSel.classList.remove('open');
        });

        options.forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                settings.ocrLang = opt.dataset.value;
                display.textContent = opt.textContent;
                options.forEach(o => o.classList.toggle('selected', o === opt));
                customSel.classList.remove('open');
                
                if (window.__litedocOCR) window.__litedocOCR.cleanupWorker();
                persist();
            });
        });
    }
}

export const __litedocAddons = {
    loadPdfWithPassword,
    ocrCanvas,
    ocrEnabled: () => settings.ocrEnabled,
    enhancePage,
    cleanupWorker,
    clearOcrQueue,
    triageFiles,
    _settings: settings,
};

if (typeof window !== 'undefined') {
    window.__litedocAddons = __litedocAddons;
}

if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') buildSettingsUI();
    else document.addEventListener('DOMContentLoaded', buildSettingsUI);
}
