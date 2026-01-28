let unmerged_object = merged_object = nodePrompt = null;

// ============ UI LOGGING ============

let activityLog = []; // Stores all log entries for persistence

function logToPanel(type, action, details = {}) {
    const logContent = document.getElementById('log-content');
    if (!logContent) return;

    const timestamp = new Date().toISOString();
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Store entry in activity log
    const logEntry = { timestamp, type, action, details };
    activityLog.unshift(logEntry);

    // Keep only last 50 entries in memory
    if (activityLog.length > 50) {
        activityLog = activityLog.slice(0, 50);
    }

    // Persist to localStorage
    saveActivityLogToStorage();

    // Render to UI
    renderLogEntry(logContent, { time, type, action, details });
}

function renderLogEntry(logContent, { time, type, action, details }) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    let html = `<span class="log-time">${time}</span>`;
    html += `<div class="log-action">${action}</div>`;

    if (details.input) {
        html += `<div class="log-detail">Input: "${details.input.substring(0, 60)}${details.input.length > 60 ? '...' : ''}"</div>`;
    }
    if (details.focus) {
        html += `<div class="log-detail">Focus: ${details.focus}</div>`;
    }
    if (details.stats) {
        html += `<div class="log-stats">${details.stats}</div>`;
    }
    if (details.nodes && details.nodes.length > 0) {
        html += `<div class="log-nodes">+ ${details.nodes.slice(0, 5).join(', ')}${details.nodes.length > 5 ? ` (+${details.nodes.length - 5} more)` : ''}</div>`;
    }
    if (details.error) {
        html += `<div class="log-detail" style="color:#f44336">Error: ${details.error}</div>`;
    }
    if (details.synthesis) {
        html += `<button class="log-view-synthesis">View Synthesis</button>`;
    }

    entry.innerHTML = html;

    // Add click handler for synthesis view button
    if (details.synthesis) {
        const btn = entry.querySelector('.log-view-synthesis');
        if (btn) {
            btn.addEventListener('click', () => {
                showSynthesisModal(details.synthesis);
            });
        }
    }

    logContent.insertBefore(entry, logContent.firstChild);

    // Keep only last 50 entries in DOM
    while (logContent.children.length > 50) {
        logContent.removeChild(logContent.lastChild);
    }
}

function saveActivityLogToStorage() {
    try {
        localStorage.setItem('activityLog', JSON.stringify(activityLog));
    } catch (e) {
        console.warn('Could not save activity log to localStorage:', e);
    }
}

function loadActivityLogFromStorage() {
    try {
        const stored = localStorage.getItem('activityLog');
        if (stored) {
            activityLog = JSON.parse(stored);
            restoreLogToPanel();
        }
    } catch (e) {
        console.warn('Could not load activity log from localStorage:', e);
    }
}

function restoreLogToPanel() {
    const logContent = document.getElementById('log-content');
    if (!logContent) return;

    // Clear existing content
    logContent.innerHTML = '';

    // Restore entries (activityLog is already in newest-first order)
    activityLog.forEach(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        renderLogEntry(logContent, {
            time,
            type: entry.type,
            action: entry.action,
            details: entry.details
        });
    });
}

function getActivityLog() {
    return activityLog;
}

function setActivityLog(log) {
    activityLog = log || [];
    saveActivityLogToStorage();
    restoreLogToPanel();
}

function toggleLogPanel() {
    const panel = document.getElementById('log-panel');
    const toggle = document.getElementById('log-toggle');
    panel.classList.toggle('collapsed');
    toggle.textContent = panel.classList.contains('collapsed') ? '+' : '−';
    // Remove expanded when collapsing
    if (panel.classList.contains('collapsed')) {
        panel.classList.remove('expanded');
    }
}

function toggleLogExpand() {
    const panel = document.getElementById('log-panel');
    const expand = document.getElementById('log-expand');
    // Remove collapsed if present
    panel.classList.remove('collapsed');
    document.getElementById('log-toggle').textContent = '−';
    // Toggle expanded
    panel.classList.toggle('expanded');
    expand.textContent = panel.classList.contains('expanded') ? '⤡' : '⤢';
    expand.title = panel.classList.contains('expanded') ? 'Collapse' : 'Expand';
}

function registerPromptListeners() {
    nodePrompt = document.getElementById('text-container');
    const extractBtn = document.getElementById('extract-button');
    const generateBtn = document.getElementById('generate-button');

    // Enable/disable buttons based on text input
    function updateButtons() {
        const hasText = nodePrompt.value.trim().length > 0;
        if (hasText) {
            extractBtn.classList.remove('disabled');
            extractBtn.style.pointerEvents = 'auto';
            generateBtn.classList.remove('disabled');
            generateBtn.style.pointerEvents = 'auto';
        } else {
            extractBtn.classList.add('disabled');
            extractBtn.style.pointerEvents = 'none';
            generateBtn.classList.add('disabled');
            generateBtn.style.pointerEvents = 'none';
        }
    }

    nodePrompt.addEventListener('input', updateButtons);
    updateButtons(); // Initial state
}

// ============ PROMPTS ============

function getBasePrompt() {
    const userText = getVisibleText(document.getElementById('text-container'));
    return `Extract a knowledge graph from the text. Output ONLY valid JSON, nothing else.

NODE LABELS: Person, Organization, Place, Event, Process, Technology, Concept, Object, Action
RELATIONSHIPS: CAUSES, ENABLES, REQUIRES, PART_OF, INSTANCE_OF, CREATED_BY, USES, PRODUCES, LEADS_TO, DEPENDS_ON

TEXT: "${userText}"

JSON format: {"nodes":[{"id":1,"labels":["Type"],"properties":{"name":"...","description":"..."}}],"relationships":[{"id":1,"startNodeId":1,"endNodeId":2,"type":"VERB","properties":{}}]}

JSON:`;
}

function getGeneratePrompt() {
    const userPrompt = getVisibleText(document.getElementById('text-container'));
    return `You are a research ideation engine exploring design space and generating novel hypotheses. Output ONLY valid JSON.

RESEARCH DIRECTION: "${userPrompt}"

Your task - BUILD A DESIGN SPACE, not just summarize existing work:
1. Map foundational concepts that define the space
2. Identify unexplored regions, gaps, and opportunities
3. Generate novel hypotheses worth testing
4. Propose concrete architectural variations or mechanism experiments
5. Flag failure modes and detection signals for proposed ideas

NODE TYPES - Mix these:
- FOUNDATIONS: Established techniques, key papers (grounding: "established")
- FRONTIERS: Active research, open problems (grounding: "emerging")
- HYPOTHESES: Novel ideas YOU generate - testable claims about what might work (grounding: "speculative")
- MECHANISMS: Specific how-it-works proposals (grounding varies)
- FAILURE_MODES: What could go wrong with a hypothesis
- EXPERIMENTS: Concrete ways to test hypotheses

For speculative nodes, structure them like research contracts:
- "hypothesis": the testable claim
- "mechanism": how/why it might work
- "failure_modes": what would disprove it
- "detection": how to measure success
- "rationale": why it's worth exploring

GOOD speculative node: "Attention as Interrupt - hypothesis: attention can be gated to fire only at structural boundaries, reducing compute while preserving long-range capability. Mechanism: novelty gate trained with budget regularizer. Failure mode: always-on collapse. Detection: gate AUC vs boundary tokens."

BAD node: "Advanced attention mechanisms improve performance" (vague, not actionable)

NODE LABELS: Concept, Method, Hypothesis, Architecture, Mechanism, FailureMode, Experiment, Metric, Dataset, Person, Paper
RELATIONSHIPS: ENABLES, REQUIRES, TESTS, CONTRADICTS, EXTENDS, VARIANT_OF, FAILURE_MODE_OF, DETECTS, BUILDS_ON, COMPETES_WITH, COULD_COMBINE

Generate 10-20 nodes. Prioritize novel hypotheses and unexplored combinations over summarizing known work.

JSON format: {"nodes":[{"id":1,"labels":["Type"],"properties":{"name":"...","description":"...","grounding":"established|emerging|speculative","hypothesis":"...","mechanism":"...","failure_modes":"...","detection":"...","rationale":"..."}}],"relationships":[{"id":1,"startNodeId":1,"endNodeId":2,"type":"RELATIONSHIP_TYPE","properties":{}}]}

JSON:`;
}

// Focused prompt - only generates NEW nodes, not the full graph
function getNodeResearchPrompt(node) {
    return `Explore the design space around "${node.properties.name}" - generate hypotheses and variations. Output ONLY valid JSON.

FOCUS: ${node.properties.name} - ${node.properties.description || 'No description'}

Generate 5-10 NEW nodes that EXTEND the design space:
1. What variations of this concept haven't been tried?
2. What would happen if we combined this with X?
3. What's the failure mode? What would break it?
4. What experiment would test the core claim?
5. What's the opposite approach and when might it win?

Start node IDs at 1000, relationship IDs at 1000.
All relationships should connect to node ID 0 (the focus node) or to each other.

NODE MIX:
- 1-2 foundational nodes (established building blocks)
- 2-3 frontier nodes (open problems, recent work)
- 3-4 hypothesis nodes (YOUR novel proposals - be creative but concrete)
- 1-2 failure mode / experiment nodes

For hypothesis nodes, include:
- "hypothesis": the testable claim
- "mechanism": how/why it might work
- "detection": how to know if it's working
- "rationale": why worth exploring

GOOD: "Sparse Gating Hypothesis - attention could be gated by learned novelty signal, firing only at distributional surprises. Mechanism: entropy-based gate. Detection: gate correlation with boundary tokens."
BAD: "Better attention mechanisms could improve results" (not actionable)

JSON format: {"nodes":[{"id":1000,"labels":["Type"],"properties":{"name":"...","description":"...","grounding":"...","hypothesis":"...","mechanism":"...","detection":"...","rationale":"..."}}],"relationships":[{"id":1000,"startNodeId":0,"endNodeId":1000,"type":"VERB","properties":{}}]}

JSON:`;
}

function getExpandNodePrompt(node, existingNames) {
    return `Find NOVEL combinations between "${node.properties.name}" and other concepts. Output ONLY valid JSON.

FOCUS: ${node.properties.name} - ${node.properties.description || 'No description'}
EXISTING CONCEPTS: ${existingNames.join(', ')}

Generate 3-6 nodes that COMBINE concepts in unexplored ways:
- What happens if we apply technique A to domain B?
- What shared principle might unify these concepts?
- What hypothesis would test if these are actually related?
- What failure mode appears when combining these?

Start node IDs at 1000, relationship IDs at 1000.
Each new node should link to node ID 0 (focus) AND reference existing concept names.

BRIDGE TYPES:
- Combination hypotheses: "What if we used X's mechanism in Y's context?"
- Shared abstractions: underlying principle both instantiate
- Transfer experiments: test if insight from A applies to B
- Tension points: where these concepts might conflict

Mark each: "grounding": "established|emerging|speculative"
Include for speculative bridges:
- "hypothesis": the combination claim
- "mechanism": why the combination might work
- "experiment": how to test if the bridge is real
- "connectsTo": existing concept names (comma-separated)

BAD: "Both involve neural networks" (too vague)
GOOD: "Gating Mechanism Transfer - hypothesis: novelty gating from regime-switching could replace learned positional embeddings. Experiment: compare vs sinusoidal on length generalization."

JSON format: {"nodes":[{"id":1000,"labels":["Type"],"properties":{"name":"...","description":"...","grounding":"...","hypothesis":"...","mechanism":"...","experiment":"...","connectsTo":"Concept1,Concept2"}}],"relationships":[{"id":1000,"startNodeId":0,"endNodeId":1000,"type":"VERB","properties":{}}]}

JSON:`;
}

function getDialecticalPrompt(focusNodes = null) {
    const sourceNodes = focusNodes || merged_object.nodes;
    const nodeIds = new Set(sourceNodes.map(n => n.id));

    const nodes = sourceNodes.map(n => ({
        name: n.properties?.name || n.name,
        description: n.properties?.description || n.description,
        type: n.labels?.[0]
    }));

    // Only include relationships between focused nodes
    const relationships = merged_object.relationships
        .filter(r => nodeIds.has(r.startNodeId) && nodeIds.has(r.endNodeId))
        .map(r => {
            const source = merged_object.nodes.find(n => n.id === r.startNodeId);
            const target = merged_object.nodes.find(n => n.id === r.endNodeId);
            return {
                from: source?.properties?.name,
                to: target?.properties?.name,
                type: r.type
            };
        }).filter(r => r.from && r.to);

    const focusLabel = focusNodes ? ` (analyzing ${focusNodes.length} selected concepts)` : '';

    return `You are a research ideation engine using dialectical analysis to generate novel hypotheses${focusLabel}.

KNOWLEDGE GRAPH:
Concepts: ${JSON.stringify(nodes)}
Relationships: ${JSON.stringify(relationships)}

YOUR TASK - Find tensions and synthesize NEW RESEARCH DIRECTIONS:

1. THESIS: What's the dominant approach/assumption in this design space?
2. ANTITHESIS: What's the opposing approach, or what does the thesis sacrifice/ignore?
3. SYNTHESIS: Generate a NOVEL RESEARCH DIRECTION that:
   - Combines strengths of both
   - Proposes a concrete testable hypothesis
   - Specifies mechanism, failure modes, and detection signals

This is NOT about philosophical resolution - it's about generating actionable research hypotheses.

Output as JSON:
{
  "thesis": {
    "title": "Dominant Approach",
    "claim": "The prevailing assumption or technique",
    "tradeoff": "What this approach sacrifices"
  },
  "antithesis": {
    "title": "Alternative Approach",
    "claim": "The opposing technique or what's being ignored",
    "tradeoff": "What this approach sacrifices"
  },
  "synthesis": {
    "title": "Novel Research Direction",
    "hypothesis": "Testable claim combining both approaches",
    "mechanism": "How/why this synthesis might work",
    "experiment": "Concrete way to test this",
    "failure_modes": ["What could go wrong", "How we'd know it failed"],
    "success_signal": "What would indicate this works"
  },
  "newConcepts": [
    {"name": "...", "description": "...", "type": "hypothesis|mechanism|experiment|failure_mode"}
  ]
}

IMPORTANT: Generate 2-4 newConcepts as research contract components:

For each newConcept include:
- "name": specific, actionable
- "description": concrete mechanism or testable claim
- "grounding": "speculative" (these are novel proposals)
- "hypothesis": the testable claim (if applicable)
- "mechanism": how it would work
- "detection": how to measure success/failure
- "connectsTo": existing concept it relates to

For established/emerging concepts: include "reference" (paper/technique it builds on)
For speculative concepts: include "rationale" (why this creative leap is worth exploring)
For any concept: optionally include "testable" (how to validate)

REJECT synthesis concepts that are:
- Just restatements of the thesis/antithesis
- Vague resolutions like "balance both approaches"
- Buzzword salad without actual content

EMBRACE:
- Creative leaps clearly marked as speculative
- Novel combinations of existing ideas
- Hypotheses worth testing even if unproven
- Unexpected connections between distant concepts

JSON:`;
}

