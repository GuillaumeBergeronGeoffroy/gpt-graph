// Storage for Gestalt
// Server is the single source of truth for graph data
// Chat history stored in IndexedDB (can be large, not needed by Claude Code)

const SERVER_URL = 'http://localhost:8765';

let currentGraphId = localStorage.getItem('gestalt-currentGraphId') || null;
let chatDB = null;

// ============ CHAT INDEXEDDB SETUP ============

function initChatDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('gestalt-chats', 1);

        request.onerror = () => {
            console.error('Chat DB error:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            chatDB = request.result;
            resolve(chatDB);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('chats')) {
                db.createObjectStore('chats', { keyPath: 'graphId' });
            }
        };
    });
}

// Migrate chats from old 'gestalt-db' to new 'gestalt-chats' if needed
async function migrateLegacyChats() {
    if (localStorage.getItem('gestalt-chats-migrated-v3')) {
        return;
    }

    return new Promise((resolve) => {
        try {
            const request = indexedDB.open('gestalt-db', 1);

            request.onerror = () => {
                localStorage.setItem('gestalt-chats-migrated-v3', 'true');
                resolve();
            };

            request.onsuccess = () => {
                const oldDB = request.result;

                if (!oldDB.objectStoreNames.contains('chats')) {
                    localStorage.setItem('gestalt-chats-migrated-v3', 'true');
                    oldDB.close();
                    resolve();
                    return;
                }

                const tx = oldDB.transaction('chats', 'readonly');
                const store = tx.objectStore('chats');
                const getAllRequest = store.getAll();

                getAllRequest.onsuccess = async () => {
                    const chats = getAllRequest.result || [];
                    let migratedCount = 0;

                    for (const chat of chats) {
                        if (chat.graphId && chat.history && chat.history.length > 0) {
                            await saveChatForGraph(chat.graphId, chat.history);
                            migratedCount++;
                        }
                    }

                    if (migratedCount > 0) {
                        console.log(`Migrated ${migratedCount} chat histories to new DB`);
                    }

                    // Also migrate currentGraphId from old settings
                    if (oldDB.objectStoreNames.contains('settings') && !currentGraphId) {
                        const settingsTx = oldDB.transaction('settings', 'readonly');
                        const settingsStore = settingsTx.objectStore('settings');
                        const getReq = settingsStore.get('currentGraphId');
                        getReq.onsuccess = () => {
                            if (getReq.result?.value) {
                                currentGraphId = getReq.result.value;
                                localStorage.setItem('gestalt-currentGraphId', currentGraphId);
                                console.log('Migrated currentGraphId:', currentGraphId);
                            }
                        };
                    }

                    localStorage.setItem('gestalt-chats-migrated-v3', 'true');
                    oldDB.close();
                    resolve();
                };

                getAllRequest.onerror = () => {
                    localStorage.setItem('gestalt-chats-migrated-v3', 'true');
                    oldDB.close();
                    resolve();
                };
            };

            request.onupgradeneeded = () => {
                localStorage.setItem('gestalt-chats-migrated-v3', 'true');
                resolve();
            };
        } catch (e) {
            console.warn('Legacy chat migration failed:', e);
            localStorage.setItem('gestalt-chats-migrated-v3', 'true');
            resolve();
        }
    });
}

// ============ GRAPH OPERATIONS (Server-backed) ============

function generateGraphId() {
    return 'graph-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
}

