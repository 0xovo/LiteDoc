
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
                ? `<span class="low-conf-badge" title="${lowConfPages.map(p => `Page ${p.page}: ${p.reasons.join(', ')}`).join(' | ')}">
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
window.finishProcessing = finishProcessing;