function getBatchResearchPrompt(nodes) {
    const concepts = nodes.map(n => ({
        name: n.properties.name,
        description: n.properties.description
    }));

    return `Explore the design space defined by these ${nodes.length} concepts. Generate hypotheses and research directions. Output ONLY valid JSON.

CONCEPTS DEFINING THE SPACE:
${concepts.map(c => `- ${c.name}: ${c.description || 'No description'}`).join('\n')}

Generate 8-15 NEW nodes that EXPAND the design space:

REQUIRED MIX:
- 2-3 Foundations: key techniques/papers these build on (grounding: "established")
- 2-3 Frontiers: open problems, recent work, active directions (grounding: "emerging")
- 4-6 Hypotheses: YOUR novel proposals - unexplored combinations, untested mechanisms (grounding: "speculative")
- 2-3 Research Infrastructure: experiments, metrics, failure modes, benchmarks

For HYPOTHESIS nodes (the most important), structure as research contracts:
- "hypothesis": the testable claim
- "mechanism": how/why it might work
- "failure_modes": what would disprove it
- "detection": how to measure success
- "connectsTo": which concepts it combines/extends

GOOD hypothesis: "Adaptive Compute Allocation - hypothesis: model could learn to route tokens to different depth subnetworks based on complexity. Mechanism: trained router predicts required depth. Failure mode: router collapse to single path. Detection: depth variance across token types."

BAD: "Better architectures improve performance" (not actionable)

Start node IDs at 1000, relationship IDs at 1000.

JSON format: {"nodes":[{"id":1000,"labels":["Hypothesis"],"properties":{"name":"...","description":"...","grounding":"speculative","hypothesis":"...","mechanism":"...","failure_modes":"...","detection":"...","connectsTo":"..."}}],"relationships":[]}

JSON:`;
}

function getBatchExpandPrompt(nodes) {
    const selectedNames = nodes.map(n => n.properties.name);
    const otherNames = merged_object.nodes
        .filter(n => !selectedNames.includes(n.properties.name))
        .map(n => n.properties.name)
        .slice(0, 15);

    return `Generate NOVEL COMBINATION HYPOTHESES connecting these concepts. Output ONLY valid JSON.

CONCEPTS TO COMBINE:
${selectedNames.join(', ')}

OTHER CONCEPTS AVAILABLE:
${otherNames.join(', ')}

Generate 5-10 COMBINATION HYPOTHESES - novel research directions that emerge from connecting these concepts:

For each combination, ask:
- What happens if we apply A's mechanism to B's problem?
- What shared principle might unify A and B?
- What experiment would test if A and B are actually related?
- Where might combining A and B fail interestingly?

Each node must include:
- "hypothesis": the testable combination claim
- "mechanism": why this combination might work
- "experiment": concrete test for the hypothesis
- "failure_modes": what could go wrong
- "connectsTo": comma-separated list of concepts being combined

Mark all as grounding: "speculative" (these are YOUR novel proposals)

BAD: "These concepts are related" (not actionable)
GOOD: "State-Space Attention Hybrid - hypothesis: Mamba's linear dynamics could handle local context while sparse attention fires only for long-range dependencies, getting best of both. Mechanism: novelty-gated attention over S4 backbone. Experiment: compare FLOPs vs accuracy on Long Range Arena. Failure mode: gate never learns meaningful triggers."

Start node IDs at 1000, relationship IDs at 1000.

JSON format: {"nodes":[{"id":1000,"labels":["Hypothesis"],"properties":{"name":"...","description":"...","grounding":"speculative","hypothesis":"...","mechanism":"...","experiment":"...","failure_modes":"...","connectsTo":"Concept1,Concept2"}}],"relationships":[]}

JSON:`;
}

function getResearchPrompt(focusNodes = null) {
    const nodes = focusNodes || merged_object.nodes;
    const nodeNames = nodes.map(n => n.properties?.name || n.name);
    const focusLabel = focusNodes ? ` (focused on ${focusNodes.length} selected)` : '';
    return `Generate research directions and hypotheses extending these concepts${focusLabel}. Output ONLY valid JSON.

CURRENT CONCEPTS: ${nodeNames.join(', ')}

Generate 5-10 NEW nodes that push the design space forward:

PRIORITIZE HYPOTHESIS GENERATION:
- What variations haven't been tried?
- What would happen if we combined X with Y?
- What's the failure mode of the current approach?
- What experiment would reveal the mechanism?
- What's the opposite approach and when might it win?

Node types to generate:
- Hypotheses: novel testable claims (most important!)
- Mechanisms: specific how-it-works proposals
- Experiments: ways to test hypotheses
- Failure modes: what could break
- Alternatives: opposing approaches worth considering

For hypothesis nodes, include:
- "hypothesis": the testable claim
- "mechanism": how/why it might work
- "detection": how to measure success/failure
- "failure_modes": what would disprove it
- "connectsTo": which concepts it extends

GOOD: "Early-Exit Gating - hypothesis: simple tokens could exit early via learned confidence gate, saving compute. Mechanism: per-layer classifier predicting 'done'. Failure mode: calibration drift. Detection: exit depth vs token entropy."
BAD: "More efficient architectures are better" (not actionable)

Start node IDs at 1000, relationship IDs at 1000.

JSON format: {"nodes":[{"id":1000,"labels":["Hypothesis"],"properties":{"name":"...","grounding":"speculative","hypothesis":"...","mechanism":"...","detection":"...","failure_modes":"...","connectsTo":"..."}}],"relationships":[]}

JSON:`;
}

// ============ UTILITIES ============

function getNextIds() {
    const maxNodeId = merged_object?.nodes?.length > 0
        ? Math.max(...merged_object.nodes.map(n => n.id))
        : 0;
    const maxRelId = merged_object?.relationships?.length > 0
        ? Math.max(...merged_object.relationships.map(r => r.id))
        : 0;
    return { nodeId: maxNodeId + 1, relId: maxRelId + 1 };
}

function mergeNewNodes(newGraph, focusNodeId = null, action = 'merge') {
    if (!merged_object) {
        merged_object = { nodes: [], relationships: [] };
    }

    if (!newGraph || !newGraph.nodes) {
        console.error('Invalid newGraph:', newGraph);
        return merged_object;
    }

    const beforeNodes = merged_object.nodes.length;
    const beforeRels = merged_object.relationships.length;

    const { nodeId: startNodeId, relId: startRelId } = getNextIds();
    const idMap = {}; // Map old IDs to new IDs

    // Map ID 0 to focus node if provided
    if (focusNodeId !== null) {
        idMap[0] = focusNodeId;
    }

    // Add new nodes with remapped IDs
    newGraph.nodes.forEach((node, i) => {
        const newId = startNodeId + i;
        idMap[node.id] = newId;

        // Check if "connectsTo" references existing nodes (can be comma-separated)
        if (node.properties.connectsTo) {
            const connectNames = node.properties.connectsTo.split(',').map(s => s.trim().toLowerCase());
            connectNames.forEach((connectName, j) => {
                const existingNode = merged_object.nodes.find(
                    n => n.properties.name.toLowerCase() === connectName
                );
                if (existingNode) {
                    // Create relationship to existing node
                    newGraph.relationships.push({
                        id: 9000 + i * 10 + j,
                        startNodeId: node.id,
                        endNodeId: existingNode.id,
                        type: 'CONNECTS_TO',
                        properties: {}
                    });
                    idMap[existingNode.id] = existingNode.id; // Keep existing ID
                }
            });
            delete node.properties.connectsTo;
        }

        merged_object.nodes.push({
            ...node,
            id: newId
        });
    });

    // Add new relationships with remapped IDs
    (newGraph.relationships || []).forEach((rel, i) => {
        const sourceId = idMap[rel.startNodeId] ?? rel.startNodeId;
        const targetId = idMap[rel.endNodeId] ?? rel.endNodeId;

        // Only add if both nodes exist
        const sourceExists = merged_object.nodes.some(n => n.id === sourceId);
        const targetExists = merged_object.nodes.some(n => n.id === targetId);

        if (sourceExists && targetExists) {
            merged_object.relationships.push({
                ...rel,
                id: startRelId + i,
                startNodeId: sourceId,
                endNodeId: targetId
            });
        }
    });

    // Log changes
    const addedNodes = newGraph.nodes.map(n => n.properties.name);
    const afterNodes = merged_object.nodes.length;
    const afterRels = merged_object.relationships.length;

    logToPanel('result', `${action.charAt(0).toUpperCase() + action.slice(1)} Complete`, {
        stats: `Nodes: ${beforeNodes} → ${afterNodes} (+${afterNodes - beforeNodes}) | Rels: ${beforeRels} → ${afterRels}`,
        nodes: addedNodes
    });

    return merged_object;
}

function parseJsonString(jsonString) {
    console.log('Parsing:', jsonString);

    // Remove markdown code blocks if present
    jsonString = jsonString.replace(/```json\n?/g, '').replace(/```\n?/g, '');

    // Extract JSON object
    const match = jsonString.match(/\{[\s\S]*\}/);
    if (match) {
        jsonString = match[0];
    }

    // Clean whitespace outside quotes
    jsonString = jsonString.replace(/"[^"]*"|[\s]+/g, function(match) {
        if (match[0] === '"') return match;
        return '';
    });

    // Quote unquoted keys
    jsonString = jsonString.replace(/,(\w+):/g, ',"$1":');
    jsonString = jsonString.replace(/{(\w+):/g, '{"$1":');

    return JSON.parse(jsonString);
}

function getVisibleText(node) {
    // Handle textarea
    if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') {
        return node.value;
    }
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
    } else if (node.tagName == "BR") {
        return '\r';
    }
    var style = getComputedStyle(node);
    if (style && style.position === 'absolute') return '';
    var text = '';
    for (var i = 0; i < node.childNodes.length; i++)
        text += getVisibleText(node.childNodes[i]);
    return text;
}

// ============ API CALLS ============

function callClaude(prompt) {
    return fetch("http://localhost:8765/v1/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            prompt: prompt,
            model: "claude-opus-4-5-20251101"
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        return parseJsonString(data.choices[0].text);
    });
}

function generateGraph() {
    const inputText = getVisibleText(document.getElementById('text-container'));
    logToPanel('action', 'Generate Graph', { input: inputText });

    setLoading();
    callClaude(getGeneratePrompt())
        .then(graph => {
            if (!merged_object) {
                merged_object = graph;
            } else {
                // Merge into existing graph
                mergeNewNodes(graph, null, 'generate');
            }
            logToPanel('result', 'Graph Generated', {
                stats: `${graph.nodes.length} nodes, ${graph.relationships.length} relationships`,
                nodes: graph.nodes.map(n => n.properties.name)
            });
            renderGraph(merged_object);
            // Clear the input after successful generation
            document.getElementById('text-container').value = '';
            document.getElementById('text-container').dispatchEvent(new Event('input'));
            unsetLoading();
        })
        .catch(error => {
            logToPanel('error', 'Generate Failed', { error: error.message });
            unsetLoading();
        });
}

function getObject() {
    const inputText = getVisibleText(document.getElementById('text-container'));
    logToPanel('action', 'Merge Text', { input: inputText });

    setLoading();
    callClaude(getBasePrompt())
        .then(graph => {
            if (!merged_object) {
                merged_object = graph;
                logToPanel('result', 'Graph Created', {
                    stats: `${graph.nodes.length} nodes, ${graph.relationships.length} relationships`,
                    nodes: graph.nodes.map(n => n.properties.name)
                });
            } else {
                mergeNewNodes(graph, null, 'merge');
            }
            renderGraph(merged_object);
            // Clear the input after successful merge
            document.getElementById('text-container').value = '';
            document.getElementById('text-container').dispatchEvent(new Event('input'));
            unsetLoading();
        })
        .catch(error => {
            logToPanel('error', 'Merge Failed', { error: error.message });
            unsetLoading();
        });
}

function researchGraph() {
    if (!merged_object?.nodes?.length) {
        alert('Create a graph first');
        return;
    }

    // Check for filtered nodes from search
    const focusNodes = typeof getFilteredNodes === 'function' ? getFilteredNodes() : null;
    const targetCount = focusNodes ? focusNodes.length : merged_object.nodes.length;
    const focusLabel = focusNodes ? ' (filtered)' : '';

    logToPanel('action', 'Expand Graph' + focusLabel, {
        input: `Expanding ${targetCount} concepts`
    });

    setLoading();
    callClaude(getResearchPrompt(focusNodes))
        .then(newGraph => {
            mergeNewNodes(newGraph, null, 'research');
            renderGraph(merged_object);
            clearSearch?.(); // Clear search after operation
            unsetLoading();
        })
        .catch(error => {
            logToPanel('error', 'Expand Failed', { error: error.message });
            unsetLoading();
        });
}

function researchFromNode(nodeId) {
    const node = merged_object.nodes.find(n => n.id === nodeId);
    if (!node) return;

    logToPanel('action', 'Research Node', { focus: node.properties.name });

    hideNodePopup();
    setLoading();

    callClaude(getNodeResearchPrompt(node))
        .then(newGraph => {
            mergeNewNodes(newGraph, nodeId, 'research-node');
            renderGraph(merged_object);
            unsetLoading();
        })
        .catch(error => {
            logToPanel('error', 'Research Failed', { error: error.message });
            unsetLoading();
        });
}

function expandNode(nodeId) {
    const node = merged_object.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const existingNames = merged_object.nodes
        .filter(n => n.id !== nodeId)
        .map(n => n.properties.name)
        .slice(0, 20);

    logToPanel('action', 'Expand Connections', { focus: node.properties.name });

    hideNodePopup();
    setLoading();

    callClaude(getExpandNodePrompt(node, existingNames))
        .then(newGraph => {
            mergeNewNodes(newGraph, nodeId, 'expand');
            renderGraph(merged_object);
            unsetLoading();
        })
        .catch(error => {
            logToPanel('error', 'Expand Failed', { error: error.message });
            unsetLoading();
        });
}

// ============ DELETE NODE ============

function deleteNode(nodeId) {
    const node = merged_object.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const nodeName = node.properties.name;

    // Remove the node
    merged_object.nodes = merged_object.nodes.filter(n => n.id !== nodeId);

    // Remove relationships connected to this node
    const removedRels = merged_object.relationships.filter(
        r => r.startNodeId === nodeId || r.endNodeId === nodeId
    ).length;

    merged_object.relationships = merged_object.relationships.filter(
        r => r.startNodeId !== nodeId && r.endNodeId !== nodeId
    );

    hideNodePopup();

    logToPanel('result', 'Node Deleted', {
        stats: `Removed "${nodeName}" and ${removedRels} relationships`,
        nodes: []
    });

    renderGraph(merged_object);
}

// ============ DIALECTICAL SYNTHESIS ============

