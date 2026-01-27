let selectedNode = null;
let selectedNodes = []; // For batch selection
let isSelecting = false;
let selectionStart = null;
let currentZoom = null;
let currentSvg = null;
let currentNodes = []; // Nodes with positions from D3 simulation

function renderGraph(neo4jJson, history = false) {
    neo4jJson = JSON.parse(JSON.stringify(neo4jJson));

    !history && addToHistory(neo4jJson);

    d3.select("#graph").selectAll("svg").remove();
    hideNodePopup();

    const svg = d3.select("#graph")
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%");

    currentSvg = svg;

    const width = parseInt(svg.style("width"));
    const height = parseInt(svg.style("height"));

    // Add zoom behavior
    const g = svg.append("g");
    currentZoom = d3.zoom()
        .scaleExtent([0.2, 4])
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
            updateMinimapViewport();
        });
    svg.call(currentZoom);

    // Build links first (needed for counting)
    neo4jJson.relationships.forEach(link => {
        link.source = neo4jJson.nodes.find(node => node.id === link.startNodeId);
        link.target = neo4jJson.nodes.find(node => node.id === link.endNodeId);
    });

    // Filter invalid relationships
    neo4jJson.relationships = neo4jJson.relationships.filter(r => r.source && r.target);

    // Count links per node
    const linkCount = {};
    neo4jJson.nodes.forEach(n => linkCount[n.id] = 0);
    neo4jJson.relationships.forEach(r => {
        const sourceId = r.source?.id ?? r.source;
        const targetId = r.target?.id ?? r.target;
        if (sourceId !== undefined) linkCount[sourceId] = (linkCount[sourceId] || 0) + 1;
        if (targetId !== undefined) linkCount[targetId] = (linkCount[targetId] || 0) + 1;
    });

    // Scale functions based on link count
    const maxLinks = Math.max(1, ...Object.values(linkCount));
    const getNodeRadius = (d) => {
        const count = linkCount[d.id] || 0;
        const ratio = count / maxLinks;
        return 10 + Math.pow(ratio, 0.6) * 35; // 10-45px, power curve for more dramatic scaling
    };
    const getFontSize = (d) => {
        const count = linkCount[d.id] || 0;
        const ratio = count / maxLinks;
        return 10 + Math.pow(ratio, 0.6) * 10; // 10-20px
    };
    const getTextOffset = (d) => {
        return getNodeRadius(d) + 14;
    };
    const getLinkStrength = (link) => {
        const sourceCount = linkCount[link.source?.id ?? link.source] || 0;
        const targetCount = linkCount[link.target?.id ?? link.target] || 0;
        const avgCount = (sourceCount + targetCount) / 2;
        return 0.3 + (avgCount / maxLinks) * 0.5; // 0.3-0.8
    };
    const getLinkWidth = (link) => {
        const sourceCount = linkCount[link.source?.id ?? link.source] || 0;
        const targetCount = linkCount[link.target?.id ?? link.target] || 0;
        const avgCount = (sourceCount + targetCount) / 2;
        return 1 + (avgCount / maxLinks) * 3; // 1-4px
    };
    const getLinkOpacity = (link) => {
        const sourceCount = linkCount[link.source?.id ?? link.source] || 0;
        const targetCount = linkCount[link.target?.id ?? link.target] || 0;
        const avgCount = (sourceCount + targetCount) / 2;
        return 0.15 + (avgCount / maxLinks) * 0.45; // 0.15-0.6
    };

    // Force simulation - very spread out
    const nodeCount = neo4jJson.nodes.length;
    const linkDistance = Math.max(80, Math.min(150, 250 / Math.sqrt(nodeCount)));
    const chargeStrength = Math.max(-3000, Math.min(-600, -400 * Math.sqrt(nodeCount)));

    const simulation = d3.forceSimulation()
        .force("link", d3.forceLink().id(d => d.id).distance(linkDistance).strength(d => getLinkStrength(d)))
        .force("charge", d3.forceManyBody().strength(chargeStrength).distanceMax(1200))
        .force("center", d3.forceCenter(width / 2, height / 3))
        .force("collision", d3.forceCollide().radius(d => getNodeRadius(d) + 40).strength(1))
        .force("x", d3.forceX(width / 2).strength(0.01))
        .force("y", d3.forceY(height / 3).strength(0.01))
        .alphaDecay(0.015)
        .velocityDecay(0.25);

    const link = g.append("g")
        .selectAll("line")
        .data(neo4jJson.relationships)
        .join("line")
        .attr("stroke", d => `rgba(255,255,255,${getLinkOpacity(d)})`)
        .attr("stroke-width", d => getLinkWidth(d));

    // Color palette by label
    const labelColors = {
        'Person': '#e91e63',
        'Organization': '#2196f3',
        'Place': '#4caf50',
        'Event': '#ff9800',
        'Process': '#9c27b0',
        'Technology': '#00bcd4',
        'Concept': '#ab47bc',
        'Object': '#8d6e63',
        'Action': '#ef5350',
        'Synthesis': '#ffd700'  // Gold for synthesized concepts
    };

    function getNodeColor(d) {
        const label = d.labels?.[0];
        return labelColors[label] || '#9c27b0';
    }

    function getGroundingStroke(d) {
        // First check codebase grounding
        let grounding = d.grounding;
        if (!grounding && d.properties?.grounding) {
            const str = d.properties.grounding;
            if (typeof str === 'string' && str.trim().startsWith('{')) {
                try { grounding = JSON.parse(str); } catch (e) { /* ignore */ }
            }
        }
        if (grounding) {
            if (grounding.status === 'IMPLEMENTED') return "#4ade80";
            if (grounding.status === 'PARTIAL') return "#fbbf24";
            if (grounding.status === 'NOT_FOUND') return "#f87171";
        }

        // Fall back to audit verdict
        const auditVerdict = d.properties?._groundingVerdict;
        if (auditVerdict === 'grounded') return "#4ade80";
        if (auditVerdict === 'weak') return "#fbbf24";
        if (auditVerdict === 'ungrounded') return "#f87171";

        return "#fff";
    }

    function getGroundingStrokeWidth(d) {
        const hasGrounding = d.grounding || (d.properties?.grounding && d.properties.grounding.startsWith('{'));
        const hasAudit = d.properties?._groundingVerdict;
        return (hasGrounding || hasAudit) ? 3 : 2;
    }

    const node = g.append("g")
        .selectAll("circle")
        .data(neo4jJson.nodes)
        .join("circle")
        .attr("r", d => getNodeRadius(d))
        .attr("fill", d => getNodeColor(d))
        .attr("stroke", d => getGroundingStroke(d))
        .attr("stroke-width", d => getGroundingStrokeWidth(d))
        .style("cursor", "pointer")
        .on("click", (event, d) => {
            event.stopPropagation();
            selectedNode = d;
            showNodePopup(d, event);
        })
        .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

    const text = g.append("g")
        .selectAll("text")
        .data(neo4jJson.nodes)
        .join("text")
        .style('fill', 'white')
        .attr("font-family", "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif")
        .attr("font-size", d => getFontSize(d) + "px")
        .attr("font-weight", "500")
        .attr("text-anchor", "middle")
        .attr("dy", d => getTextOffset(d))
        .style("pointer-events", "none")
        .text(d => d.properties.name?.substring(0, 25) || '?');

    // Store reference to positioned nodes for lookups
    currentNodes = neo4jJson.nodes;

    simulation.nodes(neo4jJson.nodes).on("tick", ticked);
    simulation.force("link").links(neo4jJson.relationships);
    simulation.alpha(1).restart();

    function ticked() {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node
            .attr("cx", d => d.x)
            .attr("cy", d => d.y);

        text
            .attr("x", d => d.x)
            .attr("y", d => d.y);
    }

    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    // Drag selection rectangle
    const selectionRect = svg.append("rect")
        .attr("class", "selection-rect")
        .attr("fill", "rgba(116, 31, 228, 0.2)")
        .attr("stroke", "#741fe4")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "5,5")
        .style("display", "none")
        .style("pointer-events", "none");

    // Use document-level events for reliable drag selection
    let currentNodeSelection = node;

    svg.on("mousedown", function(event) {
        const target = event.target.tagName.toLowerCase();
        // Only start selection if clicking on svg background or lines
        if (target === 'svg' || target === 'line') {
            event.preventDefault();
            hideNodePopup();
            hideBatchMenu();
            isSelecting = true;
            selectionStart = d3.pointer(event);
            selectionRect
                .attr("x", selectionStart[0])
                .attr("y", selectionStart[1])
                .attr("width", 0)
                .attr("height", 0)
                .style("display", "block");
            clearNodeSelection(currentNodeSelection);
            selectedNodes = [];
        }
    });

    document.addEventListener("mousemove", function(event) {
        if (!isSelecting) return;

        const svgEl = document.querySelector("#graph svg");
        if (!svgEl) return;

        const rect = svgEl.getBoundingClientRect();
        const current = [event.clientX - rect.left, event.clientY - rect.top];

        const x = Math.min(selectionStart[0], current[0]);
        const y = Math.min(selectionStart[1], current[1]);
        const w = Math.abs(current[0] - selectionStart[0]);
        const h = Math.abs(current[1] - selectionStart[1]);

        selectionRect
            .attr("x", x)
            .attr("y", y)
            .attr("width", w)
            .attr("height", h);

        // Get current zoom transform to convert screen coords to simulation coords
        const transform = d3.zoomTransform(svgEl);

        // Convert selection bounds from screen space to simulation space
        const bounds = {
            x1: (x - transform.x) / transform.k,
            y1: (y - transform.y) / transform.k,
            x2: ((x + w) - transform.x) / transform.k,
            y2: ((y + h) - transform.y) / transform.k
        };

        selectedNodes = [];

        currentNodeSelection.each(function(d) {
            const inBounds = d.x >= bounds.x1 && d.x <= bounds.x2 &&
                           d.y >= bounds.y1 && d.y <= bounds.y2;
            d3.select(this)
                .attr("stroke", inBounds ? "#ffd700" : "#fff")
                .attr("stroke-width", inBounds ? 4 : 2);
            if (inBounds) selectedNodes.push(d);
        });
    });

    document.addEventListener("mouseup", function(event) {
        if (!isSelecting) return;

        isSelecting = false;
        selectionRect.style("display", "none");

        if (selectedNodes.length > 1) {
            showBatchMenu(event, selectedNodes);
        } else if (selectedNodes.length === 1) {
            selectedNode = selectedNodes[0];
            showNodePopup(selectedNodes[0], event);
            clearNodeSelection(currentNodeSelection);
        } else {
            clearNodeSelection(currentNodeSelection);
            hideNodePopup();
            hideBatchMenu();
        }
    });

    // Prevent context menu and text selection
    svg.on("contextmenu", (event) => event.preventDefault());
    svg.on("selectstart", (event) => event.preventDefault());

    // Update graph counter
    updateGraphCounter();

    // Update minimap periodically during simulation
    const minimapInterval = setInterval(() => {
        updateMinimap();
    }, 200);

    // Stop interval when simulation ends
    simulation.on("end.minimap", () => {
        clearInterval(minimapInterval);
        updateMinimap();
    });

    // Initial minimap update after positions settle a bit
    setTimeout(() => updateMinimap(), 500);
}

