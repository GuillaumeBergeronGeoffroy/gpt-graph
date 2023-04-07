function handleFocus(event) {
    addGeneratePrompt(nodePrompt);
}

function handleInput(event) {
    const divElement = event.target;
    const spanElement = divElement.querySelector('.submit-prompt');

    // Check if the div is empty other than the span
    if (divElement.childNodes.length === 1 && divElement.childNodes[0] === spanElement) {
        // Remove the span element from the div
        spanElement && divElement.removeChild(spanElement);
    } else {
        addGeneratePrompt(divElement);
    }
}

function handlePaste(event) {
    const divElement = event.target;
    const spanElement = divElement.querySelector('.submit-prompt');
    spanElement && divElement.removeChild(spanElement);
}

function addGeneratePrompt(div) {
    // remove all divs with class submit-prompt
    document.querySelectorAll('.submit-prompt').forEach(submitPrompt => {
        submitPrompt.remove();
    });
    let submitPrompt = document.createElement('span');
    submitPrompt.classList.add('submit-prompt');
    submitPrompt.innerText = 'Synthesise';
    submitPrompt.contentEditable = false;
    submitPrompt.addEventListener('click', function() {
        // sendPrompt(getVisibleText(document.getElementById(context)));
    });
    div.append(submitPrompt);
}

function registerPromptListeners() {
    nodePrompt = document.getElementById('text-container');
    nodePrompt.addEventListener('focus', handleFocus);
    nodePrompt.addEventListener('input', handleInput);
    nodePrompt.addEventListener('paste', handlePaste);
}