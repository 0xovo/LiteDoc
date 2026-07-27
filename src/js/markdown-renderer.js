
function containsArabic(text) {
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

// global renderer state to prevent redundant renders
window._lastRenderedMd = "";
window._mdRenderTimer = null;

function renderMarkdown(mdText, targetEl) {
    const targetId = targetEl ? (targetEl.id || 'custom-target') : 'viewer-md-rendered';
    const cacheKey = mdText + '|' + targetId;
    if (window._lastRenderedMd === cacheKey) return;
    window._lastRenderedMd = cacheKey;

    const container = targetEl || document.getElementById('viewer-md-rendered');
    if (!mdText) { container.innerHTML = ''; return; }

    // throttle re-renders
    clearTimeout(window._mdRenderTimer);
    window._mdRenderTimer = setTimeout(() => {
        const data = state.processedData[state.activeDataIndex];
        const inlineRenders = (data && data.inlineRenders) ? data.inlineRenders : {};

        // Disconnect previous observer to prevent ghost triggers
        if (window._mdObserver) {
            window._mdObserver.disconnect();
            window._mdObserver = null;
        }

        container.innerHTML = '';

        // Split markdown logically by pages
        const pages = mdText.split(/(?=^## Page \d+)/m).filter(p => p.trim());
        if (pages.length === 0) pages.push(mdText);

        const isMobile = /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 768;
        const CHUNK_SIZE = isMobile ? 2 : 8;
        let currentIndex = 0;

        const sentinel = document.createElement('div');
        sentinel.className = 'md-render-sentinel';
        sentinel.style.height = '1px';

        window._mdObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) renderNextChunk();
        }, { root: container, rootMargin: '600px' });

        const renderNextChunk = () => {
            const chunk = pages.slice(currentIndex, currentIndex + CHUNK_SIZE).join('\n');
            if (!chunk) return;

            const chunkDiv = document.createElement('div');

            const doRender = () => {
                try {
                    chunkDiv.innerHTML = _buildHtml(chunk, inlineRenders);

                    // Only render math if characters exist to save CPU
                    const hasMath = chunk.includes('$') || chunk.includes('\\');
                    if (hasMath && state.mathEnabled && window.renderMathInElement) {
                        renderMathInElement(chunkDiv, {
                            delimiters: [
                                { left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true },
                                { left: '$', right: '$', display: false }, { left: '\\(', right: '\\)', display: false }
                            ],
                            throwOnError: false, errorColor: '#f87171'
                        });
                    }
                } catch (err) {
                    console.error("Markdown Render Error:", err);
                    chunkDiv.innerHTML = `<div style="color:var(--danger); padding:16px; border:1px solid var(--danger); border-radius:8px; margin:16px 0;"><strong>Render Error:</strong> ${err.message}<br><br><pre style="white-space:pre-wrap;font-size:11px;overflow-x:auto;">${_esc(chunk)}</pre></div>`;
                }

                if (sentinel.parentNode === container) container.insertBefore(chunkDiv, sentinel);
                else container.appendChild(chunkDiv);

                currentIndex += CHUNK_SIZE;
                if (currentIndex < pages.length) container.appendChild(sentinel);
                else window._mdObserver.disconnect();
            };

            // push to next frame for smoother UI
            requestAnimationFrame(doRender);
        };

        renderNextChunk();
        if (currentIndex < pages.length) window._mdObserver.observe(sentinel);
    }, 50);
}