function showNodePopup(node, event) {
    console.log('showNodePopup called for:', node.properties.name);
    hideNodePopup();

    // Find all connected nodes
    const connections = [];
    if (merged_object?.relationships) {
        merged_object.relationships.forEach(r => {
            const sourceId = r.source?.id ?? r.startNodeId;
            const targetId = r.target?.id ?? r.endNodeId;
            let connectedNode = null;
            let direction = '';

            if (sourceId === node.id) {
                connectedNode = merged_object.nodes.find(n => n.id === targetId);
                direction = '→';
            } else if (targetId === node.id) {
                connectedNode = merged_object.nodes.find(n => n.id === sourceId);
                direction = '←';
            }

            if (connectedNode) {
                // Calculate strength based on how many links the connected node has
                const linkCount = merged_object.relationships.filter(rel => {
                    const sId = rel.source?.id ?? rel.startNodeId;
                    const tId = rel.target?.id ?? rel.endNodeId;
                    return sId === connectedNode.id || tId === connectedNode.id;
                }).length;

                connections.push({
                    node: connectedNode,
                    type: r.type || 'CONNECTED',
                    direction,
                    strength: linkCount
                });
            }
        });
    }

    // Sort by strength (most connected first)
    connections.sort((a, b) => b.strength - a.strength);
    const maxStrength = Math.max(1, ...connections.map(c => c.strength));

    // Build connections HTML
    let connectionsHtml = '';
    if (connections.length > 0) {
        connectionsHtml = `
            <div class="popup-connections">
                <div class="connections-header">Connections (${connections.length})</div>
                <div class="connections-list">
                    ${connections.map(c => {
                        const strengthPercent = Math.round((c.strength / maxStrength) * 100);
                        return `
                            <div class="connection-item">
                                <div class="connection-info">
                                    <span class="connection-direction">${c.direction}</span>
                                    <span class="connection-name" data-node-id="${c.node.id}">${c.node.properties.name}</span>
                                </div>
                                <div class="connection-meta">
                                    <span class="connection-type">${c.type}</span>
                                    <div class="connection-strength">
                                        <div class="strength-bar" style="width: ${strengthPercent}%"></div>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    // Build audit section if available (epistemic rigor check)
    let auditHtml = '';
    const auditVerdict = node.properties?._groundingVerdict;
    if (auditVerdict) {
        const auditColors = {
            'grounded': '#4ade80',
            'weak': '#fbbf24',
            'ungrounded': '#f87171'
        };
        const auditIcons = {
            'grounded': '✓',
            'weak': '⚠',
            'ungrounded': '✗'
        };

        // Parse tests if stored as JSON string
        let tests = node.properties?._groundingTests;
        if (typeof tests === 'string') {
            try { tests = JSON.parse(tests); } catch (e) { tests = {}; }
        }

        const testsHtml = tests ? Object.entries(tests).map(([key, val]) => `
            <div class="audit-test ${val?.pass ? 'pass' : 'fail'}">
                <span class="test-icon">${val?.pass ? '✓' : '✗'}</span>
                <span class="test-name">${key}</span>
                ${val?.note ? `<span class="test-note">${val.note}</span>` : ''}
            </div>
        `).join('') : '';

        const auditDate = node.properties?._auditedAt
            ? new Date(node.properties._auditedAt).toLocaleDateString()
            : '';

        auditHtml = `
            <div class="popup-audit">
                <div class="audit-header-section">
                    <span class="audit-verdict" style="color: ${auditColors[auditVerdict] || '#888'}">
                        ${auditIcons[auditVerdict] || '?'} ${auditVerdict?.toUpperCase() || 'Unknown'}
                    </span>
                    <span class="audit-score">Score: ${node.properties?._groundingScore || 0}/3</span>
                    ${auditDate ? `<span class="audit-date">${auditDate}</span>` : ''}
                </div>
                ${testsHtml ? `<div class="audit-tests">${testsHtml}</div>` : ''}
                ${node.properties?._groundingSuggestion ? `
                    <div class="audit-suggestion">
                        <strong>Suggestion:</strong> ${node.properties._groundingSuggestion}
                    </div>
                ` : ''}
                ${node.properties?._groundingRecommendation ? `
                    <div class="audit-recommendation ${node.properties._groundingRecommendation}">
                        ${node.properties._groundingRecommendation.toUpperCase()}
                    </div>
                ` : ''}
            </div>
        `;
    }

    // Build codebase grounding section if available
    let groundingHtml = '';
    let grounding = node.grounding;
    if (!grounding && node.properties?.grounding) {
        const str = node.properties.grounding;
        if (typeof str === 'string' && str.trim().startsWith('{')) {
            try { grounding = JSON.parse(str); } catch (e) { /* ignore */ }
        }
    }

    if (grounding) {
        const statusColors = {
            'IMPLEMENTED': '#4ade80',
            'PARTIAL': '#fbbf24',
            'NOT_FOUND': '#f87171'
        };
        const statusIcons = {
            'IMPLEMENTED': '✓',
            'PARTIAL': '◐',
            'NOT_FOUND': '✗'
        };

        let referencesHtml = '';
        if (grounding.codeReferences?.length > 0) {
            referencesHtml = `
                <div class="grounding-refs">
                    <div class="grounding-refs-header">Code References:</div>
                    ${grounding.codeReferences.slice(0, 5).map(ref => `
                        <div class="grounding-ref">
                            <span class="ref-file">${ref.file}:${ref.line}</span>
                            ${ref.snippet ? `<code class="ref-snippet">${ref.snippet.slice(0, 80)}</code>` : ''}
                        </div>
                    `).join('')}
                    ${grounding.codeReferences.length > 5 ? `<div class="grounding-more">+${grounding.codeReferences.length - 5} more</div>` : ''}
                </div>
            `;
        }

        groundingHtml = `
            <div class="popup-grounding">
                <div class="grounding-header">
                    <span class="grounding-status" style="color: ${statusColors[grounding.status] || '#888'}">
                        ${statusIcons[grounding.status] || '?'} ${grounding.status || 'Unknown'}
                    </span>
                    <span class="grounding-date">${grounding.groundedAt ? new Date(grounding.groundedAt).toLocaleDateString() : ''}</span>
                </div>
                <div class="grounding-analysis">${grounding.analysis || 'No analysis available'}</div>
                ${referencesHtml}
                ${grounding.implementationNotes ? `<div class="grounding-notes"><strong>Notes:</strong> ${grounding.implementationNotes}</div>` : ''}
                ${grounding.suggestedImprovements ? `<div class="grounding-improvements"><strong>Suggested:</strong> ${grounding.suggestedImprovements}</div>` : ''}
            </div>
        `;
    }

    const popup = document.createElement('div');
    popup.id = 'node-popup';
    const isSynthesis = node.labels?.[0] === 'Synthesis';
    const isGrounded = !!grounding;
    const isAudited = !!auditVerdict;
    const auditIndicator = auditVerdict === 'grounded' ? '✓' : auditVerdict === 'weak' ? '⚠' : auditVerdict === 'ungrounded' ? '✗' : '';
    popup.innerHTML = `
        <div class="popup-header ${isSynthesis ? 'synthesis-node' : ''} ${isGrounded ? 'grounded-node' : ''} ${isAudited ? 'audited-' + auditVerdict : ''}">
            <span class="popup-label">${node.labels?.[0] || 'Node'}${isSynthesis ? ' ✨' : ''}${isGrounded ? ' ⚡' : ''}${auditIndicator ? ' ' + auditIndicator : ''}</span>
            <span class="popup-close" onclick="hideNodePopup()">&times;</span>
        </div>
        <div class="popup-name">${node.properties.name || 'Unnamed'}</div>
        <div class="popup-description">${node.properties.description || 'No description'}</div>
        ${auditHtml}
        ${groundingHtml}
        ${connectionsHtml}
        <div class="popup-actions">
            <button class="popup-btn research-btn" onclick="researchFromNode(${node.id})">
                Research This
            </button>
            <button class="popup-btn expand-btn" onclick="expandNode(${node.id})">
                Expand Connections
            </button>
        </div>
        <div class="popup-actions-secondary">
            <button class="popup-btn delete-btn" onclick="deleteNode(${node.id})">
                Delete Node
            </button>
        </div>
    `;

    document.body.appendChild(popup);

    // Add click handlers for connection names
    popup.querySelectorAll('.connection-name').forEach(el => {
        el.addEventListener('click', (e) => {
            const nodeId = parseInt(e.target.dataset.nodeId);
            // Use currentNodes which has x/y positions from D3
            const connectedNode = currentNodes.find(n => n.id === nodeId);
            if (connectedNode) {
                // Center view on the node
                centerOnNode(connectedNode);
                // Show popup after a short delay for the transition
                setTimeout(() => showNodePopup(connectedNode, e), 350);
            }
        });
    });

    // Position near click but within viewport
    setTimeout(() => {
        const rect = popup.getBoundingClientRect();
        let left = event.clientX + 15;
        let top = event.clientY + 15;

        if (left + rect.width > window.innerWidth - 20) {
            left = event.clientX - rect.width - 15;
        }
        if (top + rect.height > window.innerHeight - 20) {
            top = event.clientY - rect.height - 15;
        }

        popup.style.left = Math.max(10, left) + 'px';
        popup.style.top = Math.max(10, top) + 'px';
    }, 0);
}

function hideNodePopup() {
    const existing = document.getElementById('node-popup');
    if (existing) existing.remove();
}

function clearNodeSelection(nodeSelection) {
    if (nodeSelection) {
        nodeSelection.attr("stroke", "#fff").attr("stroke-width", 2);
    }
    selectedNodes = [];
}

function showBatchMenu(event, nodes) {
    hideBatchMenu();
    hideNodePopup();

    const menu = document.createElement('div');
    menu.id = 'batch-menu';
    menu.innerHTML = `
        <div class="batch-header">
            <span>${nodes.length} nodes selected</span>
            <span class="batch-close" onclick="hideBatchMenu()">&times;</span>
        </div>
        <div class="batch-nodes">
            ${nodes.slice(0, 8).map(n => `<span class="batch-node-tag">${n.properties.name}</span>`).join('')}
            ${nodes.length > 8 ? `<span class="batch-more">+${nodes.length - 8} more</span>` : ''}
        </div>
        <div class="batch-actions">
            <button class="batch-btn research" onclick="batchResearch()">
                Research All
            </button>
            <button class="batch-btn expand" onclick="batchExpand()">
                Find Connections
            </button>
            <button class="batch-btn delete" onclick="batchDelete()">
                Delete All
            </button>
        </div>
    `;

    document.body.appendChild(menu);

    // Position near mouse
    setTimeout(() => {
        const rect = menu.getBoundingClientRect();
        let left = event.clientX;
        let top = event.clientY;

        if (left + rect.width > window.innerWidth - 20) {
            left = window.innerWidth - rect.width - 20;
        }
        if (top + rect.height > window.innerHeight - 20) {
            top = window.innerHeight - rect.height - 20;
        }

        menu.style.left = Math.max(10, left) + 'px';
        menu.style.top = Math.max(10, top) + 'px';
    }, 0);
}

function hideBatchMenu() {
    const existing = document.getElementById('batch-menu');
    if (existing) existing.remove();
}

function batchDelete() {
    if (selectedNodes.length === 0) return;

    const names = selectedNodes.map(n => n.properties.name);
    const nodeIds = selectedNodes.map(n => n.id);

    // Remove nodes
    merged_object.nodes = merged_object.nodes.filter(n => !nodeIds.includes(n.id));

    // Remove relationships connected to deleted nodes
    const removedRels = merged_object.relationships.filter(
        r => nodeIds.includes(r.startNodeId) || nodeIds.includes(r.endNodeId)
    ).length;

    merged_object.relationships = merged_object.relationships.filter(
        r => !nodeIds.includes(r.startNodeId) && !nodeIds.includes(r.endNodeId)
    );

    hideBatchMenu();
    selectedNodes = [];

    logToPanel('result', 'Batch Delete', {
        stats: `Removed ${names.length} nodes and ${removedRels} relationships`,
        nodes: names
    });

    renderGraph(merged_object);
}

function batchResearch() {
    if (selectedNodes.length === 0) return;

    const names = selectedNodes.map(n => n.properties.name);
    hideBatchMenu();

    logToPanel('action', 'Batch Research', {
        input: `Researching ${names.length} concepts: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '...' : ''}`
    });

    setLoading();

    const prompt = getBatchResearchPrompt(selectedNodes);
    callClaude(prompt)
        .then(newGraph => {
            mergeNewNodes(newGraph, null, 'batch-research');
            renderGraph(merged_object);
            unsetLoading();
        })
        .catch(error => {
            logToPanel('error', 'Batch Research Failed', { error: error.message });
            unsetLoading();
        });

    selectedNodes = [];
}

function batchExpand() {
    if (selectedNodes.length === 0) return;

    const names = selectedNodes.map(n => n.properties.name);
    hideBatchMenu();

    logToPanel('action', 'Batch Expand', {
        input: `Finding connections between ${names.length} concepts`
    });

    setLoading();

    const prompt = getBatchExpandPrompt(selectedNodes);
    callClaude(prompt)
        .then(newGraph => {
            mergeNewNodes(newGraph, null, 'batch-expand');
            renderGraph(merged_object);
            unsetLoading();
        })
        .catch(error => {
            logToPanel('error', 'Batch Expand Failed', { error: error.message });
            unsetLoading();
        });

    selectedNodes = [];
}

// ============ SEARCH FUNCTIONALITY ============

let filteredNodes = []; // Track nodes matching current search
let searchAndMode = false; // false = OR mode, true = AND mode

function initSearch() {
    const searchInput = document.getElementById('graph-search');
    const searchContainer = document.getElementById('search-container');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();

        if (query) {
            searchContainer.classList.add('has-value');
        } else {
            searchContainer.classList.remove('has-value');
        }

        filterNodes(query);
    });
}

