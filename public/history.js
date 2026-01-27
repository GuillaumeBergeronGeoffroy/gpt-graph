let merged_object_history = [];
let merged_object_history_index = 0;

function addToHistory(merged_object) {
    merged_object_history = [...merged_object_history, {
        merged_object : JSON.parse(JSON.stringify(merged_object)),
        prompt: nodePrompt.value || '',
    }];
    merged_object_history_index = merged_object_history.length - 1;

    // Auto-save to IndexedDB (debounced)
    if (typeof triggerAutoSave === 'function') {
        triggerAutoSave();
    }
}

// undo function to move tree to tree history previous state
function undo() {
    if(merged_object_history_index - 1 >= 0) {
        merged_object_history_index--;
        merged_object = JSON.parse(JSON.stringify(merged_object_history[merged_object_history_index].merged_object));
        resetGraphBasedOnHistory(true);
    }
}
// redo function to move tree to tree history next state
function redo() {
    if(merged_object_history_index + 1 < merged_object_history.length) {
        merged_object_history_index++;
        merged_object = JSON.parse(JSON.stringify(merged_object_history[merged_object_history_index].merged_object));
        resetGraphBasedOnHistory(true);
    }
}

function resetGraphBasedOnHistory(restorePrompt = false) {
    renderGraph(merged_object, true);
    if (restorePrompt && merged_object_history[merged_object_history_index]?.prompt) {
        nodePrompt.value = merged_object_history[merged_object_history_index].prompt;
    }
}

function initializeHistoryFromLocalStorage() {
    // if tree is stored in local storage set it to tree variable and then call the renderTree function
    try {
       let graphHistory = localStorage.getItem('graphHistory');
       if(graphHistory) {
            merged_object_history = JSON.parse(graphHistory);
            merged_object_history_index = merged_object_history.length - 1;
            merged_object = JSON.parse(JSON.stringify(merged_object_history[merged_object_history_index].merged_object));
            resetGraphBasedOnHistory();
       } else {
            throw new Error('No graph history found');
       }
   } catch (error) {
       console.log(error)
   }
}

function confirmClearHistory() {
    // If no graph exists, just return
    if (!merged_object?.nodes?.length) return;

    // Show confirm modal
    const modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.innerHTML = `
        <div class="confirm-content">
            <div class="confirm-title">Clear Graph?</div>
            <div class="confirm-message">This will delete all ${merged_object.nodes.length} nodes and ${merged_object.relationships.length} relationships. This cannot be undone.</div>
            <div class="confirm-actions">
                <button class="confirm-btn cancel" onclick="hideConfirmModal()">Cancel</button>
                <button class="confirm-btn danger" onclick="clearHistory(); hideConfirmModal()">Clear All</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function hideConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.remove();
}

async function clearHistory() {
    merged_object = { nodes: [], relationships: [] };
    merged_object_history = [];
    merged_object_history_index = 0;

    d3.select("#graph").selectAll("svg").remove();
    nodePrompt.value = '';

    // Clear activity log
    if (typeof setActivityLog === 'function') {
        setActivityLog([]);
    }

    // Clear chat history
    if (typeof chatHistory !== 'undefined') {
        chatHistory = [];
    }

    // Save cleared state to IndexedDB
    if (typeof saveGraph === 'function' && currentGraphId) {
        try {
            await saveGraph({});
            await saveChatForGraph(currentGraphId, []);
        } catch (e) {
            console.warn('Failed to save cleared state:', e);
        }
    }

    // Update counter
    if (typeof updateGraphCounter === 'function') {
        updateGraphCounter();
    }
}

function handleHistoryEvents(event) {
    // CMD + ESC to clear tree (with confirmation)
    if((event.metaKey || event.ctrlKey) && event.key === 'Escape') {
        event.preventDefault();
        confirmClearHistory();
    }
    // CMD + Z to undo
    if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
        event.preventDefault();
        undo();
    }
    // CMD + Y to redo
    if ((event.metaKey || event.ctrlKey) && event.key === 'y') {
        event.preventDefault();
        redo();
    }
}