function runDialecticalSynthesis() {
    // Check for filtered nodes from search
    const focusNodes = typeof getFilteredNodes === 'function' ? getFilteredNodes() : null;
    const targetNodes = focusNodes || merged_object?.nodes;

    if (!targetNodes?.length || targetNodes.length < 3) {
        alert('Need at least 3 concepts for dialectical synthesis' + (focusNodes ? ' (try selecting more nodes)' : ''));
        return;
    }

    const focusLabel = focusNodes ? ' (filtered)' : '';

    logToPanel('action', 'Synthesize' + focusLabel, {
        input: `Analyzing ${targetNodes.length} concepts for thesis/antithesis`
    });

    setLoading();

    fetch("http://localhost:8765/v1/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            prompt: getDialecticalPrompt(focusNodes),
            model: "claude-opus-4-5-20251101"
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

        // Parse the response
        let text = data.choices[0].text;
        let jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) text = jsonMatch[0];

        const synthesis = JSON.parse(text);
        showSynthesisModal(synthesis);

        // Add new concepts to graph if any
        if (synthesis.newConcepts && synthesis.newConcepts.length > 0) {
            const newGraph = {
                nodes: synthesis.newConcepts.map((c, i) => ({
                    id: 1000 + i,
                    labels: ['Synthesis'],
                    properties: {
                        name: c.name,
                        description: c.description,
                        connectsTo: c.connectsTo
                    }
                })),
                relationships: []
            };
            mergeNewNodes(newGraph, null, 'synthesis');
            renderGraph(merged_object);
            clearSearch?.(); // Clear search after operation
        }

        logToPanel('result', 'Synthesis Complete', {
            stats: `Generated: ${synthesis.synthesis?.title || 'New insight'}`,
            nodes: synthesis.newConcepts?.map(c => c.name) || [],
            synthesis: synthesis
        });

        unsetLoading();
    })
    .catch(error => {
        logToPanel('error', 'Synthesis Failed', { error: error.message });
        console.error('Synthesis error:', error);
        unsetLoading();
    });
}

function showSynthesisModal(synthesis) {
    hideSynthesisModal();

    const modal = document.createElement('div');
    modal.id = 'synthesis-modal';
    modal.innerHTML = `
        <div class="synthesis-content">
            <div class="synthesis-header">
                <span>Dialectical Synthesis</span>
                <span class="synthesis-close" onclick="hideSynthesisModal()">&times;</span>
            </div>

            <div class="synthesis-section thesis">
                <div class="section-label">THESIS</div>
                <div class="section-title">${synthesis.thesis?.title || 'Thesis'}</div>
                <div class="section-claim">${synthesis.thesis?.claim || ''}</div>
                <div class="section-evidence">${(synthesis.thesis?.evidence || []).join(' · ')}</div>
            </div>

            <div class="synthesis-arrow">↓ contradicts ↓</div>

            <div class="synthesis-section antithesis">
                <div class="section-label">ANTITHESIS</div>
                <div class="section-title">${synthesis.antithesis?.title || 'Antithesis'}</div>
                <div class="section-claim">${synthesis.antithesis?.claim || ''}</div>
                <div class="section-evidence">${(synthesis.antithesis?.evidence || []).join(' · ')}</div>
            </div>

            <div class="synthesis-arrow">↓ transcends ↓</div>

            <div class="synthesis-section synthesis-result">
                <div class="section-label">SYNTHESIS</div>
                <div class="section-title">${synthesis.synthesis?.title || 'Synthesis'}</div>
                <div class="section-hypothesis"><strong>Hypothesis:</strong> ${synthesis.synthesis?.hypothesis || ''}</div>
                <div class="section-mechanism"><strong>Mechanism:</strong> ${synthesis.synthesis?.mechanism || ''}</div>
                <div class="section-experiment"><strong>Experiment:</strong> ${synthesis.synthesis?.experiment || ''}</div>
                <div class="section-failure-modes">
                    <strong>Failure modes:</strong>
                    <ul>${(synthesis.synthesis?.failure_modes || []).map(f => `<li>${f}</li>`).join('')}</ul>
                </div>
                <div class="section-success"><strong>Success signal:</strong> ${synthesis.synthesis?.success_signal || ''}</div>
            </div>

            ${synthesis.newConcepts?.length > 0 ? `
            <div class="synthesis-new-concepts">
                <div class="section-label">NEW CONCEPTS ADDED TO GRAPH</div>
                ${synthesis.newConcepts.map(c => `<span class="new-concept">${c.name}</span>`).join('')}
            </div>
            ` : ''}
        </div>
    `;

    document.body.appendChild(modal);
}

function hideSynthesisModal() {
    const existing = document.getElementById('synthesis-modal');
    if (existing) existing.remove();
}

// ============ UI STATE ============

function setLoading() {
    document.getElementById('prompt-container').classList.add('loading');
}

function unsetLoading() {
    document.getElementById('prompt-container').classList.remove('loading');
}

// ============ AI SUGGEST & AUTO MODE ============

let autoMode = false;
let currentSuggestion = null;
let autoIterations = 0;
const MAX_AUTO_ITERATIONS = 20; // Safety limit

function getSuggestPrompt() {
    const nodes = merged_object.nodes.map(n => ({
        id: n.id,
        name: n.properties.name,
        description: n.properties.description,
        type: n.labels?.[0]
    }));
    const relationships = merged_object.relationships.map(r => {
        const source = merged_object.nodes.find(n => n.id === r.startNodeId);
        const target = merged_object.nodes.find(n => n.id === r.endNodeId);
        return { from: source?.properties?.name, to: target?.properties?.name, type: r.type };
    }).filter(r => r.from && r.to);

    // Track recent actions to encourage variety
    const recentActions = activityLog
        .filter(e => e.action?.includes('Executing:'))
        .slice(0, 5)
        .map(e => e.action.includes('expand') ? 'expand' : 'synthesize');
    const recentExpands = recentActions.filter(a => a === 'expand').length;
    const recentSynths = recentActions.filter(a => a === 'synthesize').length;

    let varietyHint = '';
    if (recentSynths > recentExpands + 1) {
        varietyHint = '\n\nNOTE: Recent actions have been mostly synthesis. Consider expanding to add new knowledge first.';
    } else if (recentExpands > recentSynths + 2) {
        varietyHint = '\n\nNOTE: The graph has grown recently. Consider synthesis to find insights in existing nodes.';
    }

    return `You are a research assistant analyzing a knowledge graph to suggest the next research action.

CURRENT KNOWLEDGE GRAPH:
Nodes (${nodes.length}): ${JSON.stringify(nodes)}
Relationships (${relationships.length}): ${JSON.stringify(relationships)}

Suggest ONE action to improve the graph:

AVAILABLE ACTIONS:
1. "expand" - Add new related concepts to specific nodes. USE THIS TO:
   - Grow underdeveloped areas of the graph
   - Add depth to shallow concepts
   - Bring in new knowledge and connections
   - Generally preferred when graph is small or sparse

2. "synthesize" - Find tensions between concepts to generate insights. USE THIS TO:
   - Discover contradictions or dialectical tensions
   - Generate novel concepts from opposing ideas
   - Best when graph has 15+ nodes with diverse concepts
${varietyHint}

Output JSON:
{
  "action": "expand" or "synthesize",
  "targetNodes": ["Node Name 1", "Node Name 2", ...],
  "reasoning": "Brief explanation",
  "expectedOutcome": "What this will add"
}

JSON:`;
}

function suggestNextAction() {
    if (!merged_object?.nodes?.length || merged_object.nodes.length < 2) {
        if (!autoMode) alert('Need at least 2 nodes in the graph for suggestions');
        return;
    }

    // Safety check for auto mode
    if (autoMode && autoIterations >= MAX_AUTO_ITERATIONS) {
        logToPanel('action', 'Auto Mode Paused', { input: `Reached ${MAX_AUTO_ITERATIONS} iterations - pausing for review` });
        toggleAutoMode();
        return;
    }

    const iterLabel = autoMode ? ` [${autoIterations + 1}/${MAX_AUTO_ITERATIONS}]` : '';
    logToPanel('action', 'Getting AI Suggestion' + iterLabel, {
        input: `Analyzing ${merged_object.nodes.length} nodes for research opportunities`
    });

    setLoading();

    callClaude(getSuggestPrompt())
        .then(response => {
            // Parse the suggestion
            let text = typeof response === 'string' ? response : JSON.stringify(response);
            let jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) text = jsonMatch[0];

            currentSuggestion = JSON.parse(text);

            logToPanel('result', 'Suggestion Ready', {
                stats: `${currentSuggestion.action} on ${currentSuggestion.targetNodes?.length || 0} nodes`
            });

            if (autoMode) {
                // Auto mode: execute immediately without showing panel
                autoIterations++;
                unsetLoading();
                executeSuggestion();
            } else {
                // Manual mode: show panel for user decision
                showSuggestionPanel(currentSuggestion);
                unsetLoading();
            }
        })
        .catch(error => {
            logToPanel('error', 'Suggestion Failed', { error: error.message });
            unsetLoading();
            if (autoMode) {
                // Retry after error in auto mode
                setTimeout(suggestNextAction, 3000);
            }
        });
}

function showSuggestionPanel(suggestion) {
    const panel = document.getElementById('suggestion-panel');
    const content = document.getElementById('suggestion-content');

    const actionClass = suggestion.action === 'expand' ? 'expand' : 'synthesize';
    const actionLabel = suggestion.action === 'expand' ? 'Expand' : 'Synthesize';

    content.innerHTML = `
        <span class="suggestion-action-type ${actionClass}">${actionLabel}</span>
        <div class="suggestion-nodes">
            <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-bottom:6px;">TARGET NODES</div>
            ${(suggestion.targetNodes || []).map(n => `<span class="suggestion-node-tag">${n}</span>`).join('')}
        </div>
        <div><strong>Expected:</strong> ${suggestion.expectedOutcome || 'New insights'}</div>
        <div class="suggestion-reasoning">"${suggestion.reasoning || 'AI recommendation'}"</div>
    `;

    panel.classList.add('visible');
}

function closeSuggestion() {
    document.getElementById('suggestion-panel').classList.remove('visible');
    currentSuggestion = null;
}

function skipSuggestion() {
    closeSuggestion();
    // Get another suggestion
    setTimeout(suggestNextAction, 500);
}

function executeSuggestion() {
    if (!currentSuggestion) return;

    const suggestion = currentSuggestion;
    closeSuggestion();

    // Find the nodes by name
    const targetNodes = suggestion.targetNodes
        ?.map(name => merged_object.nodes.find(n =>
            n.properties.name.toLowerCase() === name.toLowerCase()
        ))
        .filter(Boolean) || [];

    if (targetNodes.length === 0) {
        logToPanel('error', 'Execution Failed', { error: 'Could not find target nodes' });
        return;
    }

    logToPanel('action', `Executing: ${suggestion.action}`, {
        input: `${targetNodes.length} nodes: ${targetNodes.map(n => n.properties.name).join(', ')}`
    });

    setLoading();

    if (suggestion.action === 'expand') {
        // Use batch expand with the target nodes
        const prompt = getBatchExpandPrompt(targetNodes);
        callClaude(prompt)
            .then(newGraph => {
                mergeNewNodes(newGraph, null, 'ai-expand');
                renderGraph(merged_object);
                unsetLoading();
                onSuggestionExecuted();
            })
            .catch(error => {
                logToPanel('error', 'Expand Failed', { error: error.message });
                unsetLoading();
            });
    } else if (suggestion.action === 'synthesize') {
        // Use dialectical synthesis with target nodes
        fetch("http://localhost:8765/v1/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                prompt: getDialecticalPrompt(targetNodes),
                model: "claude-opus-4-5-20251101"
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) throw new Error(data.error.message);
            let text = data.choices[0].text;
            let jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) text = jsonMatch[0];

            const synthesis = JSON.parse(text);

            if (synthesis.newConcepts?.length > 0) {
                const newGraph = {
                    nodes: synthesis.newConcepts.map((c, i) => ({
                        id: 1000 + i,
                        labels: ['Synthesis'],
                        properties: { name: c.name, description: c.description, connectsTo: c.connectsTo }
                    })),
                    relationships: []
                };
                mergeNewNodes(newGraph, null, 'ai-synthesis');
                renderGraph(merged_object);
            }

            logToPanel('result', 'Synthesis Complete', {
                stats: synthesis.synthesis?.title || 'New insight',
                nodes: synthesis.newConcepts?.map(c => c.name) || [],
                synthesis: synthesis
            });

            unsetLoading();
            onSuggestionExecuted();
        })
        .catch(error => {
            logToPanel('error', 'Synthesis Failed', { error: error.message });
            unsetLoading();
        });
    }
}

function onSuggestionExecuted() {
    if (autoMode) {
        // Continue auto mode - get next suggestion after a delay
        setTimeout(suggestNextAction, 2000);
    }
}

// ============ GROUNDING CHECK ============

function getGroundingCheckPrompt(nodes) {
    const nodeList = nodes.map(n => ({
        id: n.id,
        name: n.properties?.name || n.name,
        description: n.properties?.description || '',
        grounding: n.properties?.grounding || 'unknown',
        hypothesis: n.properties?.hypothesis || null,
        mechanism: n.properties?.mechanism || null,
        detection: n.properties?.detection || null,
        failure_modes: n.properties?.failure_modes || null,
        reference: n.properties?.reference || null
    }));

    return `You are a research quality auditor evaluating concepts for actionability and rigor.

CONCEPTS TO EVALUATE:
${nodeList.map(n => `[ID:${n.id}] ${n.name} (${n.grounding}): ${n.description}${n.hypothesis ? ' | Hypothesis: ' + n.hypothesis : ''}${n.mechanism ? ' | Mechanism: ' + n.mechanism : ''}${n.detection ? ' | Detection: ' + n.detection : ''}`).join('\n')}

EVALUATION CRITERIA BY TYPE:

For ESTABLISHED concepts:
- Does the reference exist and is it relevant?
- Is the description accurate and specific?

For HYPOTHESIS concepts (most important - this tool is for research ideation):
- TESTABILITY: Is there a concrete experiment that could falsify this?
- MECHANISM: Is there a proposed how/why, not just what?
- FAILURE MODES: Are potential failure modes identified?
- ACTIONABILITY: Could a researcher actually implement and test this?
- NOVELTY: Is this a genuinely new direction, not just restating existing work?

VERDICTS:
- "grounded": Well-formed hypothesis with mechanism + testability, OR established fact with solid reference
- "weak": Has a kernel of an idea but needs mechanism, test, or failure mode
- "ungrounded": Vague buzzword, untestable claim, or empty jargon

Output JSON:
{
  "evaluations": [
    {
      "id": <node_id>,
      "name": "<name>",
      "type": "established|hypothesis|mechanism|experiment",
      "score": 0-3,
      "tests": {
        "testability": {"pass": true/false, "note": "can it be falsified?"},
        "mechanism": {"pass": true/false, "note": "is there a how/why?"},
        "failure_modes": {"pass": true/false, "note": "are failure modes identified?"},
        "actionability": {"pass": true/false, "note": "could someone implement this?"},
        "novelty": {"pass": true/false, "note": "is this actually new?"}
      },
      "verdict": "grounded|weak|ungrounded",
      "recommendation": "keep|strengthen|revise|prune",
      "suggestion": "specific improvement (e.g., 'add failure mode for X', 'specify detection metric')"
    }
  ],
  "summary": {
    "total": <n>,
    "grounded": <n>,
    "weak": <n>,
    "ungrounded": <n>,
    "actionable_hypotheses": <n>
  }
}

Be supportive of novel ideas but demanding about structure. A creative hypothesis needs mechanism + test + failure mode to be actionable.
JSON:`;
}