async function saveGraph(graphData = {}, name = null) {
    const id = currentGraphId || generateGraphId();
    currentGraphId = id;
    localStorage.setItem('gestalt-currentGraphId', id);

    const graph = {
        nodes: graphData.merged_object?.nodes || merged_object?.nodes || [],
        relationships: graphData.merged_object?.relationships || merged_object?.relationships || [],
        title: name || graphData.name || '',
        // Include history for undo/redo support
        history: graphData.history || merged_object_history || [],
        historyIndex: graphData.historyIndex ?? merged_object_history_index ?? 0
    };

    try {
        const response = await fetch(`${SERVER_URL}/v1/graph?id=${encodeURIComponent(id)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(graph)
        });

        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        const result = await response.json();
        console.log('Saved graph to server:', id, result);
        return id;
    } catch (e) {
        console.error('Failed to save graph:', e.message);
        throw e;
    }
}

async function loadGraph(graphId) {
    try {
        const response = await fetch(`${SERVER_URL}/v1/graph?id=${encodeURIComponent(graphId)}`);
        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`Server error: ${response.status}`);
        }

        const graph = await response.json();
        currentGraphId = graphId;
        localStorage.setItem('gestalt-currentGraphId', graphId);

        // Return in the format expected by the app
        return {
            id: graphId,
            name: graph.title || graphId,
            data: {
                merged_object: {
                    nodes: graph.nodes || [],
                    relationships: graph.relationships || []
                },
                history: graph.history || [],
                historyIndex: graph.historyIndex || 0
            },
            nodeCount: graph.nodes?.length || 0,
            relCount: graph.relationships?.length || 0
        };
    } catch (e) {
        console.error('Failed to load graph:', e.message);
        return null;
    }
}

async function listGraphs() {
    try {
        const response = await fetch(`${SERVER_URL}/v1/graphs`);
        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        const data = await response.json();
        return (data.graphs || []).map(g => ({
            id: g.id,
            name: g.title || g.id,
            nodeCount: g.node_count || 0,
            relCount: g.relationship_count || 0,
            updatedAt: g.updated_at || g.modified_at,
            createdAt: g.created_at
        }));
    } catch (e) {
        console.error('Failed to list graphs:', e.message);
        return [];
    }
}

async function deleteGraph(graphId) {
    try {
        const response = await fetch(`${SERVER_URL}/v1/graph?id=${encodeURIComponent(graphId)}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        if (currentGraphId === graphId) {
            currentGraphId = null;
            localStorage.removeItem('gestalt-currentGraphId');
        }

        // Also delete chat for this graph
        await deleteChatForGraph(graphId);

        return true;
    } catch (e) {
        console.error('Failed to delete graph:', e.message);
        return false;
    }
}

async function renameGraph(graphId, newName) {
    const graph = await loadGraph(graphId);
    if (graph) {
        graph.name = newName;
        await saveGraph({
            merged_object: graph.data.merged_object,
            history: graph.data.history,
            historyIndex: graph.data.historyIndex,
            name: newName
        });
    }
}

// ============ CHAT OPERATIONS (IndexedDB) ============

async function saveChatForGraph(graphId, chatHistoryData) {
    if (!chatDB) await initChatDB();

    return new Promise((resolve, reject) => {
        const tx = chatDB.transaction('chats', 'readwrite');
        const store = tx.objectStore('chats');
        const request = store.put({
            graphId: graphId,
            history: chatHistoryData,
            updatedAt: Date.now()
        });

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function loadChatForGraph(graphId) {
    if (!chatDB) await initChatDB();

    return new Promise((resolve, reject) => {
        const tx = chatDB.transaction('chats', 'readonly');
        const store = tx.objectStore('chats');
        const request = store.get(graphId);

        request.onsuccess = () => {
            resolve(request.result?.history || []);
        };
        request.onerror = () => reject(request.error);
    });
}

async function deleteChatForGraph(graphId) {
    if (!chatDB) await initChatDB();

    return new Promise((resolve, reject) => {
        const tx = chatDB.transaction('chats', 'readwrite');
        const store = tx.objectStore('chats');
        const request = store.delete(graphId);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ============ SETTINGS ============

function saveCurrentGraphId(graphId) {
    currentGraphId = graphId;
    if (graphId) {
        localStorage.setItem('gestalt-currentGraphId', graphId);
    } else {
        localStorage.removeItem('gestalt-currentGraphId');
    }
}

function getCurrentGraphId() {
    return currentGraphId || localStorage.getItem('gestalt-currentGraphId');
}

// ============ INITIALIZATION ============

async function initializeStorage() {
    // Initialize chat DB
    await initChatDB();

    // Migrate from legacy IndexedDB if needed
    await migrateLegacyChats();

    // Check if server is available
    try {
        const response = await fetch(`${SERVER_URL}/health`);
        if (!response.ok) throw new Error('Server not healthy');
        console.log('Connected to server');
    } catch (e) {
        console.error('Server not available. Please start server.py');
        return null;
    }

    // Load last used graph
    const lastGraphId = getCurrentGraphId();
    if (lastGraphId) {
        const graph = await loadGraph(lastGraphId);
        if (graph) {
            return graph;
        }
    }

    // No saved graph, check if server has any graphs
    const graphs = await listGraphs();
    if (graphs.length > 0) {
        const graph = await loadGraph(graphs[0].id);
        if (graph) {
            return graph;
        }
    }

    return null;
}

// ============ AUTO-SAVE ============

let saveTimeout = null;

function triggerAutoSave() {
    if (saveTimeout) clearTimeout(saveTimeout);

    saveTimeout = setTimeout(async () => {
        if (merged_object?.nodes?.length > 0) {
            try {
                await saveGraph({});
                console.log('Auto-saved graph');
            } catch (e) {
                console.warn('Auto-save failed:', e);
            }
        }
    }, 2000);
}

// ============ CLAUDE CODE TASK EXECUTION ============

async function executeClaudeTask(prompt, options = {}) {
    const { workingDir, async: asyncMode = true } = options;

    // Save current graph first so Claude can see latest state
    if (merged_object?.nodes?.length > 0) {
        await saveGraph({});
    }

    try {
        const response = await fetch(`${SERVER_URL}/v1/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: prompt,
                working_dir: workingDir,
                async: asyncMode,
                graph_id: currentGraphId || 'default'
            })
        });

        const result = await response.json();
        return result;
    } catch (e) {
        console.error('Claude task execution failed:', e);
        throw e;
    }
}

async function pollTaskStatus(taskId, { onProgress, onComplete, interval = 2000 } = {}) {
    const poll = async () => {
        try {
            const response = await fetch(`${SERVER_URL}/v1/tasks/${taskId}`);
            const task = await response.json();

            if (onProgress) onProgress(task);

            if (task.status === 'completed') {
                await reloadGraphFromServer();
                if (onComplete) onComplete(task);
                return task;
            } else if (task.status === 'failed') {
                throw new Error(task.error || 'Task failed');
            } else {
                return new Promise(resolve => {
                    setTimeout(() => resolve(poll()), interval);
                });
            }
        } catch (e) {
            console.error('Poll error:', e);
            throw e;
        }
    };

    return poll();
}

// ============ RELOAD FROM SERVER ============

async function reloadGraphFromServer() {
    const gid = currentGraphId || 'default';

    try {
        const response = await fetch(`${SERVER_URL}/v1/graph?id=${encodeURIComponent(gid)}`);
        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        const serverGraph = await response.json();

        if (serverGraph?.nodes?.length > 0) {
            const oldCount = merged_object?.nodes?.length || 0;
            merged_object = {
                nodes: serverGraph.nodes,
                relationships: serverGraph.relationships || []
            };

            const newCount = merged_object.nodes.length;
            if (newCount !== oldCount) {
                console.log(`Reloaded graph from server: ${oldCount} -> ${newCount} nodes`);
            }

            renderGraph(merged_object);
            return { reloaded: true, nodeCount: newCount };
        }

        return { reloaded: false, nodeCount: merged_object?.nodes?.length || 0 };
    } catch (e) {
        console.warn('Failed to reload from server:', e.message);
        return null;
    }
}

// Legacy aliases for compatibility
async function syncToServer() {
    return saveGraph({});
}

async function pullFromServer() {
    return reloadGraphFromServer();
}
