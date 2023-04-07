function registerApiKeyListeners() {
    document.getElementById('api-key').addEventListener('input', () => {
        apiKey = document.getElementById('api-key').innerText;
        try {
            localStorage.setItem('api-key', apiKey);
        } catch (error) {
            console.log(error);
        }
    });
}
function loadApiKey() {
    // on document load if api-key is stored in local storage set it to api-key div
    try {
        apiKey = localStorage.getItem('api-key');
        if(apiKey) {
            document.getElementById('api-key').innerText = apiKey;
        } else {
            throw new Error('No api key found');
        }
    } catch (error) {
        console.log(error);
        document.querySelector('.settings-img').click();
    }
}