async function runGroundingCheck(targetNodes = null) {
    const nodes = targetNodes || merged_object?.nodes;

    if (!nodes?.length) {
        alert('No nodes to check');
        return;
    }

    // Filter to only unaudited nodes (unless targetNodes specified)
    const nodesToCheck = targetNodes ? nodes : nodes.filter(n => !n.properties?._groundingVerdict);

    if (!nodesToCheck.length) {
        alert('All nodes have already been audited! Click a node to see its audit results.');
        return;
    }

    // Check in batches of 10
    const batchSize = 10;
    const batches = [];
    for (let i = 0; i < nodesToCheck.length; i += batchSize) {
        batches.push(nodesToCheck.slice(i, i + batchSize));
    }

    logToPanel('action', 'Grounding Check', {
        input: `Evaluating ${nodesToCheck.length} concepts for epistemic rigor`
    });

    setLoading();

    // Show progress bar
    showAuditProgress(0, nodesToCheck.length);

    try {
        const allEvaluations = [];
        let processedCount = 0;

        for (const batch of batches) {
            const response = await fetch("http://localhost:8765/v1/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: getGroundingCheckPrompt(batch),
                    model: "claude-opus-4-5-20251101"
                })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error.message);

            const text = data.choices[0].text;
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                allEvaluations.push(...(result.evaluations || []));
            }

            // Update progress
            processedCount += batch.length;
            updateAuditProgress(processedCount, nodesToCheck.length, batch.map(n => n.properties?.name || n.name));
        }

        // Update nodes with grounding status
        allEvaluations.forEach(evalItem => {
            const node = merged_object.nodes.find(n => n.id === evalItem.id);
            if (node) {
                node.properties = node.properties || {};
                node.properties._groundingScore = evalItem.score;
                node.properties._groundingVerdict = evalItem.verdict;
                node.properties._groundingType = evalItem.type;
                node.properties._groundingTests = JSON.stringify(evalItem.tests || {});
                node.properties._groundingSuggestion = evalItem.suggestion;
                node.properties._groundingRecommendation = evalItem.recommendation;
                node.properties._auditedAt = Date.now();
            }
        });

        // Count results
        const grounded = allEvaluations.filter(e => e.verdict === 'grounded').length;
        const weak = allEvaluations.filter(e => e.verdict === 'weak').length;
        const ungrounded = allEvaluations.filter(e => e.verdict === 'ungrounded').length;

        // Show results modal
        showGroundingResults(allEvaluations);

        logToPanel('result', 'Grounding Check Complete', {
            stats: `✓ ${grounded} grounded · ⚠ ${weak} weak · ✗ ${ungrounded} ungrounded`
        });

        // Re-render to show grounding status
        renderGraph(merged_object);

        // Save to IndexedDB
        triggerAutoSave();

        unsetLoading();
        hideAuditProgress();
        return allEvaluations;

    } catch (error) {
        logToPanel('error', 'Grounding Check Failed', { error: error.message });
        unsetLoading();
        hideAuditProgress();
    }
}

function showAuditProgress(current, total) {
    let progressBar = document.getElementById('audit-progress');
    if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.id = 'audit-progress';
        progressBar.innerHTML = `
            <div class="audit-progress-inner">
                <div class="audit-header">
                    <span class="audit-title">Auditing Concepts</span>
                    <span class="audit-count">0/${total}</span>
                </div>
                <div class="audit-bar-container">
                    <div class="audit-bar" style="width: 0%"></div>
                </div>
                <div class="audit-current">Starting...</div>
            </div>
        `;
        document.body.appendChild(progressBar);
    }
    updateAuditProgress(current, total, []);
}

function updateAuditProgress(current, total, currentBatch = []) {
    const progressBar = document.getElementById('audit-progress');
    if (!progressBar) return;

    const percent = Math.round((current / total) * 100);
    progressBar.querySelector('.audit-count').textContent = `${current}/${total}`;
    progressBar.querySelector('.audit-bar').style.width = `${percent}%`;
    progressBar.querySelector('.audit-current').textContent =
        currentBatch.length > 0
            ? `Evaluating: ${currentBatch.slice(0, 2).join(', ')}${currentBatch.length > 2 ? '...' : ''}`
            : 'Processing...';
}

function hideAuditProgress() {
    const progressBar = document.getElementById('audit-progress');
    if (progressBar) {
        progressBar.classList.add('fade-out');
        setTimeout(() => progressBar.remove(), 500);
    }
}

function showGroundingResults(evaluations) {
    const existing = document.getElementById('grounding-modal');
    if (existing) existing.remove();

    const grounded = evaluations.filter(e => e.verdict === 'grounded');
    const weak = evaluations.filter(e => e.verdict === 'weak');
    const ungrounded = evaluations.filter(e => e.verdict === 'ungrounded');

    const modal = document.createElement('div');
    modal.id = 'grounding-modal';
    modal.innerHTML = `
        <div class="grounding-content">
            <div class="grounding-header">
                <span>Grounding Audit</span>
                <span class="grounding-close" onclick="hideGroundingModal()">&times;</span>
            </div>
            <div class="grounding-summary">
                <div class="grounding-stat grounded">
                    <span class="stat-num">${grounded.length}</span>
                    <span class="stat-label">Grounded</span>
                </div>
                <div class="grounding-stat weak">
                    <span class="stat-num">${weak.length}</span>
                    <span class="stat-label">Weak</span>
                </div>
                <div class="grounding-stat ungrounded">
                    <span class="stat-num">${ungrounded.length}</span>
                    <span class="stat-label">Ungrounded</span>
                </div>
            </div>
            <div class="grounding-body">
                ${ungrounded.length > 0 ? `
                    <div class="grounding-section">
                        <div class="section-title ungrounded">⚠ Ungrounded - Consider Pruning</div>
                        ${ungrounded.map(e => renderGroundingItem(e)).join('')}
                    </div>
                ` : ''}
                ${weak.length > 0 ? `
                    <div class="grounding-section">
                        <div class="section-title weak">⚡ Weak - Needs Revision</div>
                        ${weak.map(e => renderGroundingItem(e)).join('')}
                    </div>
                ` : ''}
                ${grounded.length > 0 ? `
                    <div class="grounding-section collapsed">
                        <div class="section-title grounded" onclick="this.parentElement.classList.toggle('collapsed')">
                            ✓ Grounded (${grounded.length}) <span class="expand-hint">click to expand</span>
                        </div>
                        <div class="section-items">
                            ${grounded.map(e => renderGroundingItem(e)).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
            <div class="grounding-actions">
                <button class="grounding-btn" onclick="pruneUngrounded()">Prune Ungrounded</button>
                <button class="grounding-btn secondary" onclick="hideGroundingModal()">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function renderGroundingItem(evalItem) {
    const tests = evalItem.tests || {};
    const nodeType = evalItem.type || 'unknown';
    const badgeClass = evalItem.verdict === 'ungrounded' ? 'ungrounded' :
                       evalItem.verdict === 'weak' ? 'weak' :
                       nodeType === 'hypothesis' ? 'speculative' : 'established';

    // Build test results - show research quality tests
    const testResults = [];
    const testOrder = ['testability', 'mechanism', 'failure_modes', 'actionability', 'novelty', 'literature', 'experiment', 'deflation', 'coherence', 'fertility'];

    for (const testName of testOrder) {
        if (tests[testName]?.pass !== undefined) {
            const displayName = testName.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            testResults.push(`<div class="test ${tests[testName]?.pass ? 'pass' : 'fail'}">
                <span class="test-icon">${tests[testName]?.pass ? '✓' : '✗'}</span>
                <span class="test-name">${displayName}:</span>
                <span class="test-detail">${tests[testName]?.note || ''}</span>
            </div>`);
        }
    }

    return `
        <div class="grounding-item ${evalItem.verdict}">
            <div class="grounding-item-header">
                <span class="grounding-name">${escapeHtml(evalItem.name)}</span>
                <span class="grounding-badge ${badgeClass}">${nodeType}</span>
                <span class="grounding-score">${evalItem.score}/3</span>
            </div>
            <div class="grounding-tests">
                ${testResults.join('')}
            </div>
            ${evalItem.suggestion ? `<div class="grounding-suggestion">💡 ${escapeHtml(evalItem.suggestion)}</div>` : ''}
        </div>
    `;
}

function hideGroundingModal() {
    const modal = document.getElementById('grounding-modal');
    if (modal) modal.remove();
}

function pruneUngrounded() {
    const ungroundedNodes = merged_object.nodes.filter(n =>
        n.properties?._groundingVerdict === 'ungrounded'
    );

    if (ungroundedNodes.length === 0) {
        alert('No ungrounded nodes to prune');
        return;
    }

    if (!confirm(`Remove ${ungroundedNodes.length} ungrounded nodes?`)) {
        return;
    }

    const idsToRemove = new Set(ungroundedNodes.map(n => n.id));

    // Remove nodes
    merged_object.nodes = merged_object.nodes.filter(n => !idsToRemove.has(n.id));

    // Remove relationships connected to removed nodes
    merged_object.relationships = merged_object.relationships.filter(r =>
        !idsToRemove.has(r.startNodeId) && !idsToRemove.has(r.endNodeId)
    );

    logToPanel('result', 'Pruned Ungrounded', {
        stats: `Removed ${ungroundedNodes.length} nodes`,
        nodes: ungroundedNodes.map(n => n.properties?.name)
    });

    hideGroundingModal();
    renderGraph(merged_object);
}

function toggleAutoMode() {
    autoMode = !autoMode;
    const toggle = document.getElementById('auto-toggle');
    const label = document.getElementById('auto-label');

    if (autoMode) {
        autoIterations = 0;
        toggle.classList.add('active');
        label.textContent = 'Stop';
        logToPanel('action', 'Auto Mode Started', {
            input: `AI will research autonomously (max ${MAX_AUTO_ITERATIONS} iterations)`
        });
        closeSuggestion();
        // Start auto mode if we have a graph
        if (merged_object?.nodes?.length >= 2) {
            suggestNextAction();
        } else {
            logToPanel('error', 'Auto Mode', { error: 'Need at least 2 nodes to start' });
            autoMode = false;
            toggle.classList.remove('active');
            label.textContent = 'Auto';
        }
    } else {
        toggle.classList.remove('active');
        label.textContent = 'Auto';
        logToPanel('action', 'Auto Mode Stopped', {
            stats: `Completed ${autoIterations} iterations`
        });
        closeSuggestion();
    }
}

// ============ TALK WITH GRAPH ============

let chatHistory = []; // Stores conversation history

function getChatPrompt(userQuestion, includeHistory = true) {
    const nodes = merged_object.nodes.map(n => ({
        id: n.id,
        name: n.properties?.name || n.name,
        description: n.properties?.description || n.description,
        type: n.labels?.[0]
    }));

    const relationships = merged_object.relationships.map(r => {
        const source = merged_object.nodes.find(n => n.id === r.startNodeId);
        const target = merged_object.nodes.find(n => n.id === r.endNodeId);
        return {
            from: source?.properties?.name,
            to: target?.properties?.name,
            type: r.type
        };
    }).filter(r => r.from && r.to);

    // Build conversation history string
    let historyStr = '';
    if (includeHistory && chatHistory.length > 0) {
        historyStr = `\nCONVERSATION HISTORY:
===========================================
${chatHistory.map(msg => `${msg.role.toUpperCase()}: ${msg.content}`).join('\n\n')}
===========================================\n`;
    }

    return `You are an expert knowledge navigator with the ability to execute tasks. The following knowledge graph represents your grounding conceptual framework and memory.

FIRST: Analyze the knowledge graph to determine its primary domain, then adopt the most appropriate persona and thinking style:
- Scientific/Research content → Think as a peer researcher: evidence-based, precise, cite specific concepts as data points
- Philosophical content → Think dialectically: explore tensions, synthesize perspectives, probe deeper meanings
- Policy/Governance content → Think as a policy analyst: pragmatic trade-offs, stakeholder impacts, implementation considerations
- Technical/Engineering content → Think as an architect: systems thinking, constraints, practical solutions
- Business/Strategy content → Think strategically: market dynamics, competitive factors, value creation
- Historical content → Think as a historian: context, causation, patterns across time
- Creative/Artistic content → Think interpretively: themes, meanings, aesthetic considerations

KNOWLEDGE GRAPH (Your Conceptual Framework):
===========================================
CONCEPTS (${nodes.length}):
${nodes.map(n => `- ${n.name} [${n.type}]: ${n.description || 'No description'}`).join('\n')}

RELATIONSHIPS (${relationships.length}):
${relationships.map(r => `- ${r.from} --[${r.type}]--> ${r.to}`).join('\n')}
===========================================${historyStr}

USER MESSAGE: "${userQuestion}"

TASK EXECUTION CAPABILITY:
You can delegate complex tasks to Claude Code by including a task block in your response. Use this when the user asks you to:
- Research a topic in depth and add findings to the graph
- Write code, documents, or structured content
- Analyze files or data
- Perform multi-step operations
- Do web research

To request a task, include this block in your response:
\`\`\`task
{
  "type": "research" | "implement",
  "description": "Brief description of what needs to be done",
  "prompt": "Detailed instructions for Claude Code to execute",
  "addToGraph": true/false,  // Whether results should be added to the knowledge graph
  "projectName": "project-name"  // For implement tasks: name of the project/repo to create
}
\`\`\`

Task types:
- "research": Gather information, analyze concepts, add findings to graph
- "implement": Create actual code, files, repositories - use this when user wants you to BUILD something

CRITICAL — Graph output contract:
You are operating inside a graph visualization tool. When "addToGraph" is true, the task's response text is parsed to extract a \`\`\`graph\`\`\` fenced code block. If the block is missing or malformed, the work WILL NOT appear in the graph — it will be lost.

When "addToGraph" is true, you MUST append the following instruction verbatim to the end of the task's "prompt" field:

---BEGIN GRAPH OUTPUT INSTRUCTION---
You are operating inside a graph visualization tool. Your response will be parsed by the tool to extract graph data.
At the END of your response, you MUST output ALL graph nodes and relationships as a single JSON code block using this EXACT fence:

\`\`\`graph
{
  "nodes": [
    {"id": 1, "labels": ["Category"], "properties": {"name": "Node Name", "description": "What this node represents"}}
  ],
  "relationships": [
    {"startNodeId": 1, "endNodeId": 2, "type": "RELATES_TO", "properties": {}}
  ]
}
\`\`\`

Rules:
- The fence MUST be \`\`\`graph (not \`\`\`json, not \`\`\`graphql — exactly \`\`\`graph)
- Every node MUST have: id (unique integer), labels (array of strings), properties.name, properties.description
- Every relationship MUST have: startNodeId (integer matching a node id), endNodeId (integer matching a node id), type (string), properties (object)
- Include ALL nodes and relationships — not a sample, not a summary, the complete graph
- This block is NOT optional. Without it, none of your work will appear in the tool.
- Writing files to disk is fine as a secondary artifact, but the \`\`\`graph\`\`\` block in your response is the primary delivery mechanism.
---END GRAPH OUTPUT INSTRUCTION---

Only use tasks when genuinely helpful. For simple questions, just answer directly.
For implementation requests (code, repos, projects), ALWAYS use type "implement".

Instructions:
1. Identify the domain and adopt the appropriate expert persona (don't explicitly state it, just embody it)
2. Ground your response in the knowledge graph - reference specific concepts and relationships
3. Draw connections between concepts when relevant
4. If the graph lacks information to fully answer, acknowledge this and offer what insights you can
5. Keep your response focused and conversational
6. When appropriate, delegate complex work to Claude Code via task blocks
${chatHistory.length > 0 ? '7. This is a continuing conversation - maintain context from previous messages' : ''}

Response:`;
}

function talkWithGraph() {
    // Allow chat even without a graph - can create graph from web/research
    showChatModal();
}

function addChatMessage(role, content) {
    /**
     * Add a message to chat history and refresh the display.
     * role: 'user' | 'assistant' | 'system'
     */
    chatHistory.push({ role, content });
    saveChatHistory();
}

function sendChatRequest(userQuestion) {
    if (!userQuestion.trim()) return;

    // Add user message to history
    chatHistory.push({ role: 'user', content: userQuestion });

    // Show modal with loading state
    showChatModal(true);
    setChatLoading(true);

    fetch("http://localhost:8765/v1/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            prompt: getChatPrompt(userQuestion),
            model: "claude-opus-4-5-20251101"
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

        const response = data.choices[0].text.trim();

        // Check for task blocks in the response
        const { text: cleanResponse, tasks } = parseTaskBlocks(response);

        // Add assistant response to history (clean version without task JSON)
        chatHistory.push({ role: 'assistant', content: cleanResponse, tasks: tasks });

        // Save to localStorage
        saveChatHistory();

        showChatModal();
        setChatLoading(false);

        // Execute any tasks found
        if (tasks.length > 0) {
            executeChatTasks(tasks);
        }
    })
    .catch(error => {
        // Remove the failed user message
        chatHistory.pop();
        showChatModal();
        setChatLoading(false);
        // Show error in the modal
        const chatBody = document.getElementById('chat-body');
        if (chatBody) {
            chatBody.innerHTML += `<div class="chat-error">Error: ${error.message}</div>`;
            chatBody.scrollTop = chatBody.scrollHeight;
        }
    });
}

function parseTaskBlocks(response) {
    const tasks = [];
    const taskRegex = /```task\s*\n?([\s\S]*?)```/g;

    let match;
    while ((match = taskRegex.exec(response)) !== null) {
        try {
            const taskJson = match[1].trim();
            const task = JSON.parse(taskJson);
            tasks.push(task);
        } catch (e) {
            console.warn('Failed to parse task block:', e);
        }
    }

    // Remove task blocks from display text but keep a reference
    let cleanText = response.replace(taskRegex, '').trim();

    // If there are tasks, add a visual indicator
    if (tasks.length > 0 && !cleanText.includes('[Task')) {
        // The text already mentions the task naturally
    }

    return { text: cleanText, tasks };
}

let runningTasks = [];

function executeChatTasks(tasks) {
    tasks.forEach((task, index) => {
        const taskId = Date.now() + index;

        // Add task to running tasks
        runningTasks.push({
            id: taskId,
            description: task.description,
            status: 'running',
            addToGraph: task.addToGraph
        });

        // Add task message to chat
        chatHistory.push({
            role: 'task',
            taskId: taskId,
            description: task.description,
            status: 'running'
        });

        saveChatHistory();
        showChatModal();

        // Execute the task via Claude Code
        executeClaudeCodeTask(task, taskId);
    });
}

function executeClaudeCodeTask(task, taskId) {
    // Determine if this is an implementation task
    const isImplementTask = task.type === 'implement';

    if (isImplementTask) {
        // Use the execute endpoint for implementation tasks
        executeImplementationTask(task, taskId);
    } else {
        // Use completions endpoint for research tasks
        executeResearchTask(task, taskId);
    }
}

function executeResearchTask(task, taskId) {
    const taskPrompt = task.addToGraph
        ? `${task.prompt}

CRITICAL OUTPUT REQUIREMENT: You are operating inside a graph visualization tool. Your response will be parsed to extract graph data and render it in the UI. You MUST output the graph as a JSON code block at the END of your response using this exact format:

\`\`\`graph
{"nodes":[{"id":1,"labels":["Type"],"properties":{"name":"...","description":"..."}}],"relationships":[{"startNodeId":1,"endNodeId":2,"type":"RELATES_TO","properties":{}}]}
\`\`\`

This is NOT optional. If you do not include this block, your work will not appear in the graph. Do not only write files to disk — the graph JSON in your response is the primary delivery mechanism.
Every node must have: id (integer), labels (array of strings), properties (object with at least "name" and "description").
Every relationship must have: startNodeId, endNodeId, type, properties.`
        : task.prompt;

    fetch("http://localhost:8765/v1/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            prompt: taskPrompt,
            model: "claude-opus-4-5-20251101"
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

        const result = data.choices[0].text.trim();

        // Check for graph data to add
        if (task.addToGraph) {
            const graphMatch = result.match(/```graph\s*\n?([\s\S]*?)```/);
            if (graphMatch) {
                try {
                    const graphData = JSON.parse(graphMatch[1].trim());
                    if (graphData.nodes && graphData.nodes.length > 0) {
                        mergeNewNodes(graphData, null, 'task-research');
                        renderGraph(merged_object);
                    }
                } catch (e) {
                    console.warn('Failed to parse graph data from task:', e);
                }
            }
        }

        updateTaskStatus(taskId, 'completed', result);
    })
    .catch(error => {
        updateTaskStatus(taskId, 'failed', error.message);
    });
}

