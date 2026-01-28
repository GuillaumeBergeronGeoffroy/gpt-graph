// IndexedDB Storage for Gestalt
// Replaces localStorage with unlimited storage + multi-graph support

const DB_NAME = 'gestalt-db';
const DB_VERSION = 1;

let db = null;
let currentGraphId = null;

// Initialize IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('IndexedDB error:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            db = request.result;
            console.log('IndexedDB initialized');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            // Graphs store - each graph has its own entry
            if (!database.objectStoreNames.contains('graphs')) {
                const graphStore = database.createObjectStore('graphs', { keyPath: 'id' });
                graphStore.createIndex('name', 'name', { unique: false });
                graphStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            // Chat history store - separate from graphs
            if (!database.objectStoreNames.contains('chats')) {
                const chatStore = database.createObjectStore('chats', { keyPath: 'graphId' });
            }

            // Settings store
            if (!database.objectStoreNames.contains('settings')) {
                database.createObjectStore('settings', { keyPath: 'key' });
            }

            console.log('IndexedDB schema created');
        };
    });
}

// ============ GRAPH OPERATIONS ============

function generateGraphId() {
    return 'graph-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

async function saveGraph(graphData, name = null) {
    if (!db) await initDB();

    const id = currentGraphId || generateGraphId();
    currentGraphId = id;

    // Try to get existing graph to preserve name and createdAt
    let existingGraph = null;
    try {
        const tx = db.transaction('graphs', 'readonly');
        const store = tx.objectStore('graphs');
        existingGraph = await new Promise((resolve) => {
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    } catch (e) {
        // Ignore errors, just means no existing graph
    }

    const graph = {
        id: id,
        name: name || existingGraph?.name || graphData.name || 'Untitled Graph',
        data: {
            merged_object: graphData.merged_object || merged_object,
            history: graphData.history || merged_object_history,
            historyIndex: graphData.historyIndex ?? merged_object_history_index
        },
        nodeCount: (graphData.merged_object || merged_object)?.nodes?.length || 0,
        relCount: (graphData.merged_object || merged_object)?.relationships?.length || 0,
        createdAt: existingGraph?.createdAt || graphData.createdAt || Date.now(),
        updatedAt: Date.now()
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction('graphs', 'readwrite');
        const store = tx.objectStore('graphs');
        const request = store.put(graph);

        request.onsuccess = () => {
            // Save current graph ID to settings
            saveCurrentGraphId(id);
            resolve(id);
        };
        request.onerror = () => reject(request.error);
    });
}

async function loadGraph(graphId) {
    if (!db) await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction('graphs', 'readonly');
        const store = tx.objectStore('graphs');
        const request = store.get(graphId);

        request.onsuccess = () => {
            const graph = request.result;
            if (graph) {
                currentGraphId = graph.id;
                saveCurrentGraphId(graph.id);
                resolve(graph);
            } else {
                resolve(null);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

async function listGraphs() {
    if (!db) await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction('graphs', 'readonly');
        const store = tx.objectStore('graphs');
        const index = store.index('updatedAt');
        const request = index.openCursor(null, 'prev'); // Most recent first

        const graphs = [];
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                graphs.push({
                    id: cursor.value.id,
                    name: cursor.value.name,
                    nodeCount: cursor.value.nodeCount,
                    relCount: cursor.value.relCount,
                    updatedAt: cursor.value.updatedAt,
                    createdAt: cursor.value.createdAt
                });
                cursor.continue();
            } else {
                resolve(graphs);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

async function deleteGraph(graphId) {
    if (!db) await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['graphs', 'chats'], 'readwrite');

        // Delete graph
        tx.objectStore('graphs').delete(graphId);

        // Delete associated chat
        tx.objectStore('chats').delete(graphId);

        tx.oncomplete = () => {
            if (currentGraphId === graphId) {
                currentGraphId = null;
            }
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
}

async function renameGraph(graphId, newName) {
    if (!db) await initDB();

    const graph = await loadGraph(graphId);
    if (graph) {
        graph.name = newName;
        graph.updatedAt = Date.now();

        return new Promise((resolve, reject) => {
            const tx = db.transaction('graphs', 'readwrite');
            const store = tx.objectStore('graphs');
            const request = store.put(graph);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

// ============ CHAT OPERATIONS ============

async function saveChatForGraph(graphId, chatHistory) {
    if (!db) await initDB();

    const chat = {
        graphId: graphId,
        history: chatHistory,
        updatedAt: Date.now()
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction('chats', 'readwrite');
        const store = tx.objectStore('chats');
        const request = store.put(chat);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function loadChatForGraph(graphId) {
    if (!db) await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction('chats', 'readonly');
        const store = tx.objectStore('chats');
        const request = store.get(graphId);

        request.onsuccess = () => {
            resolve(request.result?.history || []);
        };
        request.onerror = () => reject(request.error);
    });
}

// ============ SETTINGS ============

async function saveCurrentGraphId(graphId) {
    if (!db) await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        const request = store.put({ key: 'currentGraphId', value: graphId });

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function getCurrentGraphId() {
    if (!db) await initDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const request = store.get('currentGraphId');

        request.onsuccess = () => {
            resolve(request.result?.value || null);
        };
        request.onerror = () => reject(request.error);
    });
}

// ============ MIGRATION FROM LOCALSTORAGE ============

async function migrateFromLocalStorage() {
    try {
        const graphHistory = localStorage.getItem('graphHistory');
        const activityLog = localStorage.getItem('activityLog');
        const chatHistoryLS = localStorage.getItem('chatHistory');

        if (graphHistory) {
            const history = JSON.parse(graphHistory);
            if (history && history.length > 0) {
                // Create a new graph from localStorage data
                const lastEntry = history[history.length - 1];

                merged_object_history = history;
                merged_object_history_index = history.length - 1;
                merged_object = JSON.parse(JSON.stringify(lastEntry.merged_object));

                // Save to IndexedDB
                const graphId = await saveGraph({
                    merged_object: merged_object,
                    history: history,
                    historyIndex: merged_object_history_index
                }, 'Migrated Graph');

                console.log('Migrated graph from localStorage:', graphId);

                // Migrate chat history if exists
                if (chatHistoryLS) {
                    const chat = JSON.parse(chatHistoryLS);
                    await saveChatForGraph(graphId, chat);
                }

                // Clear localStorage after successful migration
                localStorage.removeItem('graphHistory');
                localStorage.removeItem('activityLog');
                localStorage.removeItem('chatHistory');

                return graphId;
            }
        }
    } catch (e) {
        console.warn('Migration from localStorage failed:', e);
    }
    return null;
}

// ============ INITIALIZATION ============

async function initializeStorage() {
    await initDB();

    // Try to migrate from localStorage first
    const migratedId = await migrateFromLocalStorage();

    if (migratedId) {
        currentGraphId = migratedId;
        return migratedId;
    }

    // Load last used graph
    const lastGraphId = await getCurrentGraphId();
    if (lastGraphId) {
        const graph = await loadGraph(lastGraphId);
        if (graph) {
            currentGraphId = graph.id;
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
                // Also sync to server for Claude Code integration
                triggerServerSync();
            } catch (e) {
                console.warn('Auto-save failed:', e);
            }
        }
    }, 2000); // Debounce 2 seconds
}

// ============ SERVER SYNC (for Claude Code integration) ============

const SERVER_URL = 'http://localhost:8765';

async function syncToServer() {
    /**
     * Push current graph state to server so Claude Code can read it.
     */
    if (!merged_object?.nodes?.length) {
        console.warn('No graph to sync');
        return null;
    }

    try {
        const gid = currentGraphId || 'default';
        const response = await fetch(`${SERVER_URL}/v1/graph?id=${encodeURIComponent(gid)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nodes: merged_object.nodes,
                relationships: merged_object.relationships || []
            })
        });

        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        const result = await response.json();
        console.log('Synced to server:', result);
        return result;
    } catch (e) {
        console.warn('Server sync failed (is server.py running?):', e.message);
        return null;
    }
}

async function pullFromServer() {
    /**
     * Pull graph state from server (after Claude Code has modified it).
     * Merges server state into current graph.
     */
    try {
        const gid = currentGraphId || 'default';
        const response = await fetch(`${SERVER_URL}/v1/graph?id=${encodeURIComponent(gid)}`);
        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        const serverGraph = await response.json();

        if (serverGraph?.nodes?.length > 0) {
            // Merge server nodes into current graph
            const existingNames = new Set(
                merged_object.nodes.map(n => n.name || n.properties?.name)
            );

            let addedCount = 0;
            for (const node of serverGraph.nodes) {
                const name = node.name || node.properties?.name;
                if (name && !existingNames.has(name)) {
                    // Assign new ID
                    const maxId = Math.max(...merged_object.nodes.map(n => n.id || 0), 0);
                    merged_object.nodes.push({
                        ...node,
                        id: maxId + 1 + addedCount
                    });
                    existingNames.add(name);
                    addedCount++;
                }
            }

            if (addedCount > 0) {
                console.log(`Pulled ${addedCount} new nodes from server`);
                renderGraph(merged_object);
                triggerAutoSave();
            }

            return { added: addedCount, total: merged_object.nodes.length };
        }

        return { added: 0, total: merged_object?.nodes?.length || 0 };
    } catch (e) {
        console.warn('Server pull failed:', e.message);
        return null;
    }
}

async function executeClaudeTask(prompt, options = {}) {
    /**
     * Execute a Claude Code task that can research, read files, etc.
     * Returns the task ID for polling.
     */
    const { workingDir, async: asyncMode = true } = options;

    // First sync current graph to server so Claude can see it
    await syncToServer();

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
    /**
     * Poll a Claude task for completion.
     */
    const poll = async () => {
        try {
            const response = await fetch(`${SERVER_URL}/v1/tasks/${taskId}`);
            const task = await response.json();

            if (onProgress) onProgress(task);

            if (task.status === 'completed') {
                // Pull any new graph data from server
                await pullFromServer();
                if (onComplete) onComplete(task);
                return task;
            } else if (task.status === 'failed') {
                throw new Error(task.error || 'Task failed');
            } else {
                // Still running, poll again
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

// Auto-sync to server when graph changes (debounced)
let serverSyncTimeout = null;

function triggerServerSync() {
    if (serverSyncTimeout) clearTimeout(serverSyncTimeout);

    serverSyncTimeout = setTimeout(async () => {
        await syncToServer();
    }, 5000); // Sync every 5 seconds after changes
}