function toggleSearchMode() {
    searchAndMode = !searchAndMode;
    const modeBtn = document.getElementById('search-mode');

    if (searchAndMode) {
        modeBtn.classList.add('and-mode');
        modeBtn.title = 'AND mode: all terms must match';
    } else {
        modeBtn.classList.remove('and-mode');
        modeBtn.title = 'OR mode: any term matches';
    }

    // Re-run filter with current query
    const searchInput = document.getElementById('graph-search');
    if (searchInput?.value) {
        filterNodes(searchInput.value.trim().toLowerCase());
    }
}

function filterNodes(query) {
    const svg = d3.select("#graph svg");
    if (svg.empty()) return;

    const nodes = svg.selectAll("circle");
    const texts = svg.selectAll("text");
    const links = svg.selectAll("line");

    filteredNodes = []; // Reset

    if (!query) {
        // Reset all nodes to full opacity
        nodes.attr("opacity", 1);
        texts.attr("opacity", 1);
        links.attr("opacity", 0.3);
        updateGraphCounter();
        return;
    }

    // Split query into terms
    const terms = query.split(/\s+/).filter(t => t.length > 0);

    // Find matching nodes
    nodes.each(function(d) {
        const name = (d.properties?.name || '').toLowerCase();
        const desc = (d.properties?.description || '').toLowerCase();
        const combined = name + ' ' + desc;

        let matches;
        if (searchAndMode) {
            // AND mode: all terms must be found
            matches = terms.every(term => combined.includes(term));
        } else {
            // OR mode: any term can match
            matches = terms.some(term => combined.includes(term));
        }

        if (matches) {
            filteredNodes.push(d);
        }
    });

    const matchingIds = new Set(filteredNodes.map(n => n.id));

    // Update node opacity
    nodes.attr("opacity", d => matchingIds.has(d.id) ? 1 : 0.15);

    // Update text opacity
    texts.attr("opacity", d => matchingIds.has(d.id) ? 1 : 0.15);

    // Update link opacity - highlight if connected to matching node
    links.attr("opacity", d => {
        const sourceMatch = matchingIds.has(d.source.id);
        const targetMatch = matchingIds.has(d.target.id);
        if (sourceMatch && targetMatch) return 0.5;
        if (sourceMatch || targetMatch) return 0.25;
        return 0.05;
    });

    // Update counter with filtered count
    updateGraphCounter(filteredNodes.length);
}