function executeImplementationTask(task, taskId) {
    const projectName = task.projectName || 'project-' + Date.now();
    const workingDir = `~/claude-projects/${projectName}`;

    const graphOutputInstruction = task.addToGraph ? `
8. CRITICAL — GRAPH OUTPUT: You are operating inside a graph visualization tool. At the END of your response, you MUST output all knowledge graph data as a JSON code block so the UI can render it:

\`\`\`graph
{"nodes":[{"id":1,"labels":["Type"],"properties":{"name":"...","description":"..."}}],"relationships":[{"startNodeId":1,"endNodeId":2,"type":"RELATES_TO","properties":{}}]}
\`\`\`

Every node needs: id (integer), labels (array), properties (object with "name" and "description").
Every relationship needs: startNodeId, endNodeId, type, properties.
This is NOT optional — without this block, your work will not appear in the graph.` : '';

    const implementPrompt = `You are implementing a software project. Create all necessary files and code.

PROJECT: ${projectName}
WORKING DIRECTORY: ${workingDir}

TASK:
${task.prompt}

INSTRUCTIONS:
1. Create a well-structured project with appropriate files
2. Write clean, documented, production-ready code
3. Include a README.md with setup instructions
4. Create any necessary configuration files
5. If it's a Python project, include requirements.txt
6. If it's a Node project, include package.json
7. Implement the full solution, not just scaffolding${graphOutputInstruction}

Begin implementation:`;

    // Start async task
    fetch("http://localhost:8765/v1/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            prompt: implementPrompt,
            working_dir: workingDir,
            model: "claude-opus-4-5-20251101",
            async: true,
            graph_id: currentGraphId || 'default'
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

        // Store server task ID for polling
        const serverTaskId = data.task_id;

        // Update our task with server task ID
        const taskMsg = chatHistory.find(msg => msg.role === 'task' && msg.taskId === taskId);
        if (taskMsg) {
            taskMsg.serverTaskId = serverTaskId;
            taskMsg.workingDir = workingDir;
            taskMsg.projectName = projectName;
        }

        // Start polling for status
        pollTaskStatus(taskId, serverTaskId, task, projectName);
    })
    .catch(error => {
        updateTaskStatus(taskId, 'failed', error.message);
    });
}

let taskPollers = {}; // Track active polling intervals

