'use strict';

const {APIHandler, APIResponse} = require('gateway-addon');
const manifest = require('./manifest.json');
const path = require('path');
const fs = require('fs');

const Ds = require('deepspeech');

const Sox = require('sox-stream');
const MemoryStream = require('memory-stream');
const Duplex = require('stream').Duplex;

function bufferToStream(buffer) {
  var stream = new Duplex();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

class DSAPIHandler extends APIHandler {
  constructor(addonManager) {
    super(addonManager, manifest.id);
    addonManager.addAPIHandler(this);
    this.setup();
    this.loadModel();
    this.startWebSocket();
  }

  setup() {
    const modelsDir = path.join(this.userProfile.dataDir, manifest.id, 'models');
    console.log('Checking existence of models under ' + modelsDir);

    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir);
    }

    if (!fs.existsSync('/usr/bin/sox')) {
      throw new Error("Missing sox binary");
    }

    this._modelsDir = modelsDir;

    this._wsPort = 3000;
    this._wsHost = 'gateway.local';
  }

  async generateLocalLM(devices) {
    console.log('Generate local LM for models under ' + this._modelsDir);

    /**
     * List of commands from src/controllers/commands_controller.js#L6-L13:
     *  Grammar that the parser understands:
     *  Turn the <tag> light <on|off>
     *  Turn <tag> <on|off>
     *  Shut <tag> <on|off>
     *  Shut the <tag> light <on|off>
     *  When was <tag> last <boolean>
     *  Is <tag> <boolean>
     *  Is <tag> not <boolean>
     **/

    let grammar = [
       'Turn the <tag> light <on|off>',
       'Turn <tag> <on|off>',
       'Shut <tag> <on|off>',
       'Shut the <tag> light <on|off>',
       'When was <tag> last <boolean>',
       'Is <tag> <boolean>',
       'Is <tag> not <boolean>',
    ];

    let finalGrammar = [];

    const on_off = ['on', 'off'];
    const true_false = ['true', 'false'];
    let tags = [];
    devices.forEach((device) => {
      tags.push(device.title);
    });
    console.log('Generate local LM for devices: ' + JSON.stringify(tags));

    for (let i = 0; i < grammar.length; i++) {
       tags.forEach((tag) => {
         let gi = grammar[i];
         gi = gi.replace(/<tag>/g, tag);

         let gii_on_off = gi;
         on_off.forEach((sw) => {
           gi = gii_on_off.replace(/<on\|off>/g, sw);

           let gii_true_false = gi;
           true_false.forEach((bool) => {
             gi = gii_true_false.replace(/<boolean>/g, bool).toLowerCase();

             if (finalGrammar.indexOf(gi) < 0) {
               console.log('for ' + tag + ': ' + gi);
               finalGrammar.push(gi);
             }
           });

         });
       });
    }

    const localLMTxt    = path.join(this._modelsDir, 'en-us', 'local_lm.txt');
    const localLMArpa   = path.join(this._modelsDir, 'en-us', 'local_lm.arpa');
    const localLMBinary = path.join(this._modelsDir, 'en-us', 'local_lm.binary');
    fs.writeFileSync(localLMTxt, finalGrammar.join('\n'));

    const binDir = path.join(this.userProfile.baseDir, 'addons', manifest.id, 'bin');
    const { spawnSync} = require('child_process');

    const child_lmplz = spawnSync(path.join(binDir, 'lmplz'), [
        '--memory', '1%',
        '--order', '2', '--discount_fallback',
        '--text', localLMTxt,
        '--arpa', localLMArpa
    ]);

    console.log('lmplz error', child_lmplz.error);
    console.log('lmplz stdout ', child_lmplz.stdout.toString());
    console.log('lmplz stderr ', child_lmplz.stderr.toString());

    const child_binary = spawnSync(path.join(binDir, 'build_binary'), [
        '-a', '255', '-q', '8', 'trie',
        localLMArpa, localLMBinary
    ]);

    console.log('binary error', child_binary.error);
    console.log('binary stdout ', child_binary.stdout.toString());
    console.log('binary stderr ', child_binary.stderr.toString());
  }

  loadModel() {
    this._modelRoot = path.join(this._modelsDir, 'en-us');
    this._modelJson = JSON.parse(fs.readFileSync(path.join(this._modelRoot, 'info.json')));
    this._model = new Ds.Model(path.join(this._modelRoot, 'output_graph.tflite'), 500);
    this._model.enableDecoderWithLM(path.join(this._modelRoot, 'local_lm.binary'),
                                    path.join(this._modelRoot, 'local_lm.trie'),
                                    this._modelJson['parameters']['lmAlpha'],
                                    this._modelJson['parameters']['lmBeta']);
  }

  startWebSocket() {
    const express = require('express');
    const https = require('https');
    const options = {
      key: fs.readFileSync(path.join(this.userProfile.baseDir, 'ssl', 'privatekey.pem')),
      cert: fs.readFileSync(path.join(this.userProfile.baseDir, 'ssl', 'certificate.pem'))
    };

    const app = express();
    const sslServer = https.createServer(options, app);
    const ws = require('express-ws')(app, sslServer);

    sslServer.listen(this._wsPort, () => {
      console.log("Server listening on port 3000");
    });

    this._seq = 0;
    app.ws('/stream', this.handleWsStream.bind(this));
  }

  handleWsStream(ws, req) {
    const dsStream   = this._model.createStream();
    const sampleRate = this._model.sampleRate();

    const interimTimer = setInterval(() => {
      let transcript = this._model.intermediateDecode(dsStream);
      console.debug('transcript', transcript);
      ws.send(JSON.stringify({"interimtranscript": transcript}));
    }, 2*1000);

    ws.on('message', (rawAudio) => {
      let typeOfMessage = typeof rawAudio;
      console.log('Received data of type: ' + typeOfMessage);

      // Detect when it is time to finish
      if (typeOfMessage === 'string' && rawAudio === 'end') {
        clearInterval(interimTimer);
        let transcript = this._model.finishStream(dsStream);
        console.debug('transcript', transcript);
        ws.send(JSON.stringify({"finaltranscript": transcript}));
        return;
      }

      /*            
      fs.writeFile("/tmp/deepspeech_dump_" + this._seq + ".raw", rawAudio, "binary", function(err) {
        if(err) {
            return console.log(err);
        }
        console.log("The file was saved!");
      });
      */

      try {
        var audioStream = new MemoryStream();
        bufferToStream(rawAudio).
          pipe(Sox({
            input: {
              bits: 32,
              rate: 44100,
              channels: 1,
              encoding: 'floating-point',
              endian: 'little',
              type: 'raw',
            },
            output: {
              bits: 16,
              rate: sampleRate,
              channels: 1,
              encoding: 'signed-integer',
              endian: 'little',
              compression: 0.0,
              type: 'wavpcm',
            }
          })).
          pipe(audioStream);

        audioStream.on('finish', () => {
          let audioBuffer = audioStream.toBuffer();

          console.debug('audioBuffer', audioBuffer.length);
          this._model.feedAudioContent(dsStream, audioBuffer.slice(0, audioBuffer.length / 2));

          this._seq++;
        });
      } catch (err) {
        console.debug('audio error', err);
      }
    });

    ws.on('close', (data) => {
      console.log('websocket closed by client');
    });
  }

  async handleRequest(request) {
    if (request.method === 'GET' && request.path === '/websocket') {
      return new APIResponse({
        status: 200,
        contentType: 'application/json',
        content: JSON.stringify({'url': 'wss://' + this._wsHost + ':' + this._wsPort + '/stream'}),
      });
    }

    return new APIResponse({
      status: 200,
      contentType: 'application/json',
      content: JSON.stringify({'error': 'use websocket'}),
    });
  }
}

module.exports = DSAPIHandler;
