(function() {
  class DeepSpeechExtension extends window.Extension {
    constructor() {
      super('moziot-deepspeech');
      this.addMenuEntry('DeepSpeech');

      this.content = '';
      fetch(`/extensions/${this.id}/views/content.html`)
        .then((res) => res.text())
        .then((text) => {
          this.content = text;
        })
        .catch((e) => console.error('Failed to fetch content:', e));
    }

    show() {
      this.view.innerHTML = this.content;

      const extension_id = this.id;
      let statusMic = true;

      const record =
        document.getElementById('extension-moziot-deepspeech-record');
      const pre =
        document.getElementById('extension-moziot-deepspeech-response-data');

      function startOrStopMic() {
         // statusMic = !statusMic;

         window.API.postJson(`/extensions/${extension_id}/api/micControl`, {'status': statusMic})
           .then((body) => {
             console.log("transcript", body);
             record.textContent = statusMic ? 'Stop' : 'Start';
           })
           .catch((err) => {
             console.log("The following error occurred: " + err);
           });
      }

      record.textContent = 'Start';
      record.addEventListener('click', startOrStopMic);
    }
  }

  new DeepSpeechExtension();
})();