function getFilteredNodes() {
    return filteredNodes.length > 0 ? filteredNodes : null;
}

function clearSearch() {
    const searchInput = document.getElementById('graph-search');
    const searchContainer = document.getElementById('search-container');
    if (searchInput) {
        searchInput.value = '';
        searchContainer.classList.remove('has-value');
        filterNodes('');
    }
}

function updateGraphCounter(filteredCount = null) {
    const nodeCountEl = document.getElementById('node-count');
    const relCountEl = document.getElementById('rel-count');
    if (!nodeCountEl || !relCountEl) return;

    const totalNodes = merged_object?.nodes?.length || 0;
    const totalRels = merged_object?.relationships?.length || 0;

    if (filteredCount !== null && filteredCount < totalNodes) {
        // Show filtered / total
        nodeCountEl.innerHTML = `<span class="filtered">${filteredCount}</span>/${totalNodes}`;
        // Count relationships between filtered nodes
        const filteredIds = new Set(filteredNodes.map(n => n.id));
        const filteredRels = merged_object?.relationships?.filter(r =>
            filteredIds.has(r.source?.id || r.startNodeId) &&
            filteredIds.has(r.target?.id || r.endNodeId)
        ).length || 0;
        relCountEl.innerHTML = `<span class="filtered">${filteredRels}</span>/${totalRels}`;
    } else {
        // Show totals
        nodeCountEl.textContent = totalNodes;
        relCountEl.textContent = totalRels;
    }
}

