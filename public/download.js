function handleDownloadEvents(event) {
    // on command s save graph 
    if((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        downloadGraph();
    }
}

// download tree as json file with name tree.json
function downloadGraph() {
    graphHistory = {
        merged_object_history,
    }
    download(JSON.stringify(graphHistory), 'graph.json');
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