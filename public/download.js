function handleDownloadEvents(event) {
    // on command s save graph 
    if((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        downloadGraph();
    }
}

// download tree as json file with name tree.json
function downloadGraph() {
    const graphName = document.getElementById('current-graph-name')?.textContent || 'graph';
    const safeName = graphName.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    const graphData = {
        name: graphName,
        merged_object_history,
        activityLog: typeof getActivityLog === 'function' ? getActivityLog() : [],
        chatHistory: typeof chatHistory !== 'undefined' ? chatHistory : [],
        exportedAt: new Date().toISOString()
    };
    download(JSON.stringify(graphData, null, 2), `${safeName}.json`);
}

// just the download function receiving a content and a filename
function download(content, fileName) {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(content);
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}