// Initialize search on load
document.addEventListener('DOMContentLoaded', initSearch);

// ============ ZOOM CONTROLS ============

function zoomIn() {
    if (currentSvg && currentZoom) {
        currentSvg.transition().duration(300).call(currentZoom.scaleBy, 1.4);
    }
}

function zoomOut() {
    if (currentSvg && currentZoom) {
        currentSvg.transition().duration(300).call(currentZoom.scaleBy, 0.7);
    }
}

function zoomReset() {
    if (currentSvg && currentZoom) {
        currentSvg.transition().duration(300).call(currentZoom.transform, d3.zoomIdentity);
    }
}

function centerOnNode(node) {
    if (!currentSvg || !currentZoom) return;
    if (node.x === undefined || node.y === undefined) {
        console.log('Node has no position:', node);
        return;
    }

    const svgEl = currentSvg.node();
    if (!svgEl) return;

    const svgRect = svgEl.getBoundingClientRect();
    const centerX = svgRect.width / 2;
    const centerY = svgRect.height / 2;

    // Get current transform to preserve zoom level
    const currentTransform = d3.zoomTransform(svgEl);
    const scale = Math.max(currentTransform.k, 1.2); // Zoom in a bit if zoomed out

    // Calculate new transform to center on node
    const x = centerX - node.x * scale;
    const y = centerY - node.y * scale;

    console.log('Centering on node:', node.properties?.name, 'at', node.x, node.y);

    currentSvg.transition()
        .duration(300)
        .call(currentZoom.transform, d3.zoomIdentity.translate(x, y).scale(scale));
}

