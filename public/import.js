
function handleImportEvents(event) {    
    // CMD + I to import tree
    if((event.metaKey || event.ctrlKey) && event.key === 'i') {
        event.preventDefault();
        document.getElementById('import-graph').click();
    }
}

// import tree on file upload
function importGraphHistory() {
    const file = document.getElementById('import-tree').files[0];
    const reader = new FileReader();
    reader.onload = function(e) {
        const fileContent = e.target.result;
        try {
            merged_object_history = JSON.parse(fileContent);
            merged_object_history_index = merged_object_history.length - 1;
            merged_object = JSON.parse(JSON.stringify(merged_object_history[merged_object_history_index].merged_object));
            resetGraphBasedOnHistory();
        } catch (error) {
            console.log(error);
        }
    };
    reader.readAsText(file);
}