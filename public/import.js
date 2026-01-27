function handleImportEvents(event) {
    // CMD + I to import tree
    if((event.metaKey || event.ctrlKey) && event.key === 'i') {
        event.preventDefault();
        document.getElementById('import-graph').click();
    }
}

// import graph on file upload
async function importGraph() {
    const file = document.getElementById('import-graph').files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        const fileContent = e.target.result;
        try {
            const imported = JSON.parse(fileContent);

            // Handle both formats: full history or just graph
            if (imported.merged_object_history) {
                merged_object_history = imported.merged_object_history;
                merged_object_history_index = merged_object_history.length - 1;
                merged_object = JSON.parse(JSON.stringify(merged_object_history[merged_object_history_index].merged_object));
            } else if (imported.nodes && imported.relationships) {
                merged_object = imported;
                merged_object_history = [{ merged_object: imported, prompt: '' }];
                merged_object_history_index = 0;
            }

            // Restore activity log if present
            if (imported.activityLog && typeof setActivityLog === 'function') {
                setActivityLog(imported.activityLog);
            }

            // Restore chat history if present
            if (imported.chatHistory && typeof chatHistory !== 'undefined') {
                chatHistory = imported.chatHistory;
            }

            // Create new graph in IndexedDB
            const graphName = imported.name || file.name.replace('.json', '') || 'Imported Graph';

            if (typeof saveGraph === 'function') {
                currentGraphId = generateGraphId();
                await saveGraph({
                    merged_object: merged_object,
                    history: merged_object_history,
                    historyIndex: merged_object_history_index
                }, graphName);

                if (imported.chatHistory) {
                    await saveChatForGraph(currentGraphId, chatHistory);
                }

                // Update UI
                if (typeof updateCurrentGraphName === 'function') {
                    updateCurrentGraphName(graphName);
                }
            }

            renderGraph(merged_object);
            logToPanel('result', 'Graph Imported', {
                stats: `${merged_object.nodes.length} nodes, ${merged_object.relationships.length} relationships`
            });
        } catch (error) {
            console.error('Import error:', error);
            logToPanel('error', 'Import Failed', { error: error.message });
        }
    };
    reader.readAsText(file);

    // Clear file input so same file can be re-imported
    document.getElementById('import-graph').value = '';
}