function pollTaskStatus(localTaskId, serverTaskId, originalTask, projectName) {
    // Clear any existing poller for this task
    if (taskPollers[localTaskId]) {
        clearInterval(taskPollers[localTaskId]);
    }

    // Show the task monitor
    showTaskMonitor(true);

    const pollInterval = setInterval(() => {
        fetch(`http://localhost:8765/v1/tasks/${serverTaskId}`)
            .then(response => response.json())
            .then(async data => {
                // Update task with live info
                const taskMsg = chatHistory.find(msg => msg.role === 'task' && msg.taskId === localTaskId);
                if (taskMsg) {
                    taskMsg.outputLines = data.output_lines || 0;
                    taskMsg.lastOutput = data.last_output || '';
                    taskMsg.liveFiles = data.files || [];
                }

                // Update the task monitor in main UI
                updateTaskMonitor(data);

                // Refresh the modal if it's open
                if (document.getElementById('chat-modal')) {
                    showChatModal();
                }

                if (data.status === 'completed') {
                    clearInterval(taskPollers[localTaskId]);
                    delete taskPollers[localTaskId];

                    // Hide task monitor
                    showTaskMonitor(false);

                    // Build result with file info
                    const result = data.result || {};
                    let resultText = result.response || '';

                    if (result.files && result.files.length > 0) {
                        resultText += `\n\n📁 **Files created:**\n`;
                        resultText += result.files.map(f => `- ${f}`).join('\n');
                    }

                    resultText += `\n\n📂 **Project location:** \`${result.working_dir}\``;

                    updateTaskStatus(localTaskId, 'completed', resultText, {
                        type: 'implementation',
                        workingDir: result.working_dir,
                        files: result.files || [],
                        serverTaskId: serverTaskId
                    });

                    // Auto-pull from server — task may have written to graph via API
                    try {
                        const pullResult = await pullFromServer();
                        if (pullResult?.added > 0) {
                            console.log(`Auto-pulled ${pullResult.added} nodes from server after implementation task`);
                        }
                    } catch (e) {
                        console.warn('Auto-pull after implementation task failed:', e);
                    }

                    // Add to graph if requested
                    if (originalTask.addToGraph) {
                        // Try to parse graph data from the response first
                        const responseText = result.response || '';
                        const graphMatch = responseText.match(/```graph\s*\n?([\s\S]*?)```/);
                        let graphParsed = false;

                        if (graphMatch) {
                            try {
                                const graphData = JSON.parse(graphMatch[1].trim());
                                if (graphData.nodes && graphData.nodes.length > 0) {
                                    mergeNewNodes(graphData, null, 'task-implementation');
                                    renderGraph(merged_object);
                                    graphParsed = true;
                                }
                            } catch (e) {
                                console.warn('Failed to parse graph data from implementation task:', e);
                            }
                        }

                        // Fallback: if no graph block found, try parsing any JSON block with nodes/relationships
                        if (!graphParsed) {
                            const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?\{[\s\S]*?"nodes"[\s\S]*?\})\s*```/);
                            if (jsonMatch) {
                                try {
                                    const graphData = JSON.parse(jsonMatch[1].trim());
                                    if (graphData.nodes && graphData.nodes.length > 0) {
                                        mergeNewNodes(graphData, null, 'task-implementation');
                                        renderGraph(merged_object);
                                        graphParsed = true;
                                    }
                                } catch (e) {
                                    console.warn('Failed to parse JSON graph fallback:', e);
                                }
                            }
                        }

                        // Last resort: create a stub project node
                        if (!graphParsed) {
                            const graphNodes = [{
                                id: 1000,
                                labels: ['Project'],
                                properties: {
                                    name: projectName,
                                    description: originalTask.description,
                                    path: result.working_dir,
                                    files: (result.files || []).slice(0, 10).join(', ')
                                }
                            }];
                            mergeNewNodes({ nodes: graphNodes, relationships: [] }, null, 'implementation');
                            renderGraph(merged_object);
                        }
                    }

                } else if (data.status === 'failed') {
                    clearInterval(taskPollers[localTaskId]);
                    delete taskPollers[localTaskId];
                    showTaskMonitor(false);
                    updateTaskStatus(localTaskId, 'failed', data.error || 'Task failed');
                }
            })
            .catch(err => {
                console.warn('Poll error:', err);
            });
    }, 2000); // Poll every 2 seconds

    taskPollers[localTaskId] = pollInterval;
}

function showTaskMonitor(visible) {
    const monitor = document.getElementById('task-monitor');
    if (monitor) {
        if (visible) {
            monitor.classList.remove('hidden');
        } else {
            monitor.classList.add('hidden');
        }
    }
}

function updateTaskMonitor(data) {
    const monitor = document.getElementById('task-monitor');
    if (!monitor) return;

    const linesEl = monitor.querySelector('.task-monitor-lines');
    const previewEl = monitor.querySelector('.task-monitor-preview');

    if (linesEl) {
        linesEl.textContent = `${data.output_lines || 0} lines`;
    }

    if (previewEl) {
        const lastOutput = data.last_output || 'Starting...';
        const files = data.files || [];

        let html = `<pre>${escapeHtml(lastOutput.slice(-500))}</pre>`;

        if (files.length > 0) {
            html += `<div class="task-monitor-files">📁 ${files.length} files created</div>`;
        }

        previewEl.innerHTML = html;
        previewEl.scrollTop = previewEl.scrollHeight;
    }
}

function viewTaskLogs(serverTaskId) {
    window.open(`http://localhost:8765/v1/tasks/${serverTaskId}/log`, '_blank');
}

function updateTaskStatus(taskId, status, result, metadata = {}) {
    // Update in running tasks
    const task = runningTasks.find(t => t.id === taskId);
    if (task) {
        task.status = status;
        task.result = result;
        task.metadata = metadata;
    }

    // Update in chat history
    const taskMsg = chatHistory.find(msg => msg.role === 'task' && msg.taskId === taskId);
    if (taskMsg) {
        taskMsg.status = status;
        taskMsg.result = result;
        taskMsg.metadata = metadata;
    }

    saveChatHistory();
    showChatModal();

    // Clean up completed tasks from running list after a delay
    if (status === 'completed' || status === 'failed') {
        setTimeout(() => {
            runningTasks = runningTasks.filter(t => t.id !== taskId);
        }, 1000);
    }
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    input.value = '';

    // Route through intent classifier
    const route = classifyIntent(message);

    switch (route.type) {
        case 'sync':
            syncToServer().then(r => {
                addChatMessage('system', r ? `Synced to server: ${r.node_count} nodes` : 'Sync failed - is server.py running?');
                showChatModal();
            });
            break;

        case 'pull':
            pullFromServer().then(r => {
                addChatMessage('system', r ? `Pulled from server: ${r.added} new nodes` : 'Pull failed');
                showChatModal();
            });
            break;

        case 'implement':
            routeToClaudeCode(route.prompt, 'implement');
            break;

        case 'research':
            routeToClaudeCode(route.prompt, 'research');
            break;

        case 'web':
            routeToClaudeCode(route.prompt, 'web');
            break;

        case 'analyze':
            routeToClaudeCode(route.prompt, 'analyze');
            break;

        case 'claude':
            // Generic Claude Code task - let it decide
            routeToClaudeCode(route.prompt, 'auto');
            break;

        case 'chat':
        default:
            sendChatRequest(message);
            break;
    }
}

function classifyIntent(message) {
    /**
     * Classify user intent and extract the core prompt.
     * Returns: { type: 'chat'|'implement'|'research'|'web'|'analyze'|'claude'|'sync'|'pull', prompt: string }
     */
    const lower = message.toLowerCase();

    // Explicit commands first
    if (message === '/sync') return { type: 'sync', prompt: '' };
    if (message === '/pull') return { type: 'pull', prompt: '' };

    // Explicit prefixes
    if (message.startsWith('/implement ') || message.startsWith('/impl ')) {
        return { type: 'implement', prompt: message.replace(/^\/(implement|impl)\s+/, '') };
    }
    if (message.startsWith('/research ') || message.startsWith('/r ')) {
        return { type: 'research', prompt: message.replace(/^\/(research|r)\s+/, '') };
    }
    if (message.startsWith('/web ') || message.startsWith('/search ')) {
        return { type: 'web', prompt: message.replace(/^\/(web|search)\s+/, '') };
    }
    if (message.startsWith('/analyze ') || message.startsWith('/read ')) {
        return { type: 'analyze', prompt: message.replace(/^\/(analyze|read)\s+/, '') };
    }
    if (message.startsWith('/claude ') || message.startsWith('/cc ')) {
        return { type: 'claude', prompt: message.replace(/^\/(claude|cc)\s+/, '') };
    }
    if (message.startsWith('/ground ') || message.startsWith('/g ')) {
        return { type: 'ground', prompt: message.replace(/^\/(ground|g)\s+/, '') };
    }

    // Keyword-based intent detection (implicit routing)
    const implementKeywords = ['implement', 'build', 'create file', 'write code', 'add feature', 'refactor', 'fix bug', 'modify', 'update the code', 'change the'];
    const researchKeywords = ['research', 'find papers', 'look up', 'what is', 'explain', 'summarize', 'learn about'];
    const webKeywords = ['search the web', 'google', 'find online', 'latest news', 'recent papers', 'search for'];
    const analyzeKeywords = ['analyze', 'read the', 'look at', 'examine', 'review', 'map the', 'understand the'];
    const pathPattern = /~\/|\.\/|\/Users\/|\/home\//;

    // Check for implementation intent
    if (implementKeywords.some(k => lower.includes(k)) && pathPattern.test(message)) {
        return { type: 'implement', prompt: message };
    }

    // Check for web search intent
    if (webKeywords.some(k => lower.includes(k))) {
        return { type: 'web', prompt: message };
    }

    // Check for research intent (graph-focused)
    if (researchKeywords.some(k => lower.includes(k)) && !pathPattern.test(message)) {
        return { type: 'research', prompt: message };
    }

    // Check for analyze intent (codebase reading)
    if (analyzeKeywords.some(k => lower.includes(k)) && pathPattern.test(message)) {
        return { type: 'analyze', prompt: message };
    }

    // Default everything to Claude Code (auto mode)
    // This gives all messages access to tools, web search, file operations
    return { type: 'claude', prompt: message };
}

function buildModePrompt(mode, userPrompt, graphContext) {
    /**
     * Build mode-specific prompts for Claude Code.
     */

    const jsonInstructions = `
Return a JSON response:
{
  "summary": "Brief description of what you found/did",
  "nodes": [
    {
      "name": "Concept Name",
      "description": "What this concept is",
      "type": "Concept|Mechanism|Architecture|Phenomenon|Technique",
      "connectsTo": ["Related Concept"]
    }
  ],
  "relationships": []
}
If no graph updates needed: {"summary": "your response", "nodes": [], "relationships": []}`;

    switch (mode) {
        case 'implement':
            return `You are a senior developer implementing features guided by a knowledge graph.

${graphContext}

USER REQUEST: ${userPrompt}

INSTRUCTIONS:
1. First, read the graph summary (curl http://localhost:8765/v1/graph/summary) to understand the domain context
2. Read the full graph if you need detailed architecture or relationship info
3. Read and understand the target codebase
4. Write clean, well-structured code following existing patterns
5. Actually create/modify files - this is an IMPLEMENTATION task, not analysis
6. As you implement, merge new discoveries (new modules, patterns, decisions) into the graph via the merge API
7. After implementation, return a brief JSON summary:

{"summary": "What you implemented and where", "nodes": [], "relationships": []}

Focus on DOING the work, not just planning it.`;

        case 'research':
            return `You are a research assistant building a knowledge graph.

${graphContext}

USER REQUEST: ${userPrompt}

INSTRUCTIONS:
1. First, read the graph summary (curl http://localhost:8765/v1/graph/summary) to see what's already known
2. Research the topic thoroughly (use web search if needed)
3. Identify key concepts, mechanisms, and relationships
4. Connect findings to existing graph nodes where relevant
5. Merge your findings into the graph via POST http://localhost:8765/v1/graph/merge as you go
6. Also return findings as structured JSON for the graph:
${jsonInstructions}

Focus on extracting ACTIONABLE concepts that build on the existing graph.`;

        case 'web':
            return `You are a research assistant with web search capabilities.

${graphContext}

USER REQUEST: ${userPrompt}

INSTRUCTIONS:
1. Search the web for current information on this topic
2. Synthesize findings from multiple sources
3. Extract key concepts relevant to the knowledge graph
4. Return findings as JSON:
${jsonInstructions}

Prioritize recent, authoritative sources.`;

        case 'analyze':
            return `You are analyzing a codebase to extract knowledge for a graph.

${graphContext}

USER REQUEST: ${userPrompt}

INSTRUCTIONS:
1. Read the graph summary first (curl http://localhost:8765/v1/graph/summary) to see what's already mapped
2. Read and analyze the specified files/codebase
3. Identify architectural patterns, key mechanisms, and design decisions
4. Map findings to existing graph concepts where possible
5. DO NOT modify any source files - this is READ-ONLY analysis
6. Merge discovered concepts into the graph via POST http://localhost:8765/v1/graph/merge
7. Also return findings as JSON:
${jsonInstructions}

Focus on extracting transferable patterns and concepts.`;

        case 'ground':
            return `You are analyzing a codebase to ground knowledge graph concepts in actual implementations.

${graphContext}

TARGET CODEBASE: ${userPrompt.split(' ')[0]}

CONCEPTS TO GROUND:
${userPrompt.includes('CONCEPTS:') ? userPrompt.split('CONCEPTS:')[1] : 'Read concepts from the graph API: curl -s http://localhost:8765/v1/graph'}

INSTRUCTIONS:
1. Read the full graph (curl http://localhost:8765/v1/graph) to get all concepts and their descriptions
2. For each concept, search the codebase for actual implementations
3. Find specific files, functions, classes that implement the concept
4. Determine if the concept is: IMPLEMENTED, PARTIAL, or NOT_FOUND
5. Extract code references (file:line) for implemented concepts
6. Note any gaps between the concept and implementation
7. Update grounded concepts in the graph via POST http://localhost:8765/v1/graph/merge with evidence data

Return a JSON response with grounding analysis:
{
  "summary": "Grounding analysis complete. X/Y concepts found in codebase.",
  "groundingResults": [
    {
      "conceptName": "Name of the concept being grounded",
      "status": "IMPLEMENTED|PARTIAL|NOT_FOUND",
      "analysis": "Detailed analysis of how this concept is implemented or why it's missing",
      "codeReferences": [
        {"file": "path/to/file.py", "line": 123, "snippet": "relevant code snippet"},
        {"file": "path/to/other.py", "line": 456, "snippet": "another reference"}
      ],
      "implementationNotes": "How the actual implementation differs from or extends the concept",
      "suggestedImprovements": "What could be added or improved based on the concept"
    }
  ],
  "nodes": [],
  "relationships": []
}

Be thorough - read actual files and find specific line numbers.`;

        case 'auto':
        default:
            return `You are an AI assistant with access to a knowledge graph and full development capabilities.

${graphContext}

USER REQUEST: ${userPrompt}

INSTRUCTIONS:
1. Start by reading the graph summary (curl http://localhost:8765/v1/graph/summary) to understand the current knowledge base
2. Based on the request, you may:
   - Research topics and add findings to the graph
   - Read/analyze codebases and map discoveries to the graph
   - Implement features or modifications
   - Search the web for information
3. As you work, merge new knowledge into the graph via POST http://localhost:8765/v1/graph/merge
4. The graph is the user's persistent memory — keep it updated with what you learn

After completing the task, return a JSON summary:
${jsonInstructions}`;
    }
}

async function routeToClaudeCode(prompt, mode = 'auto') {
    /**
     * Route a task to Claude Code with mode-specific instructions.
     * Modes: 'auto', 'implement', 'research', 'web', 'analyze'
     */

    const modeLabels = {
        auto: 'claude',
        implement: 'implement',
        research: 'research',
        web: 'web',
        analyze: 'analyze',
        ground: 'ground'
    };

    // Add user message to chat
    addChatMessage('user', `/${modeLabels[mode]} ${prompt}`);
    showChatModal(true);

    // Build graph context — give Claude Code API access instead of a truncated dump
    const nodeCount = merged_object?.nodes?.length || 0;
    const relCount = merged_object?.relationships?.length || 0;
    const gid = currentGraphId || 'default';
    const graphContext = `
KNOWLEDGE GRAPH API (${nodeCount} nodes, ${relCount} relationships):
You have access to a live knowledge graph via a local API at http://localhost:8765.
Use curl or fetch to interact with it. The graph is your shared memory with the user.

IMPORTANT: This task is working with graph ID: "${gid}"
You MUST include ?id=${gid} on ALL graph API calls to target the correct graph.

READING THE GRAPH:
  curl -s "http://localhost:8765/v1/graph/summary?id=${gid}"
    → Returns lightweight summary: node names, types, and counts (START HERE to orient yourself)

  curl -s "http://localhost:8765/v1/graph?id=${gid}"
    → Returns full graph JSON: {"nodes": [...], "relationships": [...]}
    Each node: {"id": int, "labels": ["Type"], "properties": {"name": "...", "description": "..."}, ...}
    Each relationship: {"startNodeId": int, "endNodeId": int, "type": "RELATION_TYPE", "properties": {}}

SEARCHING & EXPLORING (use these for large graphs instead of loading everything):
  curl -s "http://localhost:8765/v1/graph/search?id=${gid}&q=QUERY&limit=20"
    → Search nodes by name (substring match). Returns: {"query": "...", "count": N, "nodes": [...]}

  curl -s "http://localhost:8765/v1/graph/node?id=${gid}&name=NODE_NAME&depth=2"
    → Get a specific node + N levels of connected neighbors. Great for exploring local context.
    Returns: {"center": "...", "depth": N, "nodes": [...], "relationships": [...]}

  curl -s "http://localhost:8765/v1/graph/relations?id=${gid}&node=NODE_NAME&relation=RELATION_TYPE&direction=both"
    → Get all nodes that have a specific relation to/from a node. direction: in, out, or both
    Returns: {"center": "...", "count": N, "results": [{"node": {...}, "relation": "...", "direction": "..."}]}

  curl -s "http://localhost:8765/v1/graph/labels?id=${gid}"
    → List all node types and relationship types with counts. Useful for understanding graph schema.
    Returns: {"node_types": [{"type": "...", "count": N}], "relationship_types": [...]}

  curl -s "http://localhost:8765/v1/graph/traverse?id=${gid}&start=NODE_NAME&depth=3&direction=out&relation=OPTIONAL_FILTER"
    → Traverse paths from a starting node. direction: in, out, or both. relation: optional filter.
    Returns: {"start": "...", "paths": [["NodeA", "--[REL]-->", "NodeB", ...], ...]}

WRITING TO THE GRAPH (add new knowledge):
  curl -s -X POST "http://localhost:8765/v1/graph/merge?id=${gid}" \\
    -H "Content-Type: application/json" \\
    -d '{"nodes": [...], "relationships": [...]}'
    → Merges new nodes/relationships into the existing graph (deduplicates by name)
    Node format: {"id": int, "name": "Name", "type": "Type", "labels": ["Type"], "properties": {"name": "Name", "description": "..."}}
    Relationship format: {"startNodeId": int, "endNodeId": int, "type": "RELATES_TO", "properties": {}}

REPLACING THE FULL GRAPH:
  curl -s -X POST "http://localhost:8765/v1/graph?id=${gid}" \\
    -H "Content-Type: application/json" \\
    -d '{"nodes": [...], "relationships": [...]}'
    → Overwrites the entire graph (use with caution)

LISTING ALL GRAPHS:
  curl -s http://localhost:8765/v1/graphs
    → Returns: {"graphs": [{"id": "...", "node_count": N, "relationship_count": N}, ...]}

WORKFLOW:
1. Start by reading the graph summary to understand what's already known
2. Use search/labels to find relevant nodes, then explore with node+depth or relations
3. Only fetch the full graph if you need complete structure (avoid for large graphs)
4. As you discover new concepts, entities, or relationships during your work, merge them into the graph
5. The graph is the user's persistent knowledge base — treat it as a living document, not throwaway output
`;

    // Mode-specific prompts
    const fullPrompt = buildModePrompt(mode, prompt, graphContext);

    try {
        // Sync current graph to server first
        await syncToServer();

        // Execute Claude task
        const result = await executeClaudeTask(fullPrompt, { async: true });

        if (result.task_id) {
            const taskStartTime = Date.now();

            // Add task to chat history with special type
            chatHistory.push({
                role: 'claude-task',
                taskId: result.task_id,
                description: prompt.slice(0, 100),
                status: 'running',
                startTime: taskStartTime,
                outputLines: 0
            });
            saveChatHistory();
            showChatModal();

            // Start elapsed time updater
            const elapsedInterval = setInterval(() => {
                const taskMsg = chatHistory.find(m => m.taskId === result.task_id);
                if (taskMsg && taskMsg.status === 'running') {
                    showChatModal(); // Refresh to update elapsed time
                } else {
                    clearInterval(elapsedInterval);
                }
            }, 1000);

            // Poll for completion (inline to avoid function name collision)
            const taskId = result.task_id;
            const pollInterval = setInterval(async () => {
                try {
                    const response = await fetch(`http://localhost:8765/v1/tasks/${taskId}`);
                    const task = await response.json();

                    // Update progress
                    const taskMsg = chatHistory.find(m => m.taskId === taskId);
                    if (taskMsg) {
                        taskMsg.outputLines = task.output_lines || 0;
                        taskMsg.lastOutput = task.last_output?.slice(-200) || '';
                    }
                    showChatModal();

                    if (task.status === 'completed') {
                        clearInterval(pollInterval);
                        clearInterval(elapsedInterval);
                        await (async (task) => {
                    try {
                        // Parse the response - find the JSON block
                        const response = task.result?.response || '';

                        // Try to find JSON in code blocks first, then raw
                        let jsonStr = null;
                        const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
                        if (codeBlockMatch) {
                            jsonStr = codeBlockMatch[1];
                        } else {
                            const rawMatch = response.match(/\{[\s\S]*\}/);
                            if (rawMatch) jsonStr = rawMatch[0];
                        }

                        if (jsonStr) {
                            const data = JSON.parse(jsonStr);
                            console.log('Parsed Claude response:', data);

                            // Add summary to chat
                            addChatMessage('assistant', data.summary || 'Task completed.');

                            // Handle grounding results - update existing nodes with analysis
                            if (data.groundingResults?.length > 0) {
                                let groundedCount = 0;
                                for (const result of data.groundingResults) {
                                    // Find the node by name
                                    const node = merged_object.nodes.find(n =>
                                        (n.name || n.properties?.name) === result.conceptName
                                    );
                                    if (node) {
                                        // Store grounding data on the node
                                        node.grounding = {
                                            status: result.status,
                                            analysis: result.analysis,
                                            codeReferences: result.codeReferences || [],
                                            implementationNotes: result.implementationNotes,
                                            suggestedImprovements: result.suggestedImprovements,
                                            groundedAt: Date.now(),
                                            groundedBy: 'claude-code'
                                        };
                                        // Also store in properties for IndexedDB persistence
                                        node.properties = node.properties || {};
                                        node.properties.grounding = JSON.stringify(node.grounding);
                                        groundedCount++;
                                    }
                                }
                                if (groundedCount > 0) {
                                    console.log(`Grounded ${groundedCount} nodes`);
                                    renderGraph(merged_object);
                                    triggerAutoSave();
                                    addChatMessage('system', `Grounded ${groundedCount} concepts in codebase.`);
                                }
                            }

                            // Merge new nodes if any
                            if (data.nodes?.length > 0) {
                                const newGraph = {
                                    nodes: data.nodes.map((n, i) => ({
                                        id: 2000 + i,
                                        name: n.name,
                                        description: n.description,
                                        type: n.type || 'Concept',
                                        labels: [n.type || 'Concept'],
                                        properties: {
                                            name: n.name,
                                            description: n.description,
                                            // Convert array to comma-separated string
                                            connectsTo: Array.isArray(n.connectsTo)
                                                ? n.connectsTo.join(', ')
                                                : (n.connectsTo || '')
                                        }
                                    })),
                                    relationships: data.relationships || []
                                };

                                console.log('Merging nodes:', newGraph.nodes.length);
                                mergeNewNodes(newGraph, null, 'claude-code');
                                renderGraph(merged_object);
                                triggerAutoSave(); // Save to IndexedDB

                                // Update task message with node count
                                const taskMsg = chatHistory.find(m => m.taskId === result.task_id);
                                if (taskMsg) {
                                    taskMsg.nodesAdded = data.nodes.length;
                                }

                                addChatMessage('system', `Added ${data.nodes.length} new nodes to graph.`);
                            }
                        } else {
                            // No JSON, just show response
                            addChatMessage('assistant', response.slice(0, 2000));
                        }
                    } catch (e) {
                        console.error('Error parsing Claude response:', e);
                        addChatMessage('assistant', task.result?.response?.slice(0, 2000) || 'Task completed.');
                    }

                    // Auto-pull from server — task may have written to the graph via the API
                    try {
                        const pullResult = await pullFromServer();
                        if (pullResult?.added > 0) {
                            addChatMessage('system', `Pulled ${pullResult.added} new nodes from server (total: ${pullResult.total}).`);
                        }
                    } catch (e) {
                        console.warn('Auto-pull after task failed:', e);
                    }

                    // Mark task as completed
                    const taskMsg2 = chatHistory.find(m => m.taskId === taskId);
                    if (taskMsg2) {
                        taskMsg2.status = 'completed';
                        taskMsg2.endTime = Date.now();
                        saveChatHistory();
                    }

                    showChatModal();
                })(task);
                    } else if (task.status === 'failed') {
                        clearInterval(pollInterval);
                        clearInterval(elapsedInterval);
                        const taskMsg = chatHistory.find(m => m.taskId === taskId);
                        if (taskMsg) {
                            taskMsg.status = 'failed';
                            taskMsg.error = task.error || 'Task failed';
                            saveChatHistory();
                        }
                        addChatMessage('system', `Task failed: ${task.error || 'Unknown error'}`);
                        showChatModal();
                    }
                } catch (err) {
                    console.warn('Poll error:', err);
                }
            }, 2000);
        }
    } catch (e) {
        // Mark task as failed
        const taskMsg = chatHistory.find(m => m.taskId === result?.task_id);
        if (taskMsg) {
            taskMsg.status = 'failed';
            taskMsg.error = e.message;
            saveChatHistory();
        }
        addChatMessage('system', `Error: ${e.message}`);
        showChatModal();
    }
}

// ============ GROUNDING FUNCTIONS ============

let groundingState = {
    isGrounding: false,
    total: 0,
    completed: 0,
    currentBatch: [],
    results: []
};

async function groundAllNodes(codebasePath, batchSize = 5) {
    /**
     * Ground all ungrounded nodes against a codebase.
     * Processes in batches with progress tracking.
     */
    if (groundingState.isGrounding) {
        addChatMessage('system', 'Grounding already in progress...');
        return;
    }

    // Find ungrounded nodes
    const ungroundedNodes = merged_object.nodes.filter(n => !n.grounding);

    if (ungroundedNodes.length === 0) {
        addChatMessage('system', 'All nodes are already grounded!');
        return;
    }

    groundingState = {
        isGrounding: true,
        total: ungroundedNodes.length,
        completed: 0,
        currentBatch: [],
        results: []
    };

    showGroundingProgress();
    addChatMessage('system', `Starting grounding of ${ungroundedNodes.length} concepts against ${codebasePath}`);

    // Process in batches
    for (let i = 0; i < ungroundedNodes.length; i += batchSize) {
        const batch = ungroundedNodes.slice(i, i + batchSize);
        groundingState.currentBatch = batch.map(n => n.name || n.properties?.name);

        const conceptList = batch.map(n => {
            const name = n.name || n.properties?.name;
            const desc = (n.description || n.properties?.description || '').slice(0, 150);
            return `- ${name}: ${desc}`;
        }).join('\n');

        const prompt = `${codebasePath} CONCEPTS:\n${conceptList}`;

        try {
            // Route to ground mode
            await routeToClaudeCode(prompt, 'ground');

            // Wait for task to complete (simplified - in practice poll for completion)
            groundingState.completed += batch.length;
            updateGroundingProgress();
        } catch (e) {
            console.error('Grounding batch failed:', e);
            addChatMessage('system', `Grounding batch failed: ${e.message}`);
        }
    }

    groundingState.isGrounding = false;
    hideGroundingProgress();
    addChatMessage('system', `Grounding complete! ${groundingState.completed}/${groundingState.total} concepts processed.`);
}

function showGroundingProgress() {
    let progressBar = document.getElementById('grounding-progress');
    if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.id = 'grounding-progress';
        progressBar.innerHTML = `
            <div class="grounding-progress-inner">
                <div class="grounding-header">
                    <span class="grounding-title">Grounding Concepts</span>
                    <span class="grounding-count">0/${groundingState.total}</span>
                </div>
                <div class="grounding-bar-container">
                    <div class="grounding-bar" style="width: 0%"></div>
                </div>
                <div class="grounding-current">Preparing...</div>
            </div>
        `;
        document.body.appendChild(progressBar);
    }
    updateGroundingProgress();
}

function updateGroundingProgress() {
    const progressBar = document.getElementById('grounding-progress');
    if (!progressBar) return;

    const percent = Math.round((groundingState.completed / groundingState.total) * 100);
    progressBar.querySelector('.grounding-count').textContent =
        `${groundingState.completed}/${groundingState.total}`;
    progressBar.querySelector('.grounding-bar').style.width = `${percent}%`;
    progressBar.querySelector('.grounding-current').textContent =
        groundingState.currentBatch.length > 0
            ? `Processing: ${groundingState.currentBatch.slice(0, 3).join(', ')}${groundingState.currentBatch.length > 3 ? '...' : ''}`
            : 'Waiting...';
}

function hideGroundingProgress() {
    const progressBar = document.getElementById('grounding-progress');
    if (progressBar) {
        progressBar.classList.add('fade-out');
        setTimeout(() => progressBar.remove(), 500);
    }
}

function getGroundingStats() {
    /**
     * Get statistics about grounded vs ungrounded nodes.
     */
    const total = merged_object.nodes.length;
    const grounded = merged_object.nodes.filter(n => n.grounding).length;
    const implemented = merged_object.nodes.filter(n => n.grounding?.status === 'IMPLEMENTED').length;
    const partial = merged_object.nodes.filter(n => n.grounding?.status === 'PARTIAL').length;
    const notFound = merged_object.nodes.filter(n => n.grounding?.status === 'NOT_FOUND').length;

    return { total, grounded, ungrounded: total - grounded, implemented, partial, notFound };
}

function updateChatTaskStatus(taskId, status) {
    // Update the last assistant message if it's about this task
    const messages = document.querySelectorAll('.chat-message.assistant');
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.textContent.includes(taskId)) {
        lastMsg.textContent = status;
    }
}

function handleChatKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
    }
}

function showChatModal(isLoading = false) {
    hideChatModal();

    const modal = document.createElement('div');
    modal.id = 'chat-modal';

    // Build conversation HTML
    let conversationHtml = '';

    if (chatHistory.length === 0 && !isLoading) {
        // Welcome state
        conversationHtml = `
            <div class="chat-welcome">
                <div class="chat-welcome-icon">💬</div>
                <div class="chat-welcome-title">Talk with your Graph</div>
                <div class="chat-welcome-text">Your knowledge graph serves as persistent memory for AI reasoning. Messages are auto-routed: /research adds to graph, /implement writes code, /analyze reads codebases, /web searches online. Or just describe what you need.</div>
                <div class="chat-welcome-examples">
                    <div class="chat-welcome-label">Explore the graph:</div>
                    <div class="chat-example" onclick="insertChatExample(this)">What are the key themes in this graph?</div>
                    <div class="chat-example" onclick="insertChatExample(this)">What tensions or contradictions exist here?</div>
                    <div class="chat-welcome-label" style="margin-top: 12px;">Route to Claude Code:</div>
                    <div class="chat-example" onclick="insertChatExample(this)">/research sparse autoencoders and attention mechanisms</div>
                    <div class="chat-example" onclick="insertChatExample(this)">/web latest papers on mechanistic interpretability 2024</div>
                    <div class="chat-example" onclick="insertChatExample(this)">/analyze ~/Documents/my-project and map architecture</div>
                    <div class="chat-example" onclick="insertChatExample(this)">/implement the volatility filter pattern in ~/Documents/pump-signaler</div>
                </div>
            </div>`;
    } else {
        conversationHtml = chatHistory.map((msg, i) => {
            if (msg.role === 'user') {
                return `
                    <div class="chat-message user">
                        <div class="chat-label">You</div>
                        <div class="chat-text">${escapeHtml(msg.content)}</div>
                    </div>`;
            } else if (msg.role === 'system') {
                return `
                    <div class="chat-message system">
                        <div class="chat-text" style="color: rgba(255,255,255,0.5); font-size: 12px; font-style: italic;">${escapeHtml(msg.content)}</div>
                    </div>`;
            } else if (msg.role === 'task') {
                return renderTaskMessage(msg);
            } else if (msg.role === 'claude-task') {
                return renderClaudeTaskMessage(msg);
            } else {
                // Assistant message - check for tasks
                let tasksHtml = '';
                if (msg.tasks && msg.tasks.length > 0) {
                    tasksHtml = `<div class="chat-tasks-indicator">
                        <span class="tasks-icon">⚡</span>
                        ${msg.tasks.length} task${msg.tasks.length > 1 ? 's' : ''} initiated
                    </div>`;
                }
                return `
                    <div class="chat-message assistant">
                        <div class="chat-label">Graph</div>
                        <div class="chat-text">${formatResponse(msg.content)}</div>
                        ${tasksHtml}
                    </div>`;
            }
        }).join('');

        // Add loading indicator if waiting for response
        if (isLoading) {
            conversationHtml += `
                <div class="chat-message assistant loading">
                    <div class="chat-label">Graph</div>
                    <div class="chat-text"><span class="chat-typing">Thinking...</span></div>
                </div>`;
        }
    }

    const hasHistory = chatHistory.length > 0;

    modal.innerHTML = `
        <div class="chat-content">
            <div class="chat-header">
                <span>Graph Dialogue</span>
                <div class="chat-header-actions">
                    ${hasHistory ? `<span class="chat-clear" onclick="clearChatHistory()" title="New conversation">↺</span>` : ''}
                    <span class="chat-close" onclick="hideChatModal()">&times;</span>
                </div>
            </div>
            <div class="chat-body" id="chat-body">
                ${conversationHtml}
            </div>
            <div class="chat-input-container">
                <textarea id="chat-input" placeholder="${hasHistory ? 'Continue the conversation...' : 'Ask something about your graph...'}" onkeydown="handleChatKeydown(event)"></textarea>
                <button class="chat-send" onclick="sendChatMessage()">Send</button>
            </div>
            <div class="chat-footer">
                <span class="chat-hint">Grounded in ${merged_object?.nodes?.length || 0} concepts · ${chatHistory.length} messages</span>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Scroll to bottom
    const chatBody = document.getElementById('chat-body');
    chatBody.scrollTop = chatBody.scrollHeight;

    // Focus input
    if (!isLoading) {
        document.getElementById('chat-input').focus();
    }
}

function insertChatExample(el) {
    const input = document.getElementById('chat-input');
    if (input) {
        input.value = el.textContent;
        input.focus();
    }
}

function renderTaskMessage(msg) {
    const statusClass = msg.status || 'running';
    const isImplementation = msg.metadata?.type === 'implementation' || msg.serverTaskId;
    const isRunning = statusClass === 'running';

    const statusIcons = {
        running: '⏳',
        completed: '✓',
        failed: '✗'
    };
    const statusLabels = {
        running: isImplementation ? 'Building...' : 'Running',
        completed: 'Completed',
        failed: 'Failed'
    };

    const taskTypeIcon = isImplementation ? '🔨' : '🔍';
    const taskTypeClass = isImplementation ? 'implement' : 'research';

    let resultHtml = '';

    // Show live output while running
    if (isRunning && isImplementation) {
        const outputLines = msg.outputLines || 0;
        const lastOutput = msg.lastOutput || '';
        const liveFiles = msg.liveFiles || [];

        resultHtml = `
            <div class="task-live">
                <div class="task-live-header">
                    <span class="live-indicator"></span>
                    <span>Live Output</span>
                    <span class="live-lines">${outputLines} lines</span>
                    ${msg.serverTaskId ? `<button class="view-logs-btn" onclick="viewTaskLogs('${msg.serverTaskId}')">View Full Log</button>` : ''}
                </div>
                <div class="task-live-output"><pre>${escapeHtml(lastOutput) || 'Starting...'}</pre></div>
                ${liveFiles.length > 0 ? `
                    <div class="task-live-files">
                        <span class="impl-label">Files (${liveFiles.length}):</span>
                        ${liveFiles.slice(-8).map(f => `<span class="impl-file">${escapeHtml(f)}</span>`).join('')}
                    </div>
                ` : ''}
            </div>`;
    } else if (msg.result && msg.status === 'completed') {
        // Clean result - remove graph blocks for display
        let cleanResult = msg.result.replace(/```graph[\s\S]*?```/g, '').trim();

        if (isImplementation && msg.metadata?.files?.length > 0) {
            // Show implementation-specific result
            resultHtml = `
                <div class="task-result implementation">
                    <div class="impl-success">✓ Implementation complete</div>
                    <div class="impl-location">
                        <span class="impl-label">Location:</span>
                        <code>${msg.metadata.workingDir}</code>
                        <button class="open-folder-btn" onclick="copyToClipboard('${msg.metadata.workingDir}')">Copy Path</button>
                    </div>
                    <div class="impl-files">
                        <span class="impl-label">Files created (${msg.metadata.files.length}):</span>
                        <div class="impl-file-list">
                            ${msg.metadata.files.slice(0, 15).map(f => `<span class="impl-file">${escapeHtml(f)}</span>`).join('')}
                            ${msg.metadata.files.length > 15 ? `<span class="impl-more">+${msg.metadata.files.length - 15} more</span>` : ''}
                        </div>
                    </div>
                    ${msg.metadata.serverTaskId ? `<button class="view-logs-btn" onclick="viewTaskLogs('${msg.metadata.serverTaskId}')">View Build Log</button>` : ''}
                </div>`;
        } else {
            if (cleanResult.length > 500) {
                cleanResult = cleanResult.substring(0, 500) + '...';
            }
            resultHtml = `<div class="task-result">${formatResponse(cleanResult)}</div>`;
        }
    } else if (msg.result && msg.status === 'failed') {
        resultHtml = `<div class="task-error">${escapeHtml(msg.result)}</div>`;
    }

    return `
        <div class="chat-message task ${statusClass} ${taskTypeClass}">
            <div class="task-header">
                <span class="task-icon">${statusIcons[statusClass]}</span>
                <span class="task-type-icon">${taskTypeIcon}</span>
                <span class="task-label">${escapeHtml(msg.description)}</span>
                <span class="task-status ${statusClass}">${statusLabels[statusClass]}</span>
            </div>
            ${resultHtml}
        </div>`;
}

function renderClaudeTaskMessage(msg) {
    const isRunning = msg.status === 'running';
    const isFailed = msg.status === 'failed';
    const isCompleted = msg.status === 'completed';

    // Calculate elapsed time
    const elapsed = msg.endTime
        ? Math.round((msg.endTime - msg.startTime) / 1000)
        : Math.round((Date.now() - msg.startTime) / 1000);

    const formatElapsed = (secs) => {
        if (secs < 60) return `${secs}s`;
        const mins = Math.floor(secs / 60);
        const remainSecs = secs % 60;
        return `${mins}m ${remainSecs}s`;
    };

    const statusIcon = isRunning ? '◉' : (isFailed ? '✗' : '✓');
    const statusClass = isRunning ? 'running' : (isFailed ? 'failed' : 'completed');
    const statusLabel = isRunning ? 'Running' : (isFailed ? 'Failed' : 'Completed');

    let progressHtml = '';
    if (isRunning) {
        progressHtml = `
            <div class="claude-task-progress">
                <span class="progress-spinner"></span>
                <span class="progress-lines">${msg.outputLines || 0} lines</span>
                <span class="progress-elapsed">${formatElapsed(elapsed)}</span>
            </div>
            ${msg.lastOutput ? `<div class="claude-task-preview"><pre>${escapeHtml(msg.lastOutput)}</pre></div>` : ''}
        `;
    } else if (isCompleted) {
        progressHtml = `
            <div class="claude-task-complete">
                <span class="complete-time">Completed in ${formatElapsed(elapsed)}</span>
                ${msg.nodesAdded ? `<span class="complete-nodes">+${msg.nodesAdded} nodes</span>` : ''}
            </div>
        `;
    } else if (isFailed) {
        progressHtml = `<div class="claude-task-error">${escapeHtml(msg.error || 'Unknown error')}</div>`;
    }

    return `
        <div class="chat-message claude-task ${statusClass}">
            <div class="claude-task-header">
                <span class="claude-task-icon ${statusClass}">${statusIcon}</span>
                <span class="claude-task-label">Claude Code</span>
                <span class="claude-task-status ${statusClass}">${statusLabel}</span>
            </div>
            <div class="claude-task-desc">${escapeHtml(msg.description)}</div>
            ${progressHtml}
            ${msg.taskId ? `<button class="view-logs-btn" onclick="viewTaskLogs('${msg.taskId}')">View Logs</button>` : ''}
        </div>`;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Brief visual feedback could be added here
    });
}

function toggleTaskResult(taskId) {
    const el = document.getElementById(`task-result-${taskId}`);
    if (el) {
        el.classList.toggle('expanded');
    }
}

function hideChatModal() {
    const existing = document.getElementById('chat-modal');
    if (existing) existing.remove();
}

function setChatLoading(loading) {
    const sendBtn = document.querySelector('.chat-send');
    const input = document.getElementById('chat-input');
    if (sendBtn) {
        sendBtn.disabled = loading;
        sendBtn.textContent = loading ? '...' : 'Send';
    }
    if (input) {
        input.disabled = loading;
    }
}

function clearChatHistory() {
    chatHistory = [];
    saveChatHistory();
    hideChatModal();
    logToPanel('action', 'Chat Cleared', { stats: 'Started new conversation' });
}

function saveChatHistory() {
    // Save to IndexedDB
    if (typeof saveChatForGraph === 'function' && currentGraphId) {
        saveChatForGraph(currentGraphId, chatHistory).catch(e => {
            console.warn('Could not save chat history:', e);
        });
    }
}

function loadChatHistory() {
    // Now handled by initializeStorage in index.html
    // This function kept for backward compatibility
}


function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatResponse(text) {
    // Convert markdown-style formatting to HTML
    return escapeHtml(text)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>')
        .replace(/^/, '<p>')
        .replace(/$/, '</p>');
}

// ============ GRAPH MERGE FUNCTIONS ============

async function mergeGraphsWithClaude(graphs) {
    /**
     * Merge multiple graphs using Claude to find connections and create a unified graph.
     * graphs: Array of graph objects from IndexedDB
     */
    if (graphs.length < 2) {
        alert('Need at least 2 graphs to merge');
        return;
    }

    const graphNames = graphs.map(g => g.name).join(', ');
    addChatMessage('system', `Merging ${graphs.length} graphs: ${graphNames}`);
    showChatModal(true);

    // Show merge progress
    showMergeProgress(0, graphs.length);

    // Combine all nodes from all graphs
    const allNodes = [];
    const nodesByGraph = {};

    graphs.forEach((g, idx) => {
        const graphNodes = g.data?.merged_object?.nodes || [];
        nodesByGraph[g.name] = graphNodes;
        graphNodes.forEach(n => {
            allNodes.push({
                ...n,
                sourceGraph: g.name,
                sourceGraphIdx: idx
            });
        });
    });

    updateMergeProgress(1, 3, 'Analyzing graph structures...');

    // Build prompt for Claude to analyze and merge
    const graphSummaries = graphs.map(g => {
        const nodes = g.data?.merged_object?.nodes || [];
        const nodeList = nodes.slice(0, 30).map(n =>
            `  - ${n.name || n.properties?.name}: ${(n.description || n.properties?.description || '').slice(0, 100)}`
        ).join('\n');
        return `
GRAPH: "${g.name}" (${nodes.length} nodes)
${nodeList}${nodes.length > 30 ? `\n  ... and ${nodes.length - 30} more` : ''}`;
    }).join('\n\n');

    const mergePrompt = `You are a knowledge graph architect. Analyze these ${graphs.length} graphs and merge them into a unified, higher-order knowledge graph.

${graphSummaries}

YOUR TASK:
1. IDENTIFY OVERLAPS: Find concepts that appear in multiple graphs (same or similar names/meanings)
2. FIND CROSS-GRAPH CONNECTIONS: Identify relationships between concepts from DIFFERENT graphs that aren't explicitly connected
3. SYNTHESIZE META-CONCEPTS: Create higher-order concepts that unify themes across graphs
4. CREATE BRIDGE RELATIONSHIPS: Connect concepts across graph boundaries

RULES:
- Deduplicate: If the same concept appears in multiple graphs, keep ONE version with the best description
- Connect: Find at least 10 meaningful cross-graph relationships
- Synthesize: Create 3-5 meta-concepts that represent themes spanning multiple graphs
- Preserve: Don't lose important concepts from any source graph

Return JSON:
{
  "summary": "Brief description of the merged graph and key insights discovered",
  "mergedNodes": [
    {
      "name": "Concept Name",
      "description": "Unified/enhanced description",
      "type": "Concept|Mechanism|Synthesis|Meta",
      "sourceGraphs": ["Graph1", "Graph2"],
      "connectsTo": ["Related Concept 1", "Related Concept 2"]
    }
  ],
  "newConnections": [
    {
      "from": "Concept A",
      "to": "Concept B",
      "relationship": "RELATES_TO|ENABLES|EXTENDS|CONTRADICTS|SYNTHESIZES",
      "reason": "Why these concepts are connected"
    }
  ],
  "metaConcepts": [
    {
      "name": "Higher-Order Theme",
      "description": "What this meta-concept represents",
      "unifies": ["Concept1", "Concept2", "Concept3"]
    }
  ],
  "stats": {
    "totalInputNodes": ${allNodes.length},
    "mergedNodes": <number>,
    "newConnections": <number>,
    "deduplicatedCount": <number>
  }
}

Be thorough - this is about creating a RICHER, more connected knowledge graph, not just concatenating nodes.`;

    try {
        updateMergeProgress(2, 3, 'Claude is analyzing and merging...');

        const response = await fetch("http://localhost:8765/v1/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                prompt: mergePrompt,
                model: "claude-opus-4-5-20251101"
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const text = data.choices[0].text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            throw new Error('No valid JSON in response');
        }

        const result = JSON.parse(jsonMatch[0]);
        console.log('Merge result:', result);

        updateMergeProgress(3, 3, 'Building merged graph...');

        // Create the merged graph
        const mergedNodes = result.mergedNodes || [];
        const newConnections = result.newConnections || [];
        const metaConcepts = result.metaConcepts || [];

        // Build the new merged_object
        const newMergedObject = {
            nodes: [],
            relationships: []
        };

        // Add merged nodes
        mergedNodes.forEach((n, idx) => {
            newMergedObject.nodes.push({
                id: idx + 1,
                name: n.name,
                description: n.description,
                type: n.type || 'Concept',
                labels: [n.type || 'Concept'],
                properties: {
                    name: n.name,
                    description: n.description,
                    sourceGraphs: (n.sourceGraphs || []).join(', '),
                    connectsTo: (n.connectsTo || []).join(', ')
                }
            });
        });

        // Add meta-concepts
        metaConcepts.forEach((m, idx) => {
            newMergedObject.nodes.push({
                id: mergedNodes.length + idx + 1,
                name: m.name,
                description: m.description,
                type: 'Synthesis',
                labels: ['Synthesis'],
                properties: {
                    name: m.name,
                    description: m.description,
                    unifies: (m.unifies || []).join(', ')
                }
            });
        });

        // Build relationships from connectsTo
        newMergedObject.nodes.forEach(node => {
            const connectsTo = node.properties?.connectsTo?.split(', ').filter(Boolean) || [];
            connectsTo.forEach(targetName => {
                const targetNode = newMergedObject.nodes.find(n =>
                    (n.name || n.properties?.name) === targetName
                );
                if (targetNode) {
                    newMergedObject.relationships.push({
                        startNodeId: node.id,
                        endNodeId: targetNode.id,
                        type: 'RELATES_TO'
                    });
                }
            });
        });

        // Add explicit new connections
        newConnections.forEach(conn => {
            const fromNode = newMergedObject.nodes.find(n =>
                (n.name || n.properties?.name) === conn.from
            );
            const toNode = newMergedObject.nodes.find(n =>
                (n.name || n.properties?.name) === conn.to
            );
            if (fromNode && toNode) {
                newMergedObject.relationships.push({
                    startNodeId: fromNode.id,
                    endNodeId: toNode.id,
                    type: conn.relationship || 'RELATES_TO'
                });
            }
        });

        // Connect meta-concepts to unified nodes
        metaConcepts.forEach((m, idx) => {
            const metaNode = newMergedObject.nodes.find(n =>
                (n.name || n.properties?.name) === m.name
            );
            if (metaNode) {
                (m.unifies || []).forEach(unifiedName => {
                    const unifiedNode = newMergedObject.nodes.find(n =>
                        (n.name || n.properties?.name) === unifiedName
                    );
                    if (unifiedNode) {
                        newMergedObject.relationships.push({
                            startNodeId: metaNode.id,
                            endNodeId: unifiedNode.id,
                            type: 'SYNTHESIZES'
                        });
                    }
                });
            }
        });

        hideMergeProgress();

        // Ask user for name
        const mergedName = prompt(
            'Enter a name for the merged graph:',
            `Merged: ${graphs.map(g => g.name).join(' + ')}`
        );

        if (mergedName === null) {
            addChatMessage('system', 'Merge cancelled.');
            return;
        }

        // Save as new graph
        merged_object = newMergedObject;
        merged_object_history = [{ merged_object: JSON.parse(JSON.stringify(merged_object)) }];
        merged_object_history_index = 0;
        currentGraphId = generateGraphId();

        await saveGraph({}, mergedName || 'Merged Graph');

        // Update UI
        updateCurrentGraphName(mergedName);
        renderGraph(merged_object);

        // Report results
        const stats = result.stats || {};
        addChatMessage('assistant', result.summary || 'Graphs merged successfully.');
        addChatMessage('system', `
Merge complete!
• Input: ${stats.totalInputNodes || allNodes.length} nodes from ${graphs.length} graphs
• Output: ${newMergedObject.nodes.length} nodes, ${newMergedObject.relationships.length} relationships
• New connections discovered: ${newConnections.length}
• Meta-concepts created: ${metaConcepts.length}
• Deduplicated: ${stats.deduplicatedCount || 'N/A'} nodes
        `.trim());

        showChatModal();

    } catch (error) {
        console.error('Merge failed:', error);
        hideMergeProgress();
        addChatMessage('system', `Merge failed: ${error.message}`);
        showChatModal();
    }
}

function showMergeProgress(current, total, message = 'Preparing...') {
    let progressBar = document.getElementById('merge-progress');
    if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.id = 'merge-progress';
        progressBar.innerHTML = `
            <div class="merge-progress-inner">
                <div class="merge-progress-header">
                    <span class="merge-progress-title">Merging Graphs</span>
                    <span class="merge-progress-step">Step ${current}/${total}</span>
                </div>
                <div class="merge-progress-bar-container">
                    <div class="merge-progress-bar" style="width: 0%"></div>
                </div>
                <div class="merge-progress-message">${message}</div>
            </div>
        `;
        document.body.appendChild(progressBar);
    }
    updateMergeProgress(current, total, message);
}

function updateMergeProgress(current, total, message) {
    const progressBar = document.getElementById('merge-progress');
    if (!progressBar) return;

    const percent = Math.round((current / total) * 100);
    const stepEl = progressBar.querySelector('.merge-progress-step');
    const barEl = progressBar.querySelector('.merge-progress-bar');
    const msgEl = progressBar.querySelector('.merge-progress-message');

    if (stepEl) stepEl.textContent = `Step ${current}/${total}`;
    if (barEl) barEl.style.width = `${percent}%`;
    if (msgEl) msgEl.textContent = message;
}

function hideMergeProgress() {
    const progressBar = document.getElementById('merge-progress');
    if (progressBar) {
        progressBar.classList.add('fade-out');
        setTimeout(() => progressBar.remove(), 500);
    }
}
