
        // render single file to explorer
        function renderFileToTree(dataBlock, fIndex) {
            const treeContent = document.getElementById('dynamic-tree-content');
            const fileGroup = document.createElement('div');
            fileGroup.className = 'mb-4 tree-group section-fade-in';
            fileGroup.style.cssText = 'border-left:2px solid var(--border-hi);padding-left:8px';

            const isFailed = dataBlock.status === 'failed';
            const mdFilename = dataBlock.filename.replace('.pdf', '') + (isFailed ? '' : '.md');
            const folderName = `_pdf_images_${dataBlock.filename}`;
            const lowConfPages = dataBlock.lowConfidencePages || [];
            const hasLowConf = lowConfPages.length > 0;

            // md node
            const mdNode = document.createElement('div');
            mdNode.id = `file-node-md-${fIndex}`;
            mdNode.className = 'file-node';
            mdNode.setAttribute('tabindex', '0');
            mdNode.setAttribute('onclick', `selectVirtualFile(${fIndex}, 'md')`);

            const iconColor = isFailed ? 'var(--danger)' : 'var(--accent)';
            const errorBadge = isFailed ? '<span class="error-badge">Error</span>' : '';
            const confBadge = hasLowConf
                ? `<span class="low-conf-badge" onclick="event.stopPropagation(); toggleLowConfPages(${fIndex})" title="Click to navigate to low-confidence pages">
                     ⚠ ${lowConfPages.length} low-confidence page${lowConfPages.length > 1 ? 's' : ''}
                   </span>`
                : '';

            mdNode.innerHTML = `
                <div class="flex items-center gap-2 min-w-0 w-full">
                    <svg class="w-4 h-4 shrink-0" style="color:${iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2-0 01-2-2V5a2 2-0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                    <span class="truncate">${mdFilename}</span>
                    ${errorBadge}
                    ${confBadge}
                </div>`;
            fileGroup.appendChild(mdNode);

            // Low-confidence sub-nodes (expandable)
            if (hasLowConf) {
                const lcList = document.createElement('div');
                lcList.id = `file-node-lc-list-${fIndex}`;
                lcList.className = 'space-y-1 pl-6 pt-1 lc-list-node';
                lcList.style.display = 'none'; // collapsed by default
                lowConfPages.forEach((lc, i) => {
                    const lcNode = document.createElement('div');
                    lcNode.id = `file-node-lc-${fIndex}-${i}`;
                    lcNode.className = 'file-node low-conf-page-node';
                    lcNode.setAttribute('tabindex', '0');
                    lcNode.setAttribute('onclick', `navigateToLowConfPage(${fIndex}, ${lc.page})`);
                    lcNode.innerHTML = `
                        <div class="flex items-center gap-1.5 min-w-0 w-full">
                            <svg class="w-3.5 h-3.5 shrink-0" style="color:var(--warn)" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                            <span class="truncate text-[10px]">Page ${lc.page} — ${lc.reasons.join(', ')}</span>
                        </div>`;
                    lcList.appendChild(lcNode);
                });
                fileGroup.appendChild(lcList);
            }

            // images
            if (!isFailed && dataBlock.extractedImages.length > 0) {
                const folderNode = document.createElement('div');
                folderNode.className = 'flex items-center gap-2 py-1 px-2 mt-1 min-w-0 img-folder-node';
                folderNode.style.color = 'var(--text-2)';
                folderNode.innerHTML = `
                    <svg class="w-4 h-4 shrink-0" style="color:#f59e0b" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2-0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9l-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                    <span class="truncate text-[11px] opacity-80">${folderName}</span>`;
                fileGroup.appendChild(folderNode);

                const imgList = document.createElement('div');
                imgList.className = 'space-y-1 pl-6 pt-1 img-list-node';
                dataBlock.extractedImages.forEach((img, iIndex) => {
                    const imgNode = document.createElement('div');
                    imgNode.id = `file-node-img-${fIndex}-${iIndex}`;
                    imgNode.className = 'file-node';
                    imgNode.setAttribute('tabindex', '0');
                    imgNode.setAttribute('onclick', `selectVirtualFile(${fIndex}, 'img', ${iIndex})`);
                    imgNode.innerHTML = `
                        <div class="flex items-center gap-1.5 min-w-0 w-full">
                            <svg class="w-3.5 h-3.5 shrink-0" style="color:#f59e0b" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                            <span class="truncate text-[10px]">${img.name}</span>
                        </div>`;
                    imgList.appendChild(imgNode);
                });
                fileGroup.appendChild(imgList);
            }
            treeContent.appendChild(fileGroup);
        }

        function updateSavingsUI() {
            // savings
            let totalPages = 0, totalImages = 0, totalChars = 0;
            state.processedData.forEach(d => {
                if (d.status === 'failed') return;
                totalPages += d.numPages || 1;
                totalImages += d.extractedImages ? d.extractedImages.length : 0;
                totalChars += d.mdText ? d.mdText.length : 0;
            });
            const baseCostPerPage = 850; // avg cost
            const imgCost = state.selectedImgRes === 0 ? 85 : (state.selectedImgRes === 1 ? 255 : 850);
            const beforeTokens = totalPages * baseCostPerPage;
            const afterTokens = Math.round(totalChars / 4) + (totalImages * imgCost);

            const tokenBanner = document.getElementById('token-savings-banner');
            if (tokenBanner) {
                if (beforeTokens > afterTokens) {
                    const saved = beforeTokens - afterTokens;
                    const percent = Math.round((saved / beforeTokens) * 100);
                    tokenBanner.innerHTML = `💸 Est. Tokens Saved: <strong style="color:var(--text-1)">~${saved.toLocaleString()}</strong> (${percent}%)`;
                    tokenBanner.classList.remove('hidden', 'animate-in');
                    void tokenBanner.offsetWidth; // reflow
                    tokenBanner.classList.add('animate-in');
                } else {
                    tokenBanner.classList.add('hidden');
                    tokenBanner.classList.remove('animate-in');
                }
            }

            document.getElementById('output-area').classList.remove('hidden');
            document.getElementById('output-area').scrollIntoView({ behavior: 'smooth' });
            setTimeout(() => window.showDonationToast(), 1500);
        }

        // select file
        function selectVirtualFile(fIndex, type, iIndex = null) {
            // Persist current file state before switching
            if (state.activeDataIndex !== null && state.processedData[state.activeDataIndex]) {
                if (state.currentViewType === 'md') {
                    state.processedData[state.activeDataIndex].viewMode = state.currentViewMode;
                    state.processedData[state.activeDataIndex].isEditing = state.isEditing;
                }
                if (state.hasUnsavedChanges && typeof window.mdEditor !== 'undefined' && window.mdEditor) {
                    state.processedData[state.activeDataIndex].draftText = window.mdEditor.getValue();
                } else {
                    delete state.processedData[state.activeDataIndex].draftText;
                }
            }
            state.hasUnsavedChanges = false;
            document.getElementById('viewer-header-dot').style.background = 'var(--accent)';
            document.getElementById('viewer-unsaved-indicator').classList.add('hidden');
            state.currentViewMode = null; // Prevent contamination
            state.isEditing = false;
            state.activeDataIndex = fIndex;
            state.currentViewType = type;
            state.currentImageIndex = iIndex;

            // reset selection
            document.querySelectorAll('.file-node').forEach(n => {
                n.classList.remove('active-md', 'active-img');
            });

            const viewerRaw = document.getElementById('viewer-md-container');
            const viewerRendered = document.getElementById('viewer-md-rendered');
            const viewerImg = document.getElementById('viewer-img-container');
            const headerFn = document.getElementById('viewer-header-filename');
            const actionBtn = document.getElementById('viewer-action-btn');
            const viewModePill = document.getElementById('view-mode-pill');
            const copyBtn = document.getElementById('viewer-copy-btn');
            const activeData = state.processedData[fIndex];

            if (type === 'md') {
                const node = document.getElementById(`file-node-md-${fIndex}`);
                if (node) {
                    node.classList.add('active-md');
                    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                state.hasUnsavedChanges = !!activeData.draftText;
                if (state.hasUnsavedChanges) {
                    document.getElementById('viewer-header-dot').style.background = 'var(--warn)';
                    document.getElementById('viewer-unsaved-indicator').classList.remove('hidden');
                }
                viewerImg.classList.add('hidden');
                viewerImg.classList.remove('order-first');
                document.getElementById('md-controls').style.display = 'flex';
                if (copyBtn) copyBtn.style.display = 'flex';

                const isFailed = activeData.status === 'failed';
                headerFn.textContent = activeData.filename.replace('.pdf', '') + (isFailed ? '' : '.md');
                
                // Toggle Explorer Header 'View Logs' button visibility
                const btnHeaderLogs = document.getElementById('btn-view-logs');
                if (btnHeaderLogs) {
                    if (isFailed) btnHeaderLogs.classList.add('hidden');
                    else btnHeaderLogs.classList.remove('hidden');
                }

                const textToDisplay = activeData.draftText !== undefined ? activeData.draftText : activeData.mdText;
                viewerRaw.textContent = textToDisplay;

                if (typeof window.mdEditor !== 'undefined' && window.mdEditor) {
                    window.isSyncingAce = true;
                    window.mdEditor.setValue(textToDisplay, -1);
                    window.isSyncingAce = false;
                }

                if (isFailed) {
                    // Custom UI for failed files
                    document.getElementById('md-controls').style.display = 'none';
                    if (copyBtn) copyBtn.style.display = 'none';

                    const targetMode = 'rendered'; // Force rendered to show the error nicely
                    window.setViewMode(targetMode);

                    window.renderMarkdown(activeData.mdText);

                    actionBtn.className = 'vh-action-btn';
                    actionBtn.setAttribute('onclick', 'toggleTerminalModal()');
                    actionBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg> View Logs`;
                } else {
                    const targetMode = activeData.viewMode || 'raw';
                    state.isEditing = activeData.isEditing || false;
                    window.setViewMode(targetMode);
                    actionBtn.className = 'vh-icon-btn';
                    actionBtn.setAttribute('title', 'Download MD File');
                    actionBtn.setAttribute('onclick', `downloadMarkdown(${fIndex})`);
                    actionBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>`;
                }

            } else {
                const node = document.getElementById(`file-node-img-${fIndex}-${iIndex}`);
                if (node) {
                    node.classList.add('active-img');
                    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }

                // Highlight the MD file node as well to clarify context
                const mdNode = document.getElementById(`file-node-md-${fIndex}`);
                if (mdNode) mdNode.classList.add('active-md');

                const wrapper = document.getElementById('viewer-content-wrapper');
                const editorEl = document.getElementById('raw-markdown-block');
                if (editorEl) editorEl.classList.add('hidden');
                const resizer = document.getElementById('split-resizer');

                const img = activeData.extractedImages[iIndex];

                wrapper.classList.remove('flex-row');
                wrapper.classList.add('flex-col');

                if (resizer) resizer.classList.add('hidden');
                viewerRendered.classList.add('hidden');
                viewerRaw.classList.add('hidden');
                const splitRenderedLeft = document.getElementById('split-rendered-left');
                const splitRawRight = document.getElementById('split-raw-right');
                if (splitRenderedLeft) splitRenderedLeft.classList.add('hidden');
                if (splitRawRight) splitRawRight.classList.add('hidden');
                const panelControls = document.getElementById('split-panel-controls');
                if (panelControls) panelControls.classList.add('hidden');

                viewerImg.classList.remove('order-first');
                viewerImg.style.flex = ''; // Reset width sizing if it was adjusted

                viewerImg.classList.remove('hidden');
                document.getElementById('md-controls').style.display = 'none';
                if (copyBtn) copyBtn.style.display = 'none';

                headerFn.textContent = img.name;
                document.getElementById('viewer-img-element').src = img.dataUrl;
                document.getElementById('viewer-img-meta').textContent = `Format: JPG | Dimensions: ${img.dims || 'N/A'}`;

                actionBtn.className = 'vh-icon-btn';
                actionBtn.setAttribute('title', 'Download JPG Image');
                actionBtn.setAttribute('onclick', `downloadImage(${fIndex}, ${iIndex})`);
                actionBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>`;
            }

            if (window.matchMedia('(max-width: 768px)').matches && typeof window.setMobileView === 'function') {
                window.setMobileView('editor');
            }
        }

        // tree search filter
        function filterFileTree(query) {
            const q = query.toLowerCase();
            const groups = document.querySelectorAll('.tree-group');
            const lowConfOnly = state.showLowConfidenceOnly;

            groups.forEach(group => {
                let groupVisible = false;

                // check if this file has low confidence pages
                const mdNode = group.querySelector('.file-node[id^="file-node-md"]');
                const fIndex = mdNode ? parseInt(mdNode.getAttribute('onclick').match(/\d+/)[0]) : -1;
                const dataBlock = state.processedData[fIndex];
                const hasLowConf = dataBlock && (dataBlock.lowConfidencePages || []).length > 0;
                const showByConf = !lowConfOnly || hasLowConf;

                // filter md node
                if (mdNode) {
                    const mdMatch = q === '' || mdNode.textContent.toLowerCase().includes(q);
                    const show = mdMatch && showByConf;
                    mdNode.style.display = show ? '' : 'none';
                    if (show) groupVisible = true;
                }

                // filter image nodes
                const folderNode = group.querySelector('.img-folder-node');
                const imgList = group.querySelector('.img-list-node');
                let imgMatchCount = 0;

                if (imgList) {
                    const imgNodes = imgList.querySelectorAll('.file-node');
                    imgNodes.forEach(node => {
                        const match = q === '' || node.textContent.toLowerCase().includes(q);
                        node.style.display = match && showByConf ? '' : 'none';
                        if (match && showByConf) imgMatchCount++;
                    });
                }

                // hide/show folder container appropriately
                if (folderNode && imgList) {
                    if (q === '' && !lowConfOnly) {
                        folderNode.style.display = imgMatchCount > 0 || showByConf ? '' : 'none';
                        imgList.style.display = imgMatchCount > 0 || showByConf ? '' : 'none';
                    } else {
                        folderNode.style.display = imgMatchCount > 0 ? '' : 'none';
                        imgList.style.display = imgMatchCount > 0 ? '' : 'none';
                    }
                }

                // filter low-confidence page list nodes
                const lcList = group.querySelector('.lc-list-node');
                if (lcList) {
                    if (showByConf && hasLowConf) {
                        lcList.style.display = lowConfOnly ? '' : 'none';
                        lcList.querySelectorAll('.low-conf-page-node').forEach(node => {
                            const match = q === '' || node.textContent.toLowerCase().includes(q);
                            node.style.display = match ? '' : 'none';
                        });
                    } else {
                        lcList.style.display = 'none';
                    }
                }

                if (imgMatchCount > 0) groupVisible = true;
                group.style.display = groupVisible ? '' : 'none';
            });
        }

        function toggleLowConfidenceFilter() {
            state.showLowConfidenceOnly = !state.showLowConfidenceOnly;
            const btn = document.getElementById('btn-low-conf-filter');
            if (btn) {
                btn.classList.toggle('low-conf-active', state.showLowConfidenceOnly);
            }
            filterFileTree(document.getElementById('file-tree-search')?.value || '');
        }

        // Expand/collapse low-confidence page list for a file
        function toggleLowConfPages(fIndex) {
            // First, make sure we're viewing the MD for this file
            if (state.activeDataIndex !== fIndex) {
                selectVirtualFile(fIndex, 'md');
            }
            const lcList = document.getElementById(`file-node-lc-list-${fIndex}`);
            if (lcList) {
                const isVisible = lcList.style.display !== 'none';
                lcList.style.display = isVisible ? 'none' : '';
            }
        }

        // Navigate editor to a specific low-confidence page
        function navigateToLowConfPage(fIndex, pageNum) {
            // Switch to this file's MD view if not already
            if (state.activeDataIndex !== fIndex) {
                selectVirtualFile(fIndex, 'md');
            }
            // Highlight the page node in the tree
            document.querySelectorAll('.low-conf-page-node').forEach(n => n.classList.remove('active-md'));
            const lcPages = state.processedData[fIndex]?.lowConfidencePages || [];
            const pageIdx = lcPages.findIndex(p => p.page === pageNum);
            const lcNode = document.getElementById(`file-node-lc-${fIndex}-${pageIdx >= 0 ? pageIdx : 0}`);
            if (lcNode) lcNode.classList.add('active-md');

            // Preserve user's current view mode; if in pdf or split mode, default to raw since markdown highlights are in text
            if (typeof window.setViewMode === 'function') {
                const curMode = state.currentViewMode || 'raw';
                window.setViewMode((curMode === 'pdf' || curMode === 'split') ? 'raw' : curMode);
            }

            // Wait for the editor to be ready after switching files
            setTimeout(() => {
                if (typeof window.mdEditor === 'undefined' || !window.mdEditor) return;
                if (typeof window.ace === 'undefined') return;

                // Clear previous highlights
                _clearLowConfHighlights();

                const sourceMap = state.processedData[fIndex]?.sourceMap || [];
                const lowConfBlocks = sourceMap.filter(b => b.page === pageNum && b.confidence === 'low');

                if (lowConfBlocks.length === 0) {
                    // Fallback: no source map blocks — just scroll to page heading
                    const md = state.processedData[fIndex]?.mdText || '';
                    const pageHeading = `## Page ${pageNum}`;
                    const idx = md.indexOf(pageHeading);
                    if (idx !== -1) {
                        const lineNum = md.substring(0, idx).split('\n').length;
                        window.mdEditor.gotoLine(lineNum, 0, true);
                    }
                    return;
                }

                // Add Ace highlight markers for each low-confidence block
                const ranges = [];

                lowConfBlocks.forEach((block, bi) => {
                    const [start, end] = block.md_range;
                    const md = state.processedData[fIndex]?.mdText || '';
                    if (end > md.length) return;

                    const startLine = md.substring(0, start).split('\n').length - 1;
                    const startCol = Math.max(0, start - (md.lastIndexOf('\n', start - 1) + 1));
                    const endLine = md.substring(0, end).split('\n').length - 1;
                    const endCol = Math.max(0, end - (md.lastIndexOf('\n', end - 1) + 1));

                    const aceRange = new window.ace.Range(startLine, startCol, endLine, endCol);
                    ranges.push(aceRange);
                });

                ranges.forEach((range, i) => {
                    window.mdEditor.session.addMarker(range, 'ace_low_conf_highlight', 'text', false);
                });
                // Scroll to the first highlighted block
                const firstRange = ranges[0];
                if (firstRange) {
                    window.mdEditor.scrollToLine(firstRange.start.row, true);
                    window.mdEditor.focus();
                }

                // Also highlight in the rendered preview AND raw text view
                _highlightRenderedPage(pageNum);
                _highlightRawView(fIndex, pageNum);
            }, 150);
        }

        // Highlight low-confidence blocks in the raw text view (pre/code block)
        // Only highlights specific low-confidence blocks — skips if all blocks are low-confidence
        function _highlightRawView(fIndex, pageNum) {
            const rawContainer = document.getElementById('viewer-md-container');
            if (!rawContainer) return;

            const sourceMap = state.processedData[fIndex]?.sourceMap || [];
            const pageBlocks = sourceMap.filter(b => b.page === pageNum);
            const lowConfBlocks = pageBlocks.filter(b => b.confidence === 'low');
            if (lowConfBlocks.length === 0) return;
            // Skip highlighting when all page blocks are low-confidence — badge already conveys this
            if (pageBlocks.length > 0 && lowConfBlocks.length === pageBlocks.length) return;

            const md = state.processedData[fIndex]?.mdText || '';

            // Sort blocks by start position
            lowConfBlocks.sort((a, b) => a.md_range[0] - b.md_range[0]);

            // Build highlighted HTML: wrap each block's text in a <mark>
            let result = '';
            let pos = 0;
            lowConfBlocks.forEach(block => {
                const [start, end] = block.md_range;
                // Add text before this block
                result += escapeHtml(md.substring(pos, start));
                // Add highlighted block
                result += `<mark class="low-conf-page-block">${escapeHtml(md.substring(start, end))}</mark>`;
                pos = end;
            });
            // Add remaining text after last block
            result += escapeHtml(md.substring(pos));

            rawContainer.innerHTML = result;
        }

        function escapeHtml(text) {
            return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        // Highlight low-confidence page in the rendered markdown preview
        function _highlightRenderedPage(pageNum) {
            const rendered = document.getElementById('viewer-md-rendered');
            if (!rendered) return;

            // Clear previous highlights
            rendered.querySelectorAll('.low-conf-page-highlight').forEach(el => {
                el.style.borderLeft = '';
                el.style.background = '';
                el.classList.remove('low-conf-page-highlight');
            });

            // Find the h2 heading for this specific page number
            const headings = rendered.querySelectorAll('h2');
            let targetHeading = null;
            let targetIndex = -1;

            for (let i = 0; i < headings.length; i++) {
                const h = headings[i];
                const text = h.textContent.trim();
                if (text === `Page ${pageNum}` || text.startsWith(`Page ${pageNum}`) && /^Page \d+/.test(text)) {
                    targetHeading = h;
                    targetIndex = i;
                    break;
                }
            }

            if (!targetHeading) return;

            // Collect all elements from this heading to the next page heading
            const elements = [];
            let el = targetHeading;
            while (el) {
                elements.push(el);
                // Stop at next page heading
                const next = el.nextElementSibling;
                if (next && (next.tagName === 'H1' || next.tagName === 'H2' || next.tagName === 'H3') && next.textContent.trim().includes('Page') && next !== targetHeading) {
                    break;
                }
                el = next;
            }

            // Apply highlight
            elements.forEach((elem, idx) => {
                elem.style.borderLeft = '3px solid rgba(245, 158, 11, 0.8)';
                elem.style.background = 'rgba(245, 158, 11, 0.12)';
                elem.style.paddingLeft = '8px';
                elem.classList.add('low-conf-page-highlight');
            });

            // Scroll to the heading
            targetHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        function _clearLowConfHighlights() {
            // Clear Ace editor markers
            if (typeof window.mdEditor !== 'undefined' && window.mdEditor && window.mdEditor.session) {
                const markers = window.mdEditor.session.getMarkers();
                Object.keys(markers).forEach(id => {
                    if (markers[id].clazz === 'ace_low_conf_highlight') {
                        window.mdEditor.session.removeMarker(markers[id].id);
                    }
                });
            }
            // Clear raw-view <mark> tags — reset to plain text
            const rawContainer = document.getElementById('viewer-md-container');
            if (rawContainer && state.activeDataIndex !== null) {
                const data = state.processedData[state.activeDataIndex];
                if (data) rawContainer.textContent = data.mdText || '';
            }
            // Clear rendered-view inline styles
            document.querySelectorAll('.low-conf-page-highlight').forEach(el => {
                el.style.borderLeft = '';
                el.style.background = '';
                el.style.paddingLeft = '';
                el.classList.remove('low-conf-page-highlight');
            });
            // Clear split panel raw marks
            const splitRaw = document.getElementById('split-raw-right');
            if (splitRaw && state.activeDataIndex !== null) {
                const data = state.processedData[state.activeDataIndex];
                if (data) splitRaw.textContent = data.mdText || '';
            }
        }

        window._clearLowConfHighlights = _clearLowConfHighlights;

function finishProcessing() {
    window.showProgressState(false);
    const treeContent = document.getElementById('dynamic-tree-content');
    if (treeContent) treeContent.innerHTML = '';
    
    state.processedData.forEach((data, idx) => {
        renderFileToTree(data, idx);
    });

    updateSavingsUI();
    
    // Select the first file by default
    if (state.processedData.length > 0) {
        selectVirtualFile(0, 'md');
    }
}

window.renderFileToTree = renderFileToTree;
window.updateSavingsUI = updateSavingsUI;
window.selectVirtualFile = selectVirtualFile;
window.filterFileTree = filterFileTree;
window.toggleLowConfidenceFilter = toggleLowConfidenceFilter;
window.toggleLowConfPages = toggleLowConfPages;
window.navigateToLowConfPage = navigateToLowConfPage;
window.finishProcessing = finishProcessing;