function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const RX_MATH_TOKENS = /\$\$([\s\S]+?)\$\$|\$(?!\s)([^$\n]+?)(?<!\s)\$|\\\((.+?)\\\)/g;
const RX_BOLD = /\*\*(.+?)\*\*/g;
const RX_ITALIC = /\*(.+?)\*/g;
const RX_STRIKE = /~~(.+?)~~/g;
const RX_CODE = /`([^`]+)`/g;
const RX_IMAGE_TAG = /\[IMAGE: ([^\]]+)\]/g;
const RX_MD_IMAGE = /!\[(.*?)\]\((.+?)\)/g;
const RX_MD_LINK = /(^|[^!])\[(.*?)\]\((.*?)\)/g;
const RX_ARABIC = /([\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+[^<]*)/g;
const RX_INLINE_RENDER = /^\[INLINE_RENDER:\s*(\S+)\]$/;
const RX_TASK_EMPTY = /^\[ \]\s+/;
const RX_TASK_DONE = /^\[x\]\s+/i;

function _buildHtml(mdText, inlineRenders = {}) {
    mdText = (mdText || '').replace(/\x3C!--[\s\S]*?--\x3E/g, '');
    const lines = mdText.split(/\r?\n/);
    let out = '';
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === '') { out += '<div style="height:0.8em"></div>'; i++; continue; }

        // inline render fallback
        const irMatch = line.match(RX_INLINE_RENDER);
        if (irMatch) {
            const token = irMatch[1];
            const dataUrl = inlineRenders[token];
            if (dataUrl) {
                out += `<div style="margin:8px 0;border-radius:6px;overflow:hidden;border:1px solid var(--border)"><img src="${dataUrl}" loading="lazy" style="width:100%;display:block;height:auto" alt="Rendered region"></div>`;
            }
            i++; continue;
        }

        // math blocks
        if (trimmed.startsWith('$$')) {
            const afterOpen = line.replace(/^\s*\$\$/, '');
            // single-line
            if (/\$\$/.test(afterOpen)) {
                const inner = afterOpen.replace(/\$\$.*$/, '').trim();
                out += `<div class="math-block" style="padding:12px;margin:12px 0;background:rgba(120,120,120,0.03);border-radius:8px;border:1px solid var(--border);overflow-x:auto;color:var(--text-1)">$$${_esc(inner)}$$</div>`;
                i++; continue;
            }
            // multi-line
            const mathLines = afterOpen ? [afterOpen] : [];
            i++;
            while (i < lines.length) {
                const l = lines[i];
                if (/\$\$/.test(l)) {
                    const before = l.replace(/\$\$.*$/, '').trim();
                    if (before) mathLines.push(before);
                    i++; break;
                }
                mathLines.push(l);
                i++;
            }
            out += `<div class="math-block" style="padding:12px;margin:12px 0;background:rgba(120,120,120,0.03);border-radius:8px;border:1px solid var(--border);overflow-x:auto;color:var(--text-1)">$$${_esc(mathLines.join('\n'))}$$</div>`;
            continue;
        }

        // \[ math
        if (trimmed.startsWith('\\[')) {
            const afterOpen = line.replace(/^\s*\\\[/, '');
            const mathLines = afterOpen.trim() ? [afterOpen] : [];
            i++;
            while (i < lines.length) {
                const l = lines[i];
                if (/\\\]/.test(l)) {
                    const before = l.replace(/\\\].*$/, '').trim();
                    if (before) mathLines.push(before);
                    i++; break;
                }
                mathLines.push(l); i++;
            }
            out += `<div class="math-block" style="padding:12px;margin:12px 0;background:rgba(120,120,120,0.03);border-radius:8px;border:1px solid var(--border);overflow-x:auto;color:var(--text-1)">\\[${_esc(mathLines.join('\n'))}\\]</div>`;
            continue;
        }

        // code blocks
        if (trimmed.startsWith('```')) {
            const lang = line.trim().slice(3).trim();
            out += `<div style="margin:16px 0;border-radius:8px;overflow:hidden;border:1px solid var(--border);box-shadow:0 2px 8px rgba(0,0,0,0.05)"><div style="background:rgba(120,120,120,0.08);padding:6px 12px;font-size:0.75em;color:var(--text-3);border-bottom:1px solid var(--border);text-transform:uppercase;letter-spacing:0.05em;font-weight:600">${lang || 'Code'}</div><pre style="background:var(--bg-input);padding:12px;margin:0;overflow-x:auto;font-family:'JetBrains Mono',monospace;font-size:0.85em;color:var(--text-1);line-height:1.5"><code>`;
            i++;
            while (i < lines.length && !/^```/.test(lines[i].trim())) {
                out += _esc(lines[i]) + '\n';
                i++;
            }
            out += `</code></pre></div>`;
            i++; continue;
        }

        // blockquotes
        if (trimmed.startsWith('> ')) {
            out += `<blockquote style="border-left:4px solid var(--accent);padding:8px 16px;margin:16px 0;color:var(--text-2);background:rgba(120,120,120,0.05);border-radius:0 8px 8px 0;font-style:italic;line-height:1.6">`;
            while (i < lines.length && /^>\s+/.test(lines[i].trim())) {
                const match = lines[i].trim().match(/^>\s+(.*)$/);
                if (match) out += `${_inline(match[1])}<br>`;
                i++;
            }
            out += `</blockquote>`;
            continue;
        }

        // page divider
        if (line.startsWith('## Page ')) { out += `<div style="display:flex;align-items:center;gap:16px;margin:48px 0 24px;"><hr style="flex:1;border:none;border-top:1px solid var(--border);margin:0;"><span style="background:var(--accent);color:#fff;padding:6px 16px;border-radius:99px;font-size:0.75em;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;box-shadow:0 2px 8px rgba(0,0,0,0.15)">${_inline(line.slice(3))}</span><hr style="flex:1;border:none;border-top:1px solid var(--border);margin:0;"></div>`; i++; continue; }

        // headings
        if (line.startsWith('### ')) { out += `<h3 style="font-size:1.1em;font-weight:600;color:var(--text-1);margin:20px 0 8px;line-height:1.4">${_inline(line.slice(4))}</h3>`; i++; continue; }
        else if (line.startsWith('## ')) { out += `<h2 style="font-size:1.3em;font-weight:700;color:var(--text-1);margin:24px 0 10px;line-height:1.3;border-bottom:1px solid rgba(120,120,120,0.1);padding-bottom:4px">${_inline(line.slice(3))}</h2>`; i++; continue; }
        else if (line.startsWith('# ')) { out += `<h1 style="font-size:1.6em;font-weight:800;color:var(--accent);margin:28px 0 12px;line-height:1.2">${_inline(line.slice(2))}</h1>`; i++; continue; }

        // hr
        if (trimmed.startsWith('---') && /^---+$/.test(trimmed)) { out += '<hr style="border:none;border-top:1px solid var(--border);margin:24px 0">'; i++; continue; }

        // tables
        if (trimmed.startsWith('|')) {
            const tableLines = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                tableLines.push(lines[i].trim());
                i++;
            }

            if (tableLines.length >= 2) {
                out += '<div style="overflow-x:auto;margin:16px 0;border:1px solid var(--border);border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.04);background:var(--bg-card)"><table style="width:100%;border-collapse:collapse;text-align:left;font-size:0.9em;line-height:1.5;">';
                let isHeader = true;
                let headerFound = false;

                for (const tLine of tableLines) {
                    // Check for separator row: |---| or |:---| etc.
                    if (/^\|?[\s\-\|:]+\|?$/.test(tLine.trim())) {
                        isHeader = false;
                        headerFound = true;
                        continue;
                    }

                    let parts = [];
                    let current = '';
                    for (let j = 0; j < tLine.length; j++) {
                        if (tLine[j] === '|' && (j === 0 || tLine[j - 1] !== '\\')) {
                            parts.push(current);
                            current = '';
                        } else {
                            current += tLine[j];
                        }
                    }
                    parts.push(current);

                    // Remove first/last empty parts if they exist (standard |cell| style)
                    if (parts.length > 0 && parts[0].trim() === '') parts.shift();
                    if (parts.length > 0 && parts[parts.length - 1].trim() === '') parts.pop();

                    if (parts.length === 0) continue;

                    out += '<tr style="border-bottom:1px solid var(--border)">';
                    for (const cell of parts) {
                        const tag = isHeader ? 'th' : 'td';
                        const bg = isHeader ? 'background:rgba(120,120,120,0.08);font-weight:600;color:var(--text-1);' : 'color:var(--text-2);';
                        out += `<${tag} style="padding:10px 14px;${bg}">${_inline(cell.trim())}</${tag}>`;
                    }
                    out += '</tr>';

                    // If we haven't found a separator yet, the first non-separator row is the header.
                    // Subsequent rows will be body rows unless a separator is found.
                    if (!headerFound) isHeader = false;
                }
                out += '</table></div>';
                continue;
            } else {
                out += _inline(line) + '<br>';
                i++;
                continue;
            }
        }

        // basic lists
        if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
            out += `<ul style="margin:12px 0 12px 24px;list-style-type:disc;line-height:1.6;color:var(--text-1)">`;
            while (i < lines.length) {
                let currentTrimmed = lines[i].trim();
                if (currentTrimmed === "") {
                    // skip blank lines inside list
                    i++;
                    continue;
                }
                if (!/^[\*\-]\s+/.test(currentTrimmed)) break;
                
                const match = currentTrimmed.match(/^[\*\-]\s+(.+)$/);
                if (match) {
                    let liContent = match[1];
                    let isTask = false;
                    if (RX_TASK_EMPTY.test(liContent)) { liContent = liContent.replace(RX_TASK_EMPTY, '<input type="checkbox" disabled style="margin-right:8px">'); isTask = true; }
                    else if (RX_TASK_DONE.test(liContent)) { liContent = liContent.replace(RX_TASK_DONE, '<input type="checkbox" checked disabled style="margin-right:8px">'); isTask = true; }
                    out += `<li style="margin-bottom:6px;${isTask ? 'list-style-type:none;margin-left:-24px' : ''}">${_inline(liContent)}</li>`;
                }
                i++;
            }
            out += `</ul>`;
            continue;
        }

        // ordered lists
        if (/^\d+\.\s+/.test(trimmed)) {
            // determine starting number
            const startMatch = trimmed.match(/^(\d+)\./);
            const startNum = startMatch ? parseInt(startMatch[1], 10) : 1;
            
            out += `<ol start="${startNum}" style="margin:12px 0 12px 24px;list-style-type:decimal;line-height:1.6;color:var(--text-1)">`;
            while (i < lines.length) {
                let currentTrimmed = lines[i].trim();
                if (currentTrimmed === "") {
                    // skip blank lines inside list
                    i++;
                    continue;
                }
                if (!/^\d+\.\s+/.test(currentTrimmed)) break;
                
                const match = currentTrimmed.match(/^\d+\.\s+(.+)$/);
                if (match) out += `<li style="margin-bottom:6px; display:list-item;">${_inline(match[1])}</li>`;
                i++;
            }
            out += `</ol>`;
            continue;
        }

        // text
        out += `<span style="line-height:1.6;color:var(--text-1);display:inline-block;margin-bottom:4px">${_inline(line)}</span><br>`;
        i++;
    }

    // rtl wrapping - only apply to chunks that actually contain Arabic
    if (containsArabic(out)) {
        out = out.replace(RX_ARABIC, '<span dir="rtl" lang="ar" class="arabic-text">$1</span>');
    }

    return out;
}

// inline formatting
function _inline(text) {
    if (!text) return "";

    // Quick exit for plain text to skip regexes
    const hasFormatting = /[*_`~!\[]/.test(text) || text.includes('$') || text.includes('\\');
    if (!hasFormatting) return _esc(text);

    // tokenize math
    const toks = [];
    RX_MATH_TOKENS.lastIndex = 0;
    let last = 0, m;
    while ((m = RX_MATH_TOKENS.exec(text)) !== null) {
        if (m.index > last) toks.push({ t: 'text', v: text.slice(last, m.index) });
        toks.push({ t: 'math', v: m[0] });
        last = m.index + m[0].length;
    }
    if (last < text.length) toks.push({ t: 'text', v: text.slice(last) });

    return toks.map(tok => {
        if (tok.t === 'math') return _esc(tok.v);
        return _esc(tok.v)
            .replace(RX_BOLD, '<strong style="color:var(--text-1);font-weight:700">$1</strong>')
            .replace(RX_ITALIC, '<em>$1</em>')
            .replace(RX_STRIKE, '<del style="color:var(--text-3)">$1</del>')
            .replace(RX_CODE, `<code style="background:rgba(120,120,120,0.15);padding:2px 6px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:0.85em;color:var(--accent);border:1px solid rgba(120,120,120,0.2)">$1</code>`)
            .replace(RX_IMAGE_TAG, (match, filename) => {
                const appState = typeof state !== 'undefined' ? state : window.state;
                const data = appState?.processedData?.[appState.activeDataIndex];
                const img = data?.extractedImages?.find(img => img.name === filename);
                if (img && img.dataUrl) {
                    return `<div style="margin:16px 0;border-radius:8px;overflow:hidden;border:1px solid var(--border);box-shadow:0 4px 12px rgba(0,0,0,0.08)"><img src="${img.dataUrl}" loading="lazy" style="max-width:100%;display:block;height:auto;margin:0 auto" alt="${filename}"></div>`;
                }
                return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);border-radius:6px;font-size:11px;color:#fbbf24">📷 ${filename}</span>`;
            })
            .replace(RX_MD_IMAGE, (match, alt, filename) => {
                const appState = typeof state !== 'undefined' ? state : window.state;
                const data = appState?.processedData?.[appState.activeDataIndex];
                const img = data?.extractedImages?.find(img => img.name === filename);
                if (img && img.dataUrl) {
                    return `<div style="margin:16px 0;border-radius:8px;overflow:hidden;border:1px solid var(--border);box-shadow:0 4px 12px rgba(0,0,0,0.08)"><img src="${img.dataUrl}" loading="lazy" style="max-width:100%;display:block;height:auto;margin:0 auto" alt="${alt}"></div>`;
                }
                return `<span style="color:var(--warn)">[Image: ${filename}]</span>`;
            })
            .replace(RX_MD_LINK, '$1<a href="$3" target="_blank" style="color:var(--accent);text-decoration:underline;text-underline-offset:2px;font-weight:500">$2</a>');
    }).join('');
}

// view mode removed - consolidated in ui.js

