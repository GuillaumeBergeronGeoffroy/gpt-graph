let merged_object_history = [];
let merged_object_history_index = 0;

function addToHistory(merged_object) {
    if(!history) {
        merged_object_history = [...merged_object_history, {
            merged_object : JSON.parse(JSON.stringify(merged_object)),
            prompt: nodePrompt.innerText,
        }];
        merged_object_history_index = merged_object_history.length - 1;
        localStorage.setItem('graphHistory', JSON.stringify(merged_object_history));
    }
}

// undo function to move tree to tree history previous state
function undo() {
    if(merged_object_history_index - 1 >= 0) {
        merged_object_history_index--;
        merged_object = JSON.parse(JSON.stringify(merged_object_history[merged_object_history_index].merged_object));
        resetGraphBasedOnHistory();
    }                
}
// redo function to move tree to tree history next state
function redo() {
    if(merged_object_history_index + 1 < merged_object_history.length) {
        merged_object_history_index++;
        merged_object = JSON.parse(JSON.stringify(merged_object_history[merged_object_history_index].merged_object));
        resetGraphBasedOnHistory();
    }
}

function resetGraphBasedOnHistory() {
    renderGraph(merged_object, true);
    nodePrompt.innerText = merged_object_history[merged_object_history_index].prompt;
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