// ============ MINIMAP ============

let minimapData = { nodes: [], bounds: null };

function updateMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    const container = document.getElementById('minimap');
    if (!canvas || !container) {
        return;
    }

    const width = 150;
    const height = 100;

    // Reset canvas (this also clears any transforms)
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear (transparent, container has background)
    ctx.clearRect(0, 0, width, height);

    // Use currentNodes which has x/y positions from D3 simulation
    if (!currentNodes || currentNodes.length === 0) return;

    // Calculate bounds of all nodes
    const nodes = currentNodes;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let hasPositions = false;

    nodes.forEach(n => {
        if (typeof n.x === 'number' && typeof n.y === 'number' && !isNaN(n.x) && !isNaN(n.y)) {
            minX = Math.min(minX, n.x);
            maxX = Math.max(maxX, n.x);
            minY = Math.min(minY, n.y);
            maxY = Math.max(maxY, n.y);
            hasPositions = true;
        }
    });

    if (!hasPositions) return; // No positioned nodes yet

    // Add padding
    const padding = 40;
    minX -= padding; maxX += padding;
    minY -= padding; maxY += padding;

    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;
    const scaleX = width / graphWidth;
    const scaleY = height / graphHeight;
    const scale = Math.min(scaleX, scaleY) * 0.9;

    const offsetX = (width - graphWidth * scale) / 2;
    const offsetY = (height - graphHeight * scale) / 2;

    // Store for viewport calculation
    minimapData = {
        nodes,
        bounds: { minX, maxX, minY, maxY, graphWidth, graphHeight },
        scale,
        offsetX,
        offsetY,
        canvasWidth: width,
        canvasHeight: height
    };

    // Draw links
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 0.5;
    if (merged_object.relationships) {
        merged_object.relationships.forEach(r => {
            const sourceId = r.source?.id ?? r.startNodeId ?? r.source;
            const targetId = r.target?.id ?? r.endNodeId ?? r.target;
            const source = typeof r.source === 'object' ? r.source : nodes.find(n => n.id === sourceId);
            const target = typeof r.target === 'object' ? r.target : nodes.find(n => n.id === targetId);
            if (source && target && typeof source.x === 'number' && typeof target.x === 'number') {
                const x1 = (source.x - minX) * scale + offsetX;
                const y1 = (source.y - minY) * scale + offsetY;
                const x2 = (target.x - minX) * scale + offsetX;
                const y2 = (target.y - minY) * scale + offsetY;
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            }
        });
    }

    // Draw nodes
    let drawnCount = 0;
    nodes.forEach(n => {
        if (typeof n.x === 'number' && typeof n.y === 'number') {
            const x = (n.x - minX) * scale + offsetX;
            const y = (n.y - minY) * scale + offsetY;
            ctx.beginPath();
            ctx.arc(x, y, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = n.labels?.[0] === 'Synthesis' ? '#ffd700' : '#ab47bc';
            ctx.fill();
            drawnCount++;
        }
    });

    console.log('Minimap: drew', drawnCount, 'nodes, scale:', scale.toFixed(3));

    // Update viewport indicator
    updateMinimapViewport();
}

