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

      const record =
        document.getElementById('extension-moziot-deepspeech-record');
      const pre =
        document.getElementById('extension-moziot-deepspeech-response-data');

      const url = document.getElementById('url');

      function submitCommand(text) {
        return window.API.submitAssistantCommand(text).then(([ok, body]) => {
          if (!ok) {
            let error = 'Sorry, something went wrong.';
            if (body.hasOwnProperty('message')) {
              error = body.message;
            }

            throw new Error(error);
          }

          let message = body.message;

          if (!message) {
            let verb, preposition = '';
            switch (body.payload.keyword) {
              case 'make':
                verb = 'making';
                break;
              case 'change':
                verb = 'changing';
                break;
              case 'set':
                verb = 'setting';
                preposition = 'to ';
                break;
              case 'dim':
                verb = 'dimming';
                preposition = 'by ';
                break;
              case 'brighten':
                verb = 'brightening';
                preposition = 'by ';
                break;
              case 'turn':
              case 'switch':
              default:
                verb = `${body.payload.keyword}ing`;
                break;
            }

            const value = body.payload.value ? body.payload.value : '';

            message =
              `OK, ${verb} the ${body.payload.thing} ${preposition}${value}.`;
          }
          console.log(
            message,
            'incoming'
          );
          return {
            message,
            success: true,
          };
        }).catch((e) => {
          const message = e.message || 'Sorry, something went wrong.';
          console.log(message, 'incoming');
          return {
            message,
            success: false,
          };
        });
      }

      function streamSound() {
        let deepSpeechSocket;
        window.API.getJson(`/extensions/${extension_id}/api/websocket`)
        .then((body) => {
          console.log("transcript", body);

          const wsUrl = body['url'];
          const httpsUrl = wsUrl.replace('wss', 'https');
          url.href = httpsUrl;
          url.textContent = httpsUrl;

          deepSpeechSocket = new WebSocket(wsUrl);
          deepSpeechSocket.onmessage = (event) => {
            const payload = JSON.parse(event.data);
            let transcript;
            if ('interimtranscript' in payload) {
              transcript = payload['interimtranscript'];
            } else if ('finaltranscript' in payload) {
              transcript = payload['finaltranscript'];
            }

            console.log("transcript", transcript);

            pre.textContent = transcript;

            if ('finaltranscript' in payload) {
              deepSpeechSocket.close();
              submitCommand(transcript);
            }
          };

          deepSpeechSocket.onclose = (event) => {
            console.log("close event", event);
          };

          record.removeEventListener('click', streamSoundBinder);

          var source, node;
          const constraints = {
            autoGainControl: true,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 16000
          };

          navigator.mediaDevices.getUserMedia({ audio: constraints, video: false})
            .then((stream) => {
              let uploadPromises = [];
              record.textContent = 'Stop';
              let stopSound = () => {
                console.log("Stopping stream");
                stream.getTracks().forEach((track) => {
                  console.log("Stopping track", track);
                  track.stop();
                });

                source.disconnect(node);
                // node.disconnect(context.destination);
                record.textContent = 'Start';
                record.removeEventListener('click', stopSound);
                record.addEventListener('click', streamSoundBinder);

                deepSpeechSocket.send("end");
              };

              record.addEventListener('click', stopSound);

              console.log("Got stream");
              console.debug(stream.getAudioTracks()[0]);
              console.debug(navigator.mediaDevices.getSupportedConstraints());
              console.debug(stream.getAudioTracks()[0].getConstraints());
              console.debug(stream.getAudioTracks()[0].getSettings());

              console.debug("Create AudioContext");
              var context = new AudioContext();
              source = context.createMediaStreamSource(stream);

              var recLength = 0, recBuffers = [];

              node = context.createScriptProcessor(4096, 1, 1);

              source.connect(node);

              // listen to the audio data, and record into the buffer
              node.onaudioprocess = function(e) {
                recBuffers.push(e.inputBuffer.getChannelData(0));
                recLength += e.inputBuffer.getChannelData(0).length;
                  if (recLength >= (4096*16)) {
                    var bufferSize = recBuffers[0].length * recBuffers.length;
                    var sendBuffers = new Float32Array(bufferSize);
                    for (let e in recBuffers) {
                      sendBuffers.set(recBuffers[e], e*recBuffers[e].length);
                    }
                    console.debug("buffer", sendBuffers.byteLength);
                    deepSpeechSocket.send(sendBuffers);
                    recBuffers = [];
                    recLength  = 0;
                  }
              }
            })
            .catch((err) => {
              console.log("The following error occurred: " + err);
            });

        })
        .catch((err) => {
          console.log("The following error occurred: " + err);
        });
      }

      const streamSoundBinder = streamSound.bind(this);
      record.addEventListener('click', streamSoundBinder);
    }
  }

  new DeepSpeechExtension();
})();
