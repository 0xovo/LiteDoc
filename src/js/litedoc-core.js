var LiteDocCore = (function () {
    'use strict';

    // script classifier
    function scriptBucket(cp) {
        if (cp >= 0x0000 && cp <= 0x007F) return 'latin-basic';
        if (cp >= 0x0080 && cp <= 0x024F) return 'latin-ext';
        if (cp >= 0x0250 && cp <= 0x02FF) return 'ipa';
        if (cp >= 0x0300 && cp <= 0x036F) return 'combining';
        if (cp >= 0x0370 && cp <= 0x03FF) return 'greek';
        if (cp >= 0x0400 && cp <= 0x04FF) return 'cyrillic';
        if (cp >= 0x0600 && cp <= 0x06FF) return 'arabic';
        if (cp >= 0x0900 && cp <= 0x097F) return 'devanagari';
        if (cp >= 0x1800 && cp <= 0x18AF) return 'mongolian';
        if (cp >= 0x2000 && cp <= 0x206F) return 'general-punct';
        if (cp >= 0x2070 && cp <= 0x209F) return 'super-sub';
        if (cp >= 0x20A0 && cp <= 0x20CF) return 'currency';
        if (cp >= 0x2100 && cp <= 0x214F) return 'letterlike';
        if (cp >= 0x2150 && cp <= 0x218F) return 'numforms';
        if (cp >= 0x2190 && cp <= 0x21FF) return 'arrows';
        if (cp >= 0x2200 && cp <= 0x22FF) return 'math-ops';
        if (cp >= 0x2300 && cp <= 0x23FF) return 'misc-tech';
        if (cp >= 0x2400 && cp <= 0x243F) return 'control-pics';
        if (cp >= 0x2440 && cp <= 0x245F) return 'ocr';
        if (cp >= 0x2460 && cp <= 0x24FF) return 'enclosed-alpha';
        if (cp >= 0x2500 && cp <= 0x257F) return 'box-drawing';
        if (cp >= 0x2580 && cp <= 0x259F) return 'block-elements';
        if (cp >= 0x25A0 && cp <= 0x25FF) return 'geom-shapes';
        if (cp >= 0x2600 && cp <= 0x27FF) return 'misc-symbols';
        if (cp >= 0x2800 && cp <= 0x28FF) return 'braille';
        if (cp >= 0x2E80 && cp <= 0x2FFF) return 'cjk-radicals';
        if (cp >= 0x3000 && cp <= 0x303F) return 'cjk-symbols';
        if (cp >= 0x3040 && cp <= 0x309F) return 'hiragana';
        if (cp >= 0x30A0 && cp <= 0x30FF) return 'katakana';
        if (cp >= 0x3100 && cp <= 0x312F) return 'bopomofo';
        if (cp >= 0x3190 && cp <= 0x319F) return 'kanbun';
        if (cp >= 0x3200 && cp <= 0x32FF) return 'enclosed-cjk';
        if (cp >= 0x3300 && cp <= 0x33FF) return 'cjk-compat';
        if (cp >= 0x3400 && cp <= 0x9FFF) return 'cjk-unified';
        if (cp >= 0xA000 && cp <= 0xA4CF) return 'yi';
        if (cp >= 0xE000 && cp <= 0xF8FF) return 'pua';
        if (cp >= 0xFB00 && cp <= 0xFDFF) return 'arabic-pres';
        if (cp >= 0xFE00 && cp <= 0xFEFF) return 'halfwidth';
        if (cp >= 0xFFF0 && cp <= 0xFFFF) return 'specials';
        if (cp >= 0xF0000) return 'pua-supp';
        return 'other';
    }

    // suspicious buckets
    const SUSPICIOUS_BUCKETS = new Set([
        'braille', 'mongolian', 'cjk-radicals', 'cjk-symbols',
        'hiragana', 'katakana', 'enclosed-cjk', 'cjk-compat',
        'cjk-unified', 'pua', 'pua-supp', 'specials', 'yi',
        'misc-symbols', 'control-pics'
    ]);

    // corruption detector
    function detectCorruptedFonts(rawItems) {
        // group by font
        const byFont = {};
        for (const item of rawItems) {
            const fn = item.fontName || '__unknown__';
            if (!byFont[fn]) byFont[fn] = { chars: 0, suspicious: 0, buckets: new Set() };
            const entry = byFont[fn];
            for (const ch of (item.str || '')) {
                const cp = ch.codePointAt(0);
                if (cp <= 0x20) continue; // skip whitespace
                entry.chars++;
                const bkt = scriptBucket(cp);
                entry.buckets.add(bkt);
                if (SUSPICIOUS_BUCKETS.has(bkt)) entry.suspicious++;
            }
        }

        const corrupted = new Set();
        for (const [fn, stats] of Object.entries(byFont)) {
            if (stats.chars < 3) continue;
            const suspRatio = stats.suspicious / stats.chars;

            // hard rule > 30%
            if (suspRatio > 0.30) { corrupted.add(fn); continue; }

            // soft rule
            if (suspRatio > 0.08) {
                const hasSuspicious = [...stats.buckets].some(b => SUSPICIOUS_BUCKETS.has(b));
                const hasLatin = stats.buckets.has('latin-basic') || stats.buckets.has('latin-ext');
                if (hasSuspicious && hasLatin) { corrupted.add(fn); continue; }
            }

            // subset fonts
            if (/^[A-Z]{6}\+/.test(fn) && suspRatio > 0.05) {
                corrupted.add(fn); continue;
            }
        }
        return corrupted;
    }

    // gibberish scorer
    function itemGibberishScore(str, fontName, corruptedFonts) {
        // skip if font already flagged
        if (corruptedFonts && corruptedFonts.has(fontName)) return 1.0;

        if (!str || !str.trim()) return 0;
        const clean = str.replace(/\s/g, '');
        if (!clean.length) return 0;

        let puaBad = 0, suspBad = 0, totalScored = 0;
        const buckets = new Set();

        for (const ch of clean) {
            const cp = ch.codePointAt(0);
            if (cp <= 0x20) continue;
            totalScored++;
            const bkt = scriptBucket(cp);
            buckets.add(bkt);
            if (bkt === 'pua' || bkt === 'pua-supp' || bkt === 'specials') { puaBad++; }
            else if (SUSPICIOUS_BUCKETS.has(bkt)) { suspBad++; }
        }

        if (!totalScored) return 0;

        const puaRatio = puaBad / totalScored;
        const suspRatio = suspBad / totalScored;

        // script mix penalty
        const suspBuckets = [...buckets].filter(b => SUSPICIOUS_BUCKETS.has(b));
        const hasLatin = buckets.has('latin-basic') || buckets.has('latin-ext');
        const mixPenalty = (hasLatin && suspBuckets.length >= 2) ? 0.5 : 0;

        return Math.min(1, puaRatio * 2.0 + suspRatio * 1.2 + mixPenalty);
    }

    // smart word join
    function joinLineItems(items, config) {
        if (!items.length) return '';
        const hm = (config && config.horizontalGapMultiplier) || 1.0;
        
        // sort x, skip whitespace-only items
        const validItems = items.filter(it => it.str && it.str.trim());
        if (!validItems.length) return '';
        const sorted = [...validItems].sort((a, b) => a.x - b.x);
        let result = sorted[0].str;
        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1];
            const curr = sorted[i];
            // prev right edge
            const prevRight = prev.x + (prev.width || 0);
            const gap = curr.x - prevRight;

            // Punctuation kerning is tighter. Lower the space threshold if the previous text ends with punctuation.
            const endsWithPunctuation = /[.,;:!?]/.test(prev.str.trim().slice(-1));
            const spaceThreshold = (prev.height || 10) * (endsWithPunctuation ? 0.08 : 0.18) * hm;

            // Subscript / Superscript / Drop-cap logic
            const isDropCap = prev.str.length === 1 && prev.height > (curr.height * 1.5) && gap < curr.height;
            const isSuperSub = (curr.height < prev.height * 0.75 || prev.height < curr.height * 0.75) && Math.abs((curr.y || 0) - (prev.y || 0)) > 1;

            // space insert
            let needSpace = gap > spaceThreshold && !result.endsWith(' ') && !curr.str.startsWith(' ');
            if (isDropCap || isSuperSub) {
                needSpace = false;
            }

            // ignore overlaps
            result += (needSpace ? ' ' : '') + curr.str;
        }
        return result.replace(/\s+/g, ' ').trim();
    }

    // headings
    function classifyHeadings(allLines) {
        // Sizes are weighted by text length so a dense table of small type (many
        // short "lines") can't drag the body-text median toward its font size.
        const weighted = allLines
            .filter(l => l.text && l.fontSize > 0)
            .map(l => ({ fs: l.fontSize, w: l.text.replace(/\s+/g, '').length }))
            .filter(e => e.w > 0);
        if (!weighted.length) return {};

        weighted.sort((a, b) => a.fs - b.fs);
        const total = weighted.reduce((s, e) => s + e.w, 0);
        const pick = (q) => {
            let acc = 0;
            for (const e of weighted) { acc += e.w; if (acc >= total * q) return e.fs; }
            return weighted[weighted.length - 1].fs;
        };

        // 0=body, 1=h3, 2=h2, 3=h1
        return { median: pick(0.5), p85: pick(0.85), p95: pick(0.95) };
    }

    function headingLevel(fontSize, thresholds, isBold) {
        if (!thresholds || !fontSize) return 0;
        const { median, p85, p95 } = thresholds;
        
        // Must be noticeably larger than body text to be a heading
        if (fontSize <= median * 1.05 && !isBold) return 0;
        
        // If it's bold and slightly larger, it's a heading.
        // If it's bold and SAME size, it's just bold body text, not a heading.
        if (fontSize <= median * 1.02 && isBold) return 0; 

        if (p95 > median * 1.1 && fontSize >= p95 * 0.97) return isBold ? 3 : (p95 > p85 * 1.1 ? 2 : 3);
        if (p85 > median * 1.1 && fontSize >= p85 * 0.97) return isBold ? 2 : 1;
        if (fontSize > median * 1.15 || (isBold && fontSize > median * 1.05)) return 1;
        
        return 0;
    }

    // dedup
    function buildFingerprintSet(allPageLines, totalPages) {
        if (totalPages < 3) return new Set();
        const freq = {};
        for (const line of allPageLines) {
            const fp = line.trim();
            if (fp.length < 3 || fp.length > 120) continue;
            freq[fp] = (freq[fp] || 0) + 1;
        }
        const threshold = Math.max(2, Math.floor(totalPages * 0.5));
        const repeating = new Set();
        for (const [fp, count] of Object.entries(freq)) {
            if (count >= threshold) repeating.add(fp);
        }
        return repeating;
    }

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
        const IMG_OPS = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject]);

        for (let i = 0; i < ops.fnArray.length; i++) {
            if (ops.fnArray[i] === OPS.constructPath || ops.fnArray[i] === OPS.rectangle) vectorOpCount++;
            if (IMG_OPS.has(ops.fnArray[i])) ;
        }
        if (vectorOpCount < 80) return '';

        // Path coordinates arrive in the CURRENT TRANSFORM's space (figures
        // are usually wrapped in Form XObjects with their own matrix), so a
        // transform stack must be replayed to place boxes on the page. pdf.js
        // constructPath minMax order is [minX, maxX, minY, maxY].
        const boxes = [];
        const mstack = [];
        let ctm = [1, 0, 0, 1, 0, 0];
        const mmul = (m1, m2) => [
            m1[0] * m2[0] + m1[2] * m2[1],
            m1[1] * m2[0] + m1[3] * m2[1],
            m1[0] * m2[2] + m1[2] * m2[3],
            m1[1] * m2[2] + m1[3] * m2[3],
            m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
            m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
        ];
        const mapply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
        const pushBox = (x0, y0, x1, y1) => {
            if (![x0, y0, x1, y1].every(isFinite)) return;
            const pts = [mapply(ctm, x0, y0), mapply(ctm, x1, y0), mapply(ctm, x0, y1), mapply(ctm, x1, y1)];
            const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0]));
            const minY = Math.min(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[1]));
            const w = maxX - minX, h = maxY - minY;
            if (!isFinite(w) || !isFinite(h)) return;
            // Charts are made of thin lines (h≈0) and small markers — keep
            // them; clustering (count >= 3) filters out stray underlines.
            if (w > 8 || h > 8 || (w > 2 && h > 2)) {
                boxes.push({ x: minX, y: minY, w: Math.max(w, 1), h: Math.max(h, 1) });
            }
        };
        for (let i = 0; i < ops.fnArray.length; i++) {
            const fn = ops.fnArray[i], args = ops.argsArray[i];
            if (fn === OPS.save) mstack.push(ctm.slice());
            else if (fn === OPS.restore) { if (mstack.length) ctm = mstack.pop(); }
            else if (fn === OPS.transform) { if (args && args.length >= 6) ctm = mmul(ctm, args); }
            else if (fn === OPS.constructPath) {
                if (args && args.length >= 3 && args[2] && args[2].length >= 4) {
                    const mm = args[2];
                    pushBox(mm[0], mm[2], mm[1], mm[3]);
                }
            } else if (fn === OPS.rectangle) {
                if (args && args.length >= 4) pushBox(args[0], args[1], args[0] + args[2], args[1] + args[3]);
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
            // Grow the crop to cover text that belongs to the figure (axis
            // labels, legends, annotations) so it isn't sliced off, and consume
            // that text from the prose flow — it lives in the image instead.
            // Captions ("Figure 3: …") always stay in the text flow.
            let fx0 = f.x, fy0 = f.y, fx1 = f.x + f.w, fy1 = f.y + f.h;
            const consumedLgs = [];
            const nearPad = 26;
            for (const lg of ctx.lineGroups) {
                const lgItems = lg.items.filter(it => !it.garbage && (it.str || '').trim());
                if (!lgItems.length) continue;
                let lx0 = Infinity, ly0 = Infinity, lx1 = -Infinity, ly1 = -Infinity;
                for (const it of lgItems) {
                    lx0 = Math.min(lx0, it.x); lx1 = Math.max(lx1, it.x + (it.width || 0));
                    ly0 = Math.min(ly0, it.y); ly1 = Math.max(ly1, it.y + (it.height || 10));
                }
                const cx = (lx0 + lx1) / 2, cy = (ly0 + ly1) / 2;
                if (cx < f.x - nearPad || cx > f.x + f.w + nearPad ||
                    cy < f.y - nearPad || cy > f.y + f.h + nearPad) continue;
                const lgText = (lg.text || lg.rawText || '').trim();
                if (/^(figure|fig\.|table|chart)\s*\d*\s*[:.]/i.test(lgText)) continue;
                const fullyInside = lx0 >= f.x - 6 && lx1 <= f.x + f.w + 6 &&
                    ly0 >= f.y - 6 && ly1 <= f.y + f.h + 6;
                if (!fullyInside && lgText.length > 45) continue; // body text brushing the edge
                fx0 = Math.min(fx0, lx0); fy0 = Math.min(fy0, ly0);
                fx1 = Math.max(fx1, lx1); fy1 = Math.max(fy1, ly1);
                consumedLgs.push(lg);
            }
            const cw = fx1 - fx0, ch = fy1 - fy0;
            const cropPad = Math.max(8, Math.min(pageW, pageH) * 0.012);
            const sx = Math.max(0, fx0 * SCALE - cropPad * SCALE);
            const sw = Math.min(canvas.width - sx, cw * SCALE + 2 * cropPad * SCALE);
            const sy = Math.max(0, (pageH - fy1) * SCALE - cropPad * SCALE);
            const sh = Math.min(canvas.height - sy, ch * SCALE + 2 * cropPad * SCALE);
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
            extractedImages.push({ name, dataUrl, dims: `${Math.round(sw)}×${Math.round(sh)}`, page: pageNum,
                bbox: { x: Math.round(fx0), y: Math.round(fy0), w: Math.round(cw), h: Math.round(ch) } });

            for (const lg of consumedLgs) {
                for (const it of lg.items) { it.garbage = true; it.str = ''; }
            }

            const figureMd = `\n\n![Figure ${figIdx}](${name})\n\n`;

            // Anchor the figure just above the first text line BELOW it — for
            // captioned figures that's the caption, so the image renders
            // directly above its caption instead of mid-paragraph.
            const below = ctx.lineGroups.filter(lg =>
                lg.y < fy0 && !lg.garbage && (lg.text || '').trim() &&
                lg.items.some(it => !it.garbage));
            const anchorLg = below.length ? below.reduce((a, b) => (b.y > a.y ? b : a)) : null;

            if (anchorLg && (fy0 - anchorLg.y) < 150) anchorLg.injectedMarkdown = (anchorLg.injectedMarkdown || '') + figureMd;
            else md += figureMd;

            figIdx++;
        }
        canvas.width = 0; canvas.height = 0;
        return md;
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
            const numCols = finalCols.length;
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
                        rowData[bestCol] += (rowData[bestCol] ? ' ' : '') + cell.str;
                        for (let span = bestCol + 1; span <= endCol; span++) {
                            rowData[span] = ''; 
                        }
                    } else {
                        rowData[bestCol] += (rowData[bestCol] ? ' ' : '') + cell.str;
                    }
                }
                grid.push({ rowData, line });
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

            // Prose gate: real table cells are short labels/values. Long,
            // sentence-fragment cells mean this "grid" is columns of body text.
            const cellTexts = [];
            grid.forEach(r => r.rowData.forEach(c => { if (c.trim()) cellTexts.push(c.trim()); }));
            const avgCellLen = cellTexts.reduce((s, c) => s + c.length, 0) / Math.max(1, cellTexts.length);
            if (avgCellLen > 45) {
                logToTerminal(`Table detection: Skipped block, cells read like prose (avg ${Math.round(avgCellLen)} chars)`, 'info');
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

            if (ctx.pageLayout) ctx.pageLayout.tables.push({ rows: grid.map(r => r.rowData.map(esc)) });

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

    const __litedocAddons = {
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

    // geometry.js – geometry utilities for LiteDoc PDF parser

    /**
     * Topological sort using Kahn's algorithm with spatial heuristics.
     * Used to determine the correct reading order of blocks based on their 
     * spatial coordinates (x, y) and bounding boxes.
     */
    function topologicalSort(blocks) {
      const n = blocks.length;
      if (n === 0) return [];
      const inDegree = new Array(n).fill(0);
      const adj = Array.from({ length: n }, () => []);

      // Build the graph using vertical and horizontal rules
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const a = blocks[i];
          const b = blocks[j];

          const axMin = a.xMin ?? (a.bbox && a.bbox.xMin) ?? 0;
          const axMax = a.xMax ?? (a.bbox && a.bbox.xMax) ?? 0;
          const ayMin = a.yMin ?? (a.bbox && a.bbox.yMin) ?? 0;
          const ayMax = a.yMax ?? (a.bbox && a.bbox.yMax) ?? 0;

          const bxMin = b.xMin ?? (b.bbox && b.bbox.xMin) ?? 0;
          const bxMax = b.xMax ?? (b.bbox && b.bbox.xMax) ?? 0;
          const byMin = b.yMin ?? (b.bbox && b.bbox.yMin) ?? 0;
          const byMax = b.yMax ?? (b.bbox && b.bbox.yMax) ?? 0;

          // Vertical ordering constraint:
          // a is above b, and they overlap horizontally
          const vertOverlapAmt = Math.max(0, Math.min(axMax, bxMax) - Math.max(axMin, bxMin));
          const minW = Math.min(axMax - axMin, bxMax - bxMin);
          const vertOverlap = vertOverlapAmt > Math.min(10, minW * 0.1);
          const isAbove = ayMin >= byMax - 10; // tolerance of 10px
          
          // Horizontal ordering constraint:
          // a is to the left of b, and they overlap vertically
          const isLeft = axMax <= bxMin + 20;
          const vertOverlapY = Math.max(ayMin, byMin) < Math.min(ayMax, byMax) + 20;

          if ((isAbove && vertOverlap) || (isLeft && vertOverlapY)) {
            adj[i].push(j);
            inDegree[j]++;
          }
        }
      }

      const queue = [];
      for (let i = 0; i < n; i++) {
        if (inDegree[i] === 0) {
          queue.push(i);
        }
      }

      let result = [];
      while (queue.length > 0) {
        // Custom heuristic: sort queue to prioritize leftmost (xMin) for distinct columns,
        // then topmost (yMax) for blocks within the same column.
        queue.sort((idxA, idxB) => {
          const a = blocks[idxA];
          const b = blocks[idxB];
          
          const axMin = a.xMin ?? (a.bbox && a.bbox.xMin) ?? 0;
          const axMax = a.xMax ?? (a.bbox && a.bbox.xMax) ?? 0;
          const ayMax = a.yMax ?? (a.bbox && a.bbox.yMax) ?? 0;

          const bxMin = b.xMin ?? (b.bbox && b.bbox.xMin) ?? 0;
          const bxMax = b.xMax ?? (b.bbox && b.bbox.xMax) ?? 0;
          const byMax = b.yMax ?? (b.bbox && b.bbox.yMax) ?? 0;

          const horizOverlapAmt = Math.max(0, Math.min(axMax, bxMax) - Math.max(axMin, bxMin));
          const minWidth = Math.min(axMax - axMin, bxMax - bxMin);
          const horizOverlap = horizOverlapAmt > Math.min(15, minWidth * 0.15);
          
          if (!horizOverlap) {
            return axMin - bxMin; // distinct columns: leftmost first
          }

          const yDiff = byMax - ayMax;
          if (Math.abs(yDiff) < 15) {
            return axMin - bxMin; // leftmost first if on same logical row
          }
          return yDiff; // topmost first
        });

        const u = queue.shift();
        result.push(blocks[u]);

        for (const v of adj[u]) {
          inDegree[v]--;
          if (inDegree[v] === 0) {
            queue.push(v);
          }
        }
      }

      if (result.length < n) {
        const seen = new Set(result);
        for (const b of blocks) {
          if (!seen.has(b)) {
            result.push(b);
          }
        }
      }

      return result;
    }

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

    let activeConfig$1 = { ...DEFAULT_CONFIG };

    /**
     * Update the active tuning parameters.
     */
    function updateTuningConfig(newConfig) {
        activeConfig$1 = { ...DEFAULT_CONFIG, ...newConfig };
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
                if (item.y < pageH * activeConfig$1.topMarginThreshold || item.y > pageH * activeConfig$1.bottomMarginThreshold) return false;
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
            const minGutterWidth = Math.max(activeConfig$1.horizontalGapMin, 1.2 * UX);
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
                    g.score = g.width - (distanceFromCenterPercent * 10 * UX * activeConfig$1.distanceFromCenterPenalty);
                    
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
                const tol = Math.max(0.3 * UY, (item.height || 10) * (activeConfig$1.rowSplitMultiplier / 6.6));
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

    const executePdfConversion = async function (files) {
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

        const checkSkip = () => { if (state.isSkippingFile) throw new Error('SKIP_FILE'); };

        fileLoop: for (let fIndex = 0; fIndex < files.length; fIndex++) {
            if (state.isSkippingFile) {
                state.isSkippingFile = false; // Reset for next file in batch
            }
            const file = files[fIndex];
            const baseProgress = (fIndex / files.length) * 100;
            100 / files.length;

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
                    
                    const ocrLang = (__litedocAddons && __litedocAddons._settings.ocrLang) || 'eng';
                    const ocrResult = await __litedocAddons.ocrCanvas(canv, file.name, { ocrLang, ocrEnabled: true });
                    
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
                if (!navigator.webdriver && __litedocAddons && typeof __litedocAddons.loadPdfWithPassword === 'function') {
                    pdf = await __litedocAddons.loadPdfWithPassword(arrayBuffer, file.name, file.password);
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

                // OCR language: pass 'auto' straight through to the OCR queue.
                // It resolves the script PER PAGE (whole page → 2x → bands) and
                // has a post-OCR rescue: if the eng model returns a cluster of
                // low-confidence garbage words, that crop is script-detected and
                // the page re-OCR'd with the right "<script>+eng" combo. A
                // doc-level pre-route can't do any of that (one Japanese line on
                // an English page is invisible to whole-page script detection).
                const docOcrLang = (__litedocAddons && __litedocAddons._settings.ocrLang) || 'eng';

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
                const repeatingFPs = buildFingerprintSet(allRawLineTexts, pdfDoc.numPages);

                let mdText = `\x3C!-- Converted from ${file.name} — ${pdfDoc.numPages} pages --\x3E\n\n`;
                const extractedImages = [];
                // Structured layout (per page: lines, tables, figures) — the same
                // data the markdown is generated FROM, exposed for --json consumers
                // instead of being thrown away at serialization.
                const docLayout = [];
                // Source map: each block maps to { page, md_range: [start,end],
                // bbox: {x0,y0,x1,y1}, type, confidence } so every Markdown
                // fragment points back to its origin. Written as a sidecar by
                // --source-map; always included in --json.
                const sourceMap = [];
                // Low-confidence pages: pages where garbage ratio is high or
                // all content came from OCR — useful for RAG auditability.
                const lowConfidencePages = [];
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
                        const cf = detectCorruptedFonts(stc.items);
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

                        try {
                        const page = await pdfDoc.getPage(pageNum);
                        const textContent = await page.getTextContent({ includeMarkedContent: false });
                        const [_vx0, _vy0, _vx1, _vy1] = page.view;
                        const pageW = _vx1 - _vx0;
                        const pageH = _vy1 - _vy0;

                        const corruptedFonts = detectCorruptedFonts(textContent.items);
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
                                const score = itemGibberishScore(item.str, fontName, effectiveCorruptedFonts);
                                const isMarginNoise = f > pageH * 0.96 || f < pageH * 0.04 || e < pageW * 0.04 || e > pageW * 0.96;
                                return {
                                    str: item.str, x: e, y: f, width, height: item.height || Math.abs(a) || 12,
                                    fontSize, isBold, fontName,
                                    garbage: score > activeConfig$1.garbageScoreThreshold || isMarginNoise,
                                    gScore: score,
                                };
                            });

                        const items = [];
                        for (const item of rawItems) {
                            const isDup = items.some(existing => {
                                const posMatch = Math.abs(existing.x - item.x) < activeConfig$1.itemOverlapTolerance && Math.abs(existing.y - item.y) < activeConfig$1.itemOverlapTolerance;
                                return posMatch && existing.str.trim() === item.str.trim();
                            });
                            if (!isDup) items.push(item);
                        }

                        if (!items.length) {
                            if (__litedocAddons.ocrEnabled()) {
                                logToTerminal(`[OCR] Page ${pageNum} seems to be a scan. Starting OCR...`, 'info');
                                const vp = page.getViewport({ scale: 2.0 });
                                const canv = document.createElement('canvas');
                                canv.width = vp.width; canv.height = vp.height;
                                const ctx = canv.getContext('2d');
                                ctx.fillStyle = '#ffffff';
                                ctx.fillRect(0, 0, canv.width, canv.height);
                                await page.render({ canvasContext: ctx, viewport: vp }).promise;
                                const ocrResult = await __litedocAddons.ocrCanvas(canv, file.name, { ocrLang: docOcrLang, ocrEnabled: true });
                                
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
                                const ocrTolMultiplier = item.isOcr ? (activeConfig$1.ocrTolMultiplier ?? 4.0) : 1.0;
                                const tol = Math.max(3, (item.height || 10) * (activeConfig$1.rowSplitMultiplier / 6.6)) * ocrTolMultiplier;
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
                                const isMargin = lg.y > pageH * activeConfig$1.bottomMarginThreshold || lg.y < pageH * activeConfig$1.topMarginThreshold;
                                if ((repeatingFPs.has(rawNoSpace) && isMargin) || (/^\d+$/.test(rawNoSpace) && isMargin)) {
                                    lg.garbage = true; lg.items.forEach(it => it.garbage = true);
                                }
                                lg.text = joinLineItems(lg.items.filter(it => !it.garbage), activeConfig$1);
                                lg.rawText = joinLineItems(lg.items, activeConfig$1);
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
                                l.text = joinLineItems(l.items, activeConfig$1);
                            });
                            allLineGroups.push(...parsedLines);
                        }

                        const activeLines = allLineGroups.filter(l => !l.isTable && (l.rawText || '').trim().length > 0);
                        const totalLines = activeLines.length;
                        const garbageLines = activeLines.filter(l => l.garbage).length;
                        if (totalLines > 0 && (garbageLines / totalLines) > activeConfig$1.pageGarbageRatioThreshold) {
                            page.cleanup(); continue;
                        }

                        const medH = allLineGroups.map(l => l.height).sort((a,b) => a-b)[Math.floor(allLineGroups.length/2)] || 12;
                        const hThresh = classifyHeadings(allLineGroups);

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

                        // Enhanced layout pass: vector-grid tables, figure extraction,
                        // math regions, citations. Consumes matched items (garbage-marks
                        // them) and attaches injectedMarkdown to their line groups, which
                        // linesToMd renders in place; leftovers come back as `enhancedMd`.
                        // Feed table detection per text block, never the whole page:
                        // on multi-column pages the page-wide grid pass pairs cells
                        // across prose columns and "detects" the layout as a table.
                        const blockGroupMap = {};
                        for (const lg of allLineGroups) {
                            const k = lg.blockIdx !== undefined ? lg.blockIdx : -1;
                            if (!blockGroupMap[k]) blockGroupMap[k] = [];
                            blockGroupMap[k].push(lg);
                        }
                        const blockGroups = Object.keys(blockGroupMap)
                            .map(k => parseInt(k)).sort((a, b) => a - b)
                            .map(k => blockGroupMap[k]);

                        const enhancedMd = await enhancePage({
                            page, pdfjsLib, pageNum, pageW, pageH,
                            fileName: file.name.replace(/\.pdf$/i, ''),
                            extractedImages,
                            lineGroups: allLineGroups,
                            columns: blockGroups.length > 1 ? blockGroups : null,
                            pageLayout,
                            logToTerminal,
                        });

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
                                
                                if (totalCells > 0 && (filledCells / totalCells) < activeConfig$1.tableDensityThreshold) {
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
                                // Content injected by the enhancement pass (grid tables,
                                // figures, math) anchored to this line — emit it in place.
                                if (lg.injectedMarkdown && lg.injectedMarkdown.trim()) {
                                    flushPara(); flushTable();
                                    mdArr.push(lg.injectedMarkdown.trim());
                                    lg.injectedMarkdown = '';
                                }
                                const sortedItems = [...lg.items.filter(it => !it.garbage)].sort((a, b) => a.x - b.x);
                                if (sortedItems.length === 0) continue;

                                let cols = [], curCol = [], hasHugeGap = false;
                                for (let i = 0; i < sortedItems.length; i++) {
                                    const curr = sortedItems[i];
                                    if (i > 0) {
                                        const prev = sortedItems[i - 1];
                                        const gap = curr.x - (prev.x + (prev.width || 0));
                                        if (gap > Math.max(activeConfig$1.horizontalGapMin, (curr.height || 10) * activeConfig$1.horizontalGapMultiplier)) {
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
                                    if (prevY !== null && (prevY - lg.y) > medH * activeConfig$1.tableGapYThreshold) flushTable();
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
                                    rowCells = cols.map(c => joinLineItems(c, activeConfig$1));
                                    belongsToTable = true;
                                }

                                if (belongsToTable) {
                                    flushPara(); tableBuffer.push(rowCells);
                                } else {
                                    flushTable();
                                    let txt = lg.text.trim();
                                    if (!txt) continue;
                                    let level = headingLevel(lg.fontSize, hThresh, lg.isBold);
                                    if (level > 0) { flushPara(); mdArr.push('#'.repeat(4-level) + ' ' + txt); }
                                    else {
                                        const gap = prevY !== null ? (prevY - lg.y) : 0;
                                        if (gap > medH * activeConfig$1.paragraphGapThreshold) flushPara();
                                        if (prevLine && Math.abs(lg.fontSize - prevLine.fontSize) < 0.6 && gap < medH * activeConfig$1.continuationGapThreshold) paragraphBuf += (paragraphBuf.endsWith('-') ? '' : ' ') + txt;
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

                        // ── Source-map: capture md output length before each block ──
                        // so we know exact character offsets without calling linesToMd twice.
                        const blockMdLens = []; // [linesBefore, linesAfter] for each block
                        for (const k of blockKeys) {
                            const before = pageMdLines.length;
                            pageMdLines.push(...linesToMd(bodyBlocks[k]));
                            blockMdLens.push([before, pageMdLines.length]);
                        }

                        let pageMd = pageMdLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
                        if (enhancedMd && enhancedMd.trim()) {
                            pageMd = (pageMd + '\n\n' + enhancedMd.trim()).trim().replace(/\n{3,}/g, '\n\n');
                        }

                        // Build source map entries from the captured line ranges
                        for (let bi = 0; bi < blockKeys.length; bi++) {
                            const k = blockKeys[bi];
                            const blockLines = bodyBlocks[k];
                            const [lineStart, lineEnd] = blockMdLens[bi];
                            if (lineEnd <= lineStart) continue; // empty block

                            const blockLinesArr = pageMdLines.slice(lineStart, lineEnd);
                            const blockStr = blockLinesArr.join('\n').trim();
                            if (!blockStr) continue;

                            // Find block text position within pageMd
                            const blockStart = pageMd.indexOf(blockStr);
                            const blockLen = blockStr.length;
                            if (blockStart === -1) continue;

                            // Aggregate bbox from line group items
                            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                            let anyOcr = false;
                            let anyTable = false;
                            for (const lg of blockLines) {
                                for (const it of (lg.items || [])) {
                                    if (it.x < minX) minX = it.x;
                                    if (it.y < minY) minY = it.y;
                                    if ((it.x + (it.width || 0)) > maxX) maxX = it.x + (it.width || 0);
                                    if ((it.y + (it.height || 0)) > maxY) maxY = it.y + (it.height || 0);
                                    if (it.isOcr) anyOcr = true;
                                }
                                if (lg.isTable) anyTable = true;
                            }

                            // Determine type
                            let type = 'paragraph';
                            if (blockLines.length > 0) {
                                const firstLine = blockLines[0];
                                if (firstLine.items && firstLine.items.some(it => it.isBold)) {
                                    type = 'heading';
                                }
                            }
                            if (anyTable) type = 'table';

                            const pageOffset = mdText.length;
                            sourceMap.push({
                                page: pageNum,
                                md_range: [pageOffset + blockStart, pageOffset + blockStart + blockLen],
                                bbox: { x0: minX === Infinity ? null : Math.round(minX), y0: minY === Infinity ? null : Math.round(minY), x1: maxX === -Infinity ? null : Math.round(maxX), y1: maxY === -Infinity ? null : Math.round(maxY) },
                                type,
                                confidence: anyOcr ? 'low' : 'high',
                            });
                        }
                        
                        const showPageNums = typeof window !== 'undefined' && window.state ? !window.state.excludePageNumbers : true;
                        if (showPageNums) {
                            mdText += (pageNum > 1 ? '\n\n---\n\n' : '') + `## Page ${pageNum}\n\n` + pageMd;
                        } else {
                            mdText += (pageNum > 1 ? '\n\n' : '') + pageMd;
                        }

                        // ── Low-confidence detection: garbage ratio + all-OCR ──
                        const lcTotalLines = activeLines.length;
                        const garbageRatio = lcTotalLines > 0 ? garbageLines / lcTotalLines : 0;
                        const allOcr = lcTotalLines > 0 && activeLines.every(l => l.items && l.items.some(it => it.isOcr));
                        if (garbageRatio > activeConfig$1.pageGarbageRatioThreshold || allOcr) {
                            const reasons = [];
                            if (garbageRatio > activeConfig$1.pageGarbageRatioThreshold) reasons.push(`high garbage ratio: ${(garbageRatio * 100).toFixed(1)}%`);
                            if (allOcr) reasons.push('all content from OCR');
                            lowConfidencePages.push({ page: pageNum, confidence: allOcr ? 'low' : 'medium', reasons });
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
                state.processedData.push({ filename: file.name, status: 'success', mdText, extractedImages, inlineRenders: pageInlineRenders, numPages: pdfDoc.numPages, layout: docLayout, sourceMap, lowConfidencePages });
            } catch (err) { logToTerminal(`Failed: ${file.name}`, 'error'); }
        }
        updateProgress(100, 'Complete', '');

        if (typeof window !== 'undefined' && window.finishProcessing) {
            window.finishProcessing();
        }
    };

    if (typeof window !== 'undefined') {
        window.executePdfConversion = executePdfConversion;
    }

    class LiteDoc {
        constructor(config = {}) {
            this.config = config;
        }

        async parse(pdfSource) {
            return await executePdfConversion([pdfSource], this.config);
        }
    }

    if (typeof window !== 'undefined') {
        window.LiteDoc = LiteDoc;
        window.executePdfConversion = executePdfConversion;
    }

    return LiteDoc;

})();