function updateMinimapViewport() {
    const viewport = document.getElementById('minimap-viewport');
    const svgEl = document.querySelector('#graph svg');
    if (!viewport || !svgEl || !minimapData.bounds) return;

    const transform = d3.zoomTransform(svgEl);
    const svgRect = svgEl.getBoundingClientRect();
    const { minX, minY, graphWidth, graphHeight } = minimapData.bounds;
    const { scale, offsetX, offsetY, canvasWidth, canvasHeight } = minimapData;

    // Calculate visible area in graph coordinates
    const visibleLeft = (-transform.x) / transform.k;
    const visibleTop = (-transform.y) / transform.k;
    const visibleWidth = svgRect.width / transform.k;
    const visibleHeight = svgRect.height / transform.k;

    // Convert to minimap coordinates
    const vpLeft = (visibleLeft - minX) * scale + offsetX;
    const vpTop = (visibleTop - minY) * scale + offsetY;
    const vpWidth = visibleWidth * scale;
    const vpHeight = visibleHeight * scale;

    // Apply to viewport element
    viewport.style.left = Math.max(0, vpLeft) + 'px';
    viewport.style.top = Math.max(0, vpTop) + 'px';
    viewport.style.width = Math.min(vpWidth, canvasWidth) + 'px';
    viewport.style.height = Math.min(vpHeight, canvasHeight) + 'px';

    // Hide if zoomed out completely
    if (transform.k <= 1 && vpWidth >= canvasWidth * 0.9 && vpHeight >= canvasHeight * 0.9) {
        viewport.style.display = 'none';
    } else {
        viewport.style.display = 'block';
    }
}
