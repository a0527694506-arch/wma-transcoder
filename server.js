const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());

app.get('/stream-wma', async (req, res) => {
  const { id, token } = req.query;

  if (!id) {
    return res.status(400).send("Missing track ID");
  }

  const workerBaseUrl = 'https://misty-block-12ce.a0527694506.workers.dev';
  const sourceUrl = `${workerBaseUrl}?id=${id}&token=${encodeURIComponent(token || '')}`;

  try {
    const response = await axios({
      method: 'get',
      url: sourceUrl,
      responseType: 'stream'
    });

    res.setHeader('Content-Type', 'audio/mpeg');

    ffmpeg(response.data)
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      .format('mp3')
      .on('error', (err) => {
        if (!err.message.includes('Output stream closed')) {
          console.error('FFmpeg Error:', err.message);
        }
      })
      .pipe(res, { end: true });

  } catch (error) {
    console.error('Error fetching stream:', error.message);
    if (!res.headersSent) {
      res.status(500).send('Error processing audio stream');
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
