let apiKey = null

// add event listener on settings image click toggle image to another image or original image
function registerSettingsListeners() { 
    document.querySelector('.settings-img').addEventListener('click', () => {
        const settingsImg = document.querySelector('.settings-img');
        if(settingsImg.src.includes('img/gear.png')) {
            settingsImg.src = 'img/close.png';
            // scrollToBottom of page
            // show all class setting-prompt 
            document.querySelectorAll('.setting-prompt').forEach(setting => {
                setting.classList.add('active');
            });
            setTimeout(() => {
                // scroll to center of api-key id div
                document.getElementById('api-key').scrollIntoView({behavior: 'smooth', block: 'center'});
            }, 500);
        } else {
            settingsImg.src = 'img/gear.png';
            // hide all class setting-prompt
            document.querySelectorAll('.setting-prompt').forEach(setting => {
                setting.classList.remove('active');
            });
        }
        document.getElementById('params-container').classList.toggle('active');
    